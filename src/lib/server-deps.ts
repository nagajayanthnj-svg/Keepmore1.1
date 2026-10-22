import { createDb, type Db } from './db';
import type { CheckoutDeps } from '../orders/handlers';
import type { SyncDeps } from '../disputes/sync';
import { createPayPalClient, type PayPalClient } from '../paypal/client';
import { providerFromEnv } from '../ai/provider';

export const SANDBOX_API = 'https://api-m.sandbox.paypal.com';

/** Sandbox only (CLAUDE.md). Any other host, including PayPal's live API and the sandbox website, is refused. */
export function paypalBaseUrl(value: string | undefined): string {
  const v = (value ?? '').trim().replace(/\/+$/, '');
  if (v === '' || v === SANDBOX_API) return SANDBOX_API;
  throw new Error(`PAYPAL_API_BASE must be ${SANDBOX_API} (sandbox only), got "${v}"`);
}

const g = globalThis as unknown as { __keepmoreDb?: Db };

/** The app's database, one connection per server process. */
export function getDb(): Db {
  g.__keepmoreDb ??= createDb();
  return g.__keepmoreDb;
}

/** Server-side dependencies from the environment. Null when PayPal credentials are missing. */
export function getCheckoutDeps(): CheckoutDeps | null {
  const { PAYPAL_CLIENT_ID: clientId, PAYPAL_CLIENT_SECRET: clientSecret } = process.env;
  if (!clientId || !clientSecret) return null;
  return {
    db: getDb(),
    paypal: createPayPalClient({
      clientId,
      clientSecret,
      baseUrl: paypalBaseUrl(process.env.PAYPAL_API_BASE),
    }),
    hmacSecret: process.env.HMAC_SECRET,
  };
}

/** Dependencies for reading disputes. Null when PayPal credentials are missing. */
export function getSyncDeps(): SyncDeps | null {
  const deps = getCheckoutDeps();
  return deps ? { db: deps.db, paypal: deps.paypal, hmacSecret: deps.hmacSecret } : null;
}

export const misconfigured = () => Response.json({ error: 'SERVER_MISCONFIGURED' }, { status: 500 });

/**
 * Runs a route handler. A thrown error becomes a JSON 500 (never an HTML page the browser cannot read),
 * and any error response is logged with its status and body, so the terminal says why. Bodies hold
 * error codes and PayPal debug ids only, never credentials.
 */
export async function guard(
  label: string,
  run: () => Promise<Response>,
  log: (line: string) => void = console.error,
): Promise<Response> {
  try {
    const res = await run();
    if (!res.ok) log(`${label} failed: ${res.status} ${await res.clone().text()}`);
    return res;
  } catch (e) {
    log(`${label} crashed: ${e instanceof Error ? e.message : String(e)}`);
    return Response.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

const gp = globalThis as unknown as { __keepmorePayPal?: { key: string; paypal: PayPalClient } };

/**
 * One PayPal client for the process, so its access token is reused. The webhook route answers within a
 * time limit and uses this one; the server warms it at start (instrumentation). Null without credentials.
 */
export function getSharedPayPal(): PayPalClient | null {
  const { PAYPAL_CLIENT_ID: clientId, PAYPAL_CLIENT_SECRET: clientSecret } = process.env;
  if (!clientId || !clientSecret) return null;
  const baseUrl = paypalBaseUrl(process.env.PAYPAL_API_BASE);
  const key = `${clientId}:${clientSecret}:${baseUrl}`;
  // On globalThis like the database: instrumentation and the route can be separate bundles.
  if (gp.__keepmorePayPal?.key !== key) {
    gp.__keepmorePayPal = { key, paypal: createPayPalClient({ clientId, clientSecret, baseUrl }) };
  }
  return gp.__keepmorePayPal.paypal;
}

/** Dependencies for the analyse route. PayPal and the model are each optional: without them the route still answers. */
export function getAnalyseDeps(): import('../ai/analyse-route').AnalyseRouteDeps {
  const cap = Number(process.env.AI_DAILY_CALL_CAP);
  return {
    db: getDb(),
    paypal: getSharedPayPal(),
    provider: providerFromEnv(),
    dailyCap: Number.isFinite(cap) && cap > 0 ? cap : undefined,
  };
}
