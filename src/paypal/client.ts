// The only HTTP door to PayPal (T-107). Transport only: token cache, typed errors,
// PayPal-Request-Id on writes. It decides nothing about disputes or money.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { systemClock, type Clock } from '../lib/clock';

/** The token is treated as expired this long before PayPal says so. */
const TOKEN_SAFETY_MS = 60_000;
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() });
const errorBodySchema = z.object({
  name: z.string().optional(),
  message: z.string().optional(),
  debug_id: z.string().optional(),
  details: z.array(z.object({ issue: z.string().optional() })).optional(),
});

export class PayPalError extends Error {
  readonly status: number;
  /** PayPal's error `name`, e.g. INVALID_REQUEST. Undefined when the body was not PayPal JSON. */
  readonly code: string | undefined;
  readonly debugId: string | undefined;
  /** Every `details[].issue`, in order. These tell apart errors that share a status and a name. */
  readonly issues: readonly string[];

  constructor(init: { status: number; message: string; code?: string; debugId?: string; issues?: string[] }) {
    super(init.message);
    this.name = 'PayPalError';
    this.status = init.status;
    this.code = init.code;
    this.debugId = init.debugId;
    this.issues = init.issues ?? [];
  }

  hasIssue(issue: string): boolean {
    return this.issues.includes(issue);
  }
}

export class PayPalChangeNotSeenError extends Error {
  constructor(attempts: number) {
    super(`The change did not show in PayPal after ${attempts} reads`);
    this.name = 'PayPalChangeNotSeenError';
  }
}

/**
 * A body that is already JSON text and must reach PayPal byte for byte. Webhook verification needs this:
 * the signature covers the exact bytes PayPal sent, so the event must not be parsed and written out again.
 */
export class RawJson {
  constructor(readonly text: string) {}
}

export interface PayPalResponse<T = unknown> {
  status: number;
  body: T;
  debugId: string | undefined;
}

export interface PayPalClientOptions {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  clock?: Clock;
  fetch?: typeof fetch;
}

interface Token {
  value: string;
  expiresAt: number;
}

export function createPayPalClient(opts: PayPalClientOptions) {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const clock = opts.clock ?? systemClock;
  const doFetch = opts.fetch ?? fetch;
  let token: Token | undefined;
  let inflight: Promise<Token> | undefined;

  const fetchToken = async (): Promise<Token> => {
    const res = await doFetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const parsed = tokenSchema.safeParse(await readJson(res));
    if (!res.ok || !parsed.success) {
      throw new PayPalError({
        status: res.status,
        message: `PayPal token request failed (${res.status})`,
        debugId: res.headers.get('paypal-debug-id') ?? undefined,
      });
    }
    return { value: parsed.data.access_token, expiresAt: clock().getTime() + parsed.data.expires_in * 1000 };
  };

  const getToken = async (forceRefresh: boolean): Promise<string> => {
    if (!forceRefresh && token && clock().getTime() < token.expiresAt - TOKEN_SAFETY_MS) return token.value;
    // Concurrent callers share one token request.
    inflight ??= fetchToken().finally(() => {
      inflight = undefined;
    });
    token = await inflight;
    return token.value;
  };

  const send = async (
    method: string,
    path: string,
    body: unknown,
    requestId: string | undefined,
    accessToken: string,
  ) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
    // PayPal answers 415 UNSUPPORTED_MEDIA_TYPE to a write without this header, even when there is no body (capture).
    if (body !== undefined || WRITE_METHODS.has(method)) headers['Content-Type'] = 'application/json';
    if (requestId) headers['PayPal-Request-Id'] = requestId;
    const payload = body === undefined ? undefined : body instanceof RawJson ? body.text : JSON.stringify(body);
    return doFetch(`${base}${path}`, { method, headers, body: payload });
  };

  const request = async <T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    options: { requestId?: string } = {},
  ): Promise<PayPalResponse<T>> => {
    const verb = method.toUpperCase();
    // One id per logical write, reused if the call is retried after a token refresh.
    const requestId = WRITE_METHODS.has(verb) ? (options.requestId ?? randomUUID()) : undefined;
    let res = await send(verb, path, body, requestId, await getToken(false));
    if (res.status === 401) res = await send(verb, path, body, requestId, await getToken(true));

    const parsed = await readJson(res);
    const debugId = res.headers.get('paypal-debug-id') ?? undefined;
    if (!res.ok) {
      const err = errorBodySchema.safeParse(parsed);
      const e = err.success ? err.data : {};
      throw new PayPalError({
        status: res.status,
        message: e.message ?? `PayPal ${verb} ${path} failed (${res.status})`,
        code: e.name,
        debugId: e.debug_id ?? debugId,
        issues: (e.details ?? []).flatMap((d) => (d.issue ? [d.issue] : [])),
      });
    }
    return { status: res.status, body: parsed as T, debugId };
  };

  return {
    request,
    get: <T = unknown>(path: string) => request<T>('GET', path),
    post: <T = unknown>(path: string, body?: unknown, options?: { requestId?: string }) =>
      request<T>('POST', path, body, options),
  };
}

export type PayPalClient = ReturnType<typeof createPayPalClient>;

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface PayPalLink {
  rel: string;
  href: string;
  method?: string;
}

/** Looks a link up by `rel`. Never by position: PayPal shuffles the order and links come and go. */
export function findLink(resource: { links?: PayPalLink[] } | null | undefined, rel: string): PayPalLink | undefined {
  return resource?.links?.find((l) => l.rel === rel);
}

/**
 * Write responses carry no state, so after a write we read again until the change shows.
 * `read` must do a fresh GET each time. Never returns state that failed `isChanged`.
 */
export async function rereadUntil<T>(
  read: () => Promise<T>,
  isChanged: (value: T) => boolean,
  opts: { attempts: number; delayMs: number; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < opts.attempts; i++) {
    const value = await read();
    if (isChanged(value)) return value;
    if (i < opts.attempts - 1) await sleep(opts.delayMs);
  }
  throw new PayPalChangeNotSeenError(opts.attempts);
}
