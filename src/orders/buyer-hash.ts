import { createHmac } from 'node:crypto';

/** HMAC-SHA256 of the PayPal payer id, keyed by HMAC_SECRET. The raw payer id is never stored or shown. */
export function buyerHash(secret: string | undefined, payerId: string): string {
  if (!secret || secret.length < 32) throw new Error('HMAC_SECRET must be set and at least 32 characters');
  if (!payerId) throw new Error('payer id is empty');
  return createHmac('sha256', secret).update(payerId).digest('hex');
}
