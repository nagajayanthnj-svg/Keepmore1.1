import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  PayPalChangeNotSeenError,
  PayPalError,
  RawJson,
  createPayPalClient,
  findLink,
  rereadUntil,
} from '../../src/paypal/client';

const BASE = 'https://paypal.test';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const realError = JSON.parse(readFileSync('tests/fixtures/paypal/provide-evidence-response-v2.json', 'utf8')).response;

let now = Date.parse('2026-10-20T00:00:00Z');
const clock = () => new Date(now);
const advance = (s: number) => (now += s * 1000);

let tokenCalls: Request[] = [];
let apiCalls: Request[] = [];
let tokenSeq = 0;
const tokenHandler = (expiresIn = 3600) =>
  http.post(`${BASE}/v1/oauth2/token`, async ({ request }) => {
    tokenCalls.push(request.clone());
    tokenSeq += 1;
    return HttpResponse.json({ access_token: `tok-${tokenSeq}`, token_type: 'Bearer', expires_in: expiresIn });
  });
const echo = http.all(`${BASE}/v1/ping`, ({ request }) => {
  apiCalls.push(request.clone());
  return HttpResponse.json({ ok: true });
});

const make = () => {
  now = Date.parse('2026-10-20T00:00:00Z');
  tokenCalls = [];
  apiCalls = [];
  tokenSeq = 0;
  return createPayPalClient({ clientId: 'id', clientSecret: 'shh-secret', baseUrl: `${BASE}/`, clock });
};

describe('token cache', () => {
  it('requests a token with Basic auth and client_credentials, then sends it as Bearer', async () => {
    server.use(tokenHandler(), echo);
    const c = make();
    await c.get('/v1/ping');
    expect(tokenCalls[0]!.headers.get('authorization')).toBe(
      `Basic ${Buffer.from('id:shh-secret').toString('base64')}`,
    );
    expect(await tokenCalls[0]!.text()).toBe('grant_type=client_credentials');
    expect(apiCalls[0]!.headers.get('authorization')).toBe('Bearer tok-1');
  });

  it('reuses the token until 60 s before expiry, then refreshes', async () => {
    server.use(tokenHandler(3600), echo);
    const c = make();
    await c.get('/v1/ping');
    advance(3539);
    await c.get('/v1/ping');
    expect(tokenCalls).toHaveLength(1);
    advance(1); // 3540 s = 60 s before expiry
    await c.get('/v1/ping');
    expect(tokenCalls).toHaveLength(2);
    expect(apiCalls[2]!.headers.get('authorization')).toBe('Bearer tok-2');
  });

  it('shares one token request between concurrent calls', async () => {
    server.use(tokenHandler(), echo);
    const c = make();
    await Promise.all([c.get('/v1/ping'), c.get('/v1/ping'), c.get('/v1/ping')]);
    expect(tokenCalls).toHaveLength(1);
  });

  it('refreshes once on 401 and retries the call with the same request id', async () => {
    let n = 0;
    server.use(
      tokenHandler(),
      http.post(`${BASE}/v1/ping`, ({ request }) => {
        apiCalls.push(request.clone());
        n += 1;
        return n === 1
          ? HttpResponse.json({ name: 'AUTHENTICATION_FAILURE' }, { status: 401 })
          : HttpResponse.json({ ok: true });
      }),
    );
    const c = make();
    const r = await c.post('/v1/ping', { a: 1 }, { requestId: 'req-1' });
    expect(r.status).toBe(200);
    expect(tokenCalls).toHaveLength(2);
    expect(apiCalls.map((a) => a.headers.get('paypal-request-id'))).toEqual(['req-1', 'req-1']);
    expect(apiCalls[1]!.headers.get('authorization')).toBe('Bearer tok-2');
  });

  it('gives up after one refresh when the second answer is also 401', async () => {
    server.use(
      tokenHandler(),
      http.get(`${BASE}/v1/ping`, ({ request }) => {
        apiCalls.push(request.clone());
        return HttpResponse.json({ name: 'AUTHENTICATION_FAILURE', message: 'no' }, { status: 401 });
      }),
    );
    const c = make();
    await expect(c.get('/v1/ping')).rejects.toMatchObject({ status: 401 });
    expect(apiCalls).toHaveLength(2);
    expect(tokenCalls).toHaveLength(2);
  });

  it('turns a failed token request into a PayPalError without leaking the secret', async () => {
    server.use(
      http.post(`${BASE}/v1/oauth2/token`, () => HttpResponse.json({ error: 'invalid_client' }, { status: 401 })),
    );
    const c = make();
    const err = await c.get('/v1/ping').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(JSON.stringify(err) + String((err as Error).message)).not.toContain('shh-secret');
  });
});

describe('PayPal-Request-Id', () => {
  it.each(['POST', 'PATCH', 'PUT', 'DELETE'] as const)('is sent on %s, generated when not given', async (method) => {
    server.use(tokenHandler(), echo);
    const c = make();
    await c.request(method, '/v1/ping', method === 'DELETE' ? undefined : { a: 1 });
    const id = apiCalls[0]!.headers.get('paypal-request-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses the caller id when given, and is not sent on GET', async () => {
    server.use(tokenHandler(), echo);
    const c = make();
    await c.post('/v1/ping', {}, { requestId: 'mine-42' });
    await c.get('/v1/ping');
    expect(apiCalls[0]!.headers.get('paypal-request-id')).toBe('mine-42');
    expect(apiCalls[1]!.headers.get('paypal-request-id')).toBeNull();
  });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'] as const)(
    'sends a JSON content type on %s even with no body (PayPal answers 415 without it)',
    async (method) => {
      server.use(tokenHandler(), echo);
      const c = make();
      await c.request(method, '/v1/ping');
      expect(apiCalls[0]!.headers.get('content-type')).toContain('application/json');
    },
  );

  it('sends no content type on GET', async () => {
    server.use(tokenHandler(), echo);
    const c = make();
    await c.get('/v1/ping');
    expect(apiCalls[0]!.headers.get('content-type')).toBeNull();
  });

  it('sends the JSON body with a JSON content type', async () => {
    server.use(tokenHandler(), echo);
    const c = make();
    await c.post('/v1/ping', { note: 'x' });
    expect(apiCalls[0]!.headers.get('content-type')).toContain('application/json');
    expect(await apiCalls[0]!.json()).toEqual({ note: 'x' });
  });
});

describe('typed errors', () => {
  it('keeps name, message, debug id and every details[].issue from a real PayPal 400', async () => {
    server.use(
      tokenHandler(),
      http.post(`${BASE}/v1/ping`, () => HttpResponse.json(realError.body, { status: 400 })),
    );
    const c = make();
    const err = (await c.post('/v1/ping', {}).catch((e: unknown) => e)) as PayPalError;
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.status).toBe(400);
    expect(err.name).toBe('PayPalError');
    expect(err.code).toBe('INVALID_REQUEST');
    expect(err.debugId).toBe(realError.body.debug_id);
    expect(err.issues).toEqual(['EVIDENCE_TYPE_IS_NOT_ALLOWED']);
    expect(err.hasIssue('EVIDENCE_TYPE_IS_NOT_ALLOWED')).toBe(true);
    expect(err.hasIssue('OTHER')).toBe(false);
  });

  it('falls back to the paypal-debug-id header and survives a body that is not JSON', async () => {
    server.use(
      tokenHandler(),
      http.get(
        `${BASE}/v1/ping`,
        () => new HttpResponse('<html>bad gateway</html>', { status: 502, headers: { 'paypal-debug-id': 'hdr-1' } }),
      ),
    );
    const c = make();
    const err = (await c.get('/v1/ping').catch((e: unknown) => e)) as PayPalError;
    expect(err.status).toBe(502);
    expect(err.debugId).toBe('hdr-1');
    expect(err.issues).toEqual([]);
    expect(err.code).toBeUndefined();
  });

  it('returns status, parsed body and debug id on success', async () => {
    server.use(
      tokenHandler(),
      http.get(`${BASE}/v1/ping`, () => HttpResponse.json({ x: 1 }, { headers: { 'paypal-debug-id': 'ok-1' } })),
    );
    const c = make();
    expect(await c.get('/v1/ping')).toEqual({ status: 200, body: { x: 1 }, debugId: 'ok-1' });
  });

  it('treats an empty 204 body as null', async () => {
    server.use(
      tokenHandler(),
      http.get(`${BASE}/v1/ping`, () => new HttpResponse(null, { status: 204 })),
    );
    const c = make();
    expect((await c.get('/v1/ping')).body).toBeNull();
  });
});

describe('findLink', () => {
  const links = [
    { rel: 'provide_evidence', method: 'POST', href: 'https://x/pe' },
    { rel: 'self', method: 'GET', href: 'https://x/self' },
    { rel: 'accept_claim', method: 'POST', href: 'https://x/ac' },
  ];
  it('finds by rel whatever the order', () => {
    expect(findLink({ links }, 'self')?.href).toBe('https://x/self');
    expect(findLink({ links: [...links].reverse() }, 'accept_claim')?.href).toBe('https://x/ac');
  });
  it('returns undefined when the rel is absent or links are missing', () => {
    expect(findLink({ links }, 'adjudicate')).toBeUndefined();
    expect(findLink({}, 'self')).toBeUndefined();
    expect(findLink({ links: [] }, 'self')).toBeUndefined();
    expect(findLink(null, 'self')).toBeUndefined();
  });
  it('works on a real dispute fixture', () => {
    const d = JSON.parse(readFileSync('tests/fixtures/paypal/dispute-before-provide-evidence-v2.json', 'utf8'));
    const body = d.links ? d : (d.response?.body ?? d.body ?? d);
    expect(findLink(body, 'provide_evidence')?.method).toBe('POST');
    expect(findLink(body, 'adjudicate')).toBeUndefined();
  });
});

describe('rereadUntil', () => {
  const noSleep = async () => {};
  it('does a fresh read each attempt and returns the first value that shows the change', async () => {
    let reads = 0;
    const out = await rereadUntil(
      async () => ({ state: ++reads < 3 ? 'OLD' : 'NEW' }),
      (v) => v.state === 'NEW',
      { attempts: 5, delayMs: 10, sleep: noSleep },
    );
    expect(out).toEqual({ state: 'NEW' });
    expect(reads).toBe(3);
  });
  it('throws PayPalChangeNotSeenError after the attempts run out, never returning stale state', async () => {
    let reads = 0;
    await expect(
      rereadUntil(
        async () => ({ n: ++reads }),
        () => false,
        { attempts: 4, delayMs: 10, sleep: noSleep },
      ),
    ).rejects.toBeInstanceOf(PayPalChangeNotSeenError);
    expect(reads).toBe(4);
  });
  it('waits between reads but not after the last one', async () => {
    const waits: number[] = [];
    await rereadUntil(
      async () => 1,
      () => false,
      { attempts: 3, delayMs: 250, sleep: async (ms) => void waits.push(ms) },
    ).catch(() => {});
    expect(waits).toEqual([250, 250]);
  });
  it('lets a read error propagate instead of hiding it', async () => {
    await expect(
      rereadUntil(
        async () => {
          throw new Error('boom');
        },
        () => true,
        { attempts: 3, delayMs: 1, sleep: noSleep },
      ),
    ).rejects.toThrow('boom');
  });
});

describe('RawJson', () => {
  it('sends the text as it is, byte for byte, instead of serialising it again', async () => {
    server.use(tokenHandler(), echo);
    const c = make();
    const raw = '{ "a" :  1,\n "b": "caf\u00e9", "n": 1.10 }'; // spacing, an escape and 1.10 would all change if re-serialised
    await c.post('/v1/ping', new RawJson(raw));
    expect(await apiCalls[0]!.text()).toBe(raw);
    expect(apiCalls[0]!.headers.get('content-type')).toContain('application/json');
  });
});

describe('multipart bodies (T-211)', () => {
  it('sends FormData with a multipart content type and boundary, not application/json', async () => {
    let seen: Request | undefined;
    server.use(
      tokenHandler(),
      http.post(`${BASE}/v1/customer/disputes/PP-X/provide-evidence`, async ({ request }) => {
        seen = request.clone();
        return HttpResponse.json({ links: [] });
      }),
    );
    const client = createPayPalClient({ clientId: 'id', clientSecret: 's', baseUrl: BASE, clock });
    const form = new FormData();
    form.set('input', new Blob([JSON.stringify({ a: 1 })], { type: 'application/json' }), 'input.json');
    form.set('evidence_file', new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' }), 'f.pdf');
    await client.post('/v1/customer/disputes/PP-X/provide-evidence', form, { requestId: 'key-1' });
    expect(seen!.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
    expect(seen!.headers.get('paypal-request-id')).toBe('key-1');
    const got = await seen!.formData();
    expect(JSON.parse(await (got.get('input') as File).text())).toEqual({ a: 1 });
    expect((got.get('evidence_file') as File).name).toBe('f.pdf');
  });
});
