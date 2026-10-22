// Webhook signature check (T-202). PayPal's own verify call does the cryptography; we pass it the five
// transmission headers, our webhook id and the raw body. Same call the Phase 0 spike used live.
import { RawJson, type PayPalClient } from './client';

const HEADERS = [
  ['auth_algo', 'paypal-auth-algo'],
  ['cert_url', 'paypal-cert-url'],
  ['transmission_id', 'paypal-transmission-id'],
  ['transmission_sig', 'paypal-transmission-sig'],
  ['transmission_time', 'paypal-transmission-time'],
] as const;

/** Live checks (22 Oct, from India): verification took 0.5 to 1.7 s and timed out at 1.5 s even on a warm server. Owner raised the limit to 4 s. */
export const WEBHOOK_VERIFY_TIMEOUT_MS = 4000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('PayPal webhook verification timed out')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * True only when PayPal answers SUCCESS. False when a header is missing or PayPal says anything else.
 * Throws when PayPal cannot be asked (error or timeout): that is not the same as "invalid", and the
 * caller must not record it as a forgery. `rawBody` must be the request text exactly as received.
 */
export async function verifyWebhookSignature(
  paypal: PayPalClient,
  webhookId: string,
  headers: Headers,
  rawBody: string,
  timeoutMs = WEBHOOK_VERIFY_TIMEOUT_MS,
): Promise<boolean> {
  const fields: Record<string, string> = {};
  for (const [name, header] of HEADERS) {
    const value = headers.get(header);
    if (!value) return false;
    fields[name] = value;
  }
  const head = JSON.stringify({ ...fields, webhook_id: webhookId });
  // The event is spliced in as raw text: the signature covers these exact bytes.
  const body = new RawJson(`${head.slice(0, -1)},"webhook_event":${rawBody}}`);
  const res = await withTimeout(
    paypal.post<{ verification_status?: string }>('/v1/notifications/verify-webhook-signature', body),
    timeoutMs,
  );
  return res.body?.verification_status === 'SUCCESS';
}
