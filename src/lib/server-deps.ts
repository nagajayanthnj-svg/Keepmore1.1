import { createDb, type Db } from './db';
import type { CheckoutDeps } from '../orders/handlers';
import { createPayPalClient } from '../paypal/client';

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
      baseUrl: process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com',
    }),
    hmacSecret: process.env.HMAC_SECRET,
  };
}

export const misconfigured = () => Response.json({ error: 'SERVER_MISCONFIGURED' }, { status: 500 });
