import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPayPalClient, PayPalError } from '../../src/paypal/client';
import { verifyWebhookSignature, WEBHOOK_VERIFY_TIMEOUT_MS } from '../../src/paypal/webhook-verify';

const BASE = 'https://paypal.test';
const fx = JSON.parse(
  readFileSync(
    'tests/fixtures/paypal/webhook-customer-dispute-resolved-86105147-cbed-11f1-9883-c743da698d78.json',
    'utf8',
  ),
);
// What the listener received, then what PayPal answered: both real. Redaction means the signature would not verify offline.
const headers = new Headers(fx.headers);
const raw = ` ${JSON.stringify(fx.body, null, 1)} `.trim(); // pretty-printed on purpose: the raw text must be passed through unchanged
const WEBHOOK_ID = 'WEBHOOK-ID-1';

const server = setupServer();
let seen: { text: string; json: Record<string, unknown> }[] = [];
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  seen = [];
  server.use(http.post(`${BASE}/v1/oauth2/token`, () => HttpResponse.json({ access_token: 't', expires_in: 3600 })));
});
afterEach(() => server.resetHandlers());

const client = () => createPayPalClient({ clientId: 'id', clientSecret: 's', baseUrl: BASE });
const answer = (body: unknown, status = 200, delayMs = 0) =>
  server.use(
    http.post(`${BASE}/v1/notifications/verify-webhook-signature`, async ({ request }) => {
      const text = await request.text();
      seen.push({ text, json: JSON.parse(text) });
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return HttpResponse.json(body as object, { status });
    }),
  );

describe('verifyWebhookSignature', () => {
  it('sends PayPal the five transmission headers, our webhook id and the raw body unchanged', async () => {
    answer(fx.verification.body); // the real answer: { verification_status: "SUCCESS" }
    expect(await verifyWebhookSignature(client(), WEBHOOK_ID, headers, raw)).toBe(true);
    const { text, json } = seen[0]!;
    expect(json).toMatchObject({
      auth_algo: fx.headers['paypal-auth-algo'],
      cert_url: fx.headers['paypal-cert-url'],
      transmission_id: fx.headers['paypal-transmission-id'],
      transmission_sig: fx.headers['paypal-transmission-sig'],
      transmission_time: fx.headers['paypal-transmission-time'],
      webhook_id: WEBHOOK_ID,
    });
    expect(text.endsWith(`"webhook_event":${raw}}`)).toBe(true); // the signature covers these exact bytes
    expect(json.webhook_event).toEqual(fx.body);
  });

  it('is false for any answer that is not SUCCESS', async () => {
    // No real FAILURE answer is on file; only the field the code reads is set.
    answer({ verification_status: 'FAILURE' });
    expect(await verifyWebhookSignature(client(), WEBHOOK_ID, headers, raw)).toBe(false);
  });

  it.each([[{}], [{ verification_status: 'success' }], [{ verification_status: null }]])(
    'is false for %j',
    async (body) => {
      answer(body);
      expect(await verifyWebhookSignature(client(), WEBHOOK_ID, headers, raw)).toBe(false);
    },
  );

  it.each([
    'paypal-transmission-id',
    'paypal-transmission-time',
    'paypal-transmission-sig',
    'paypal-cert-url',
    'paypal-auth-algo',
  ])('is false without calling PayPal when %s is missing', async (name) => {
    const h = new Headers(fx.headers);
    h.delete(name);
    expect(await verifyWebhookSignature(client(), WEBHOOK_ID, h, raw)).toBe(false);
    expect(seen).toHaveLength(0); // an unhandled request would also fail the run
  });

  it('throws, and does not say "invalid", when PayPal cannot be asked', async () => {
    answer(JSON.parse(readFileSync('tests/fixtures/paypal/provide-evidence-response-v2.json', 'utf8')).response, 500);
    await expect(verifyWebhookSignature(client(), WEBHOOK_ID, headers, raw)).rejects.toThrow();
  });

  it('throws when PayPal takes longer than the timeout', async () => {
    answer(fx.verification.body, 200, 300);
    await expect(verifyWebhookSignature(client(), WEBHOOK_ID, headers, raw, 50)).rejects.toThrow(/timed out/i);
  });
  it('waits up to 4 s by default (live checks from India took 0.5 to 1.7 s and timed out at 1.5 s)', async () => {
    expect(WEBHOOK_VERIFY_TIMEOUT_MS).toBe(4000);
    answer(fx.verification.body, 200, 2000);
    await expect(verifyWebhookSignature(client(), WEBHOOK_ID, headers, raw)).resolves.toBe(true);
  }, 10_000);
});

// Synthetic 400 body (not a real PayPal response): the shape PayPal uses for a schema error with a field.
const SYNTHETIC_400 = {
  name: 'INVALID_REQUEST',
  message: 'Request is not well-formed, syntactically incorrect, or violates schema.',
  debug_id: 'SYNTHETIC-DEBUG-1',
  details: [{ field: 'webhook_id', location: 'body', issue: 'INVALID_STRING_LENGTH' }],
};

describe('a 400 from the verify call', () => {
  it('keeps the field name and the issue code on the PayPalError', async () => {
    answer(SYNTHETIC_400, 400);
    const err = (await verifyWebhookSignature(client(), WEBHOOK_ID, headers, raw).catch((e: unknown) => e)) as PayPalError;
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('INVALID_REQUEST');
    expect(err.issues).toEqual(['INVALID_STRING_LENGTH']);
    expect(err.fields).toEqual(['webhook_id']);
    expect(err.debugId).toBe('SYNTHETIC-DEBUG-1');
  });

  it('logs which header names are present and the webhook id length and shape, never a value', async () => {
    answer(SYNTHETIC_400, 400);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const odd = 'WEBHOOK-ID-1\r'; // a stray carriage return: wrong shape
    await verifyWebhookSignature(client(), odd, headers, raw).catch(() => {});
    const line = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    spy.mockRestore();
    for (const name of [
      'paypal-auth-algo',
      'paypal-cert-url',
      'paypal-transmission-id',
      'paypal-transmission-sig',
      'paypal-transmission-time',
    ]) {
      expect(line).toContain(name);
    }
    expect(line).toContain(`webhookIdLength=${odd.length}`);
    expect(line).toContain('webhookIdShapeOk=false');
    expect(line).not.toContain('WEBHOOK-ID-1');
    for (const v of Object.values(fx.headers) as string[]) expect(line).not.toContain(v);
  });

  it('logs nothing extra when PayPal answers normally', async () => {
    answer(fx.verification.body);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await verifyWebhookSignature(client(), WEBHOOK_ID, headers, raw);
    const n = spy.mock.calls.length;
    spy.mockRestore();
    expect(n).toBe(0);
  });
});
