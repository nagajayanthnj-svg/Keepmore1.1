import { createDb, type Db } from './db';
import type { CheckoutDeps } from '../orders/handlers';
import { createPayPalClient } from '../paypal/client';

export const SANDBOX_API = 'https://api-m.sandbox.paypal.com';

/** Sandbox only (CLAUDE.md). Any other host, including PayPal's live API and the sandbox website, is refused. */
export function paypalBaseUrl(value: string | undefined): string {
  const v = (value ?? '').trim().replace(/\/+$/, '');
  if (v === '' || v === SANDBOX_API) return SANDBOX_API;
  throw new Error(`PAYPAL_API_BASE must be ${SANDBOX_API} (sandbox only), got "${v}"`);
}

const g = globalThis as unknown as { __keepmoreDb?: Db };

/** Server-side dependencies from the environment. Null when PayPal credentials are missing. */
export function getCheckoutDeps(): CheckoutDeps | null {
  const { PAYPAL_CLIENT_ID: clientId, PAYPAL_CLIENT_SECRET: clientSecret } = process.env;
  if (!clientId || !clientSecret) return null;
  g.__keepmoreDb ??= createDb();
  return {
    db: g.__keepmoreDb,
    paypal: createPayPalClient({
      clientId,
      clientSecret,
      baseUrl: paypalBaseUrl(process.env.PAYPAL_API_BASE),
    }),
    hmacSecret: process.env.HMAC_SECRET,
  };
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
