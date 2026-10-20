import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/lib/db';
import { handleCapture, handleCreate, type CheckoutDeps } from '../../src/orders/handlers';
import { createPayPalClient } from '../../src/paypal/client';
import { createTestDb } from '../helpers/test-db';

const BASE = 'https://paypal.test';
const fixture = (n: string) => JSON.parse(readFileSync(`tests/fixtures/paypal/${n}.json`, 'utf8'));
const captureFixture = fixture('capture-usd-primary'); // 120.00 USD, fee 5.88
const realError = fixture('provide-evidence-response-v2').response; // real 400 INVALID_REQUEST

const server = setupServer();
let db: Db;
let close: () => Promise<void>;
let deps: CheckoutDeps;
interface Unit {
  amount: { currency_code: string; value: string; breakdown?: unknown };
  items: unknown[];
}
interface OrderBody {
  intent: string;
  purchase_units: Unit[];
}
let created: { body: OrderBody; requestId: string | null }[] = [];
let captureCalls = 0;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
// A fresh database per test: PayPal order ids repeat across tests and the ledger cannot be cleaned.
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  created = [];
  captureCalls = 0;
  deps = {
    db,
    paypal: createPayPalClient({ clientId: 'id', clientSecret: 's', baseUrl: BASE }),
    hmacSecret: 'h'.repeat(32),
  };
  server.use(
    http.post(`${BASE}/v1/oauth2/token`, () => HttpResponse.json({ access_token: 't', expires_in: 3600 })),
    http.post(`${BASE}/v2/checkout/orders`, async ({ request }) => {
      created.push({ body: (await request.json()) as OrderBody, requestId: request.headers.get('paypal-request-id') });
      return HttpResponse.json({ id: `PPORDER${created.length}`, status: 'CREATED', links: [] }, { status: 201 });
    }),
  );
});
afterEach(async () => {
  server.resetHandlers();
  await close();
});

const post = (body: unknown) =>
  new Request('http://x/api/orders', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const cart120 = [
  { sku: 'BP1001', qty: 1 },
  { sku: 'BP1003', qty: 2 },
]; // 64.00 + 2 x 28.00 = 120.00
const captureOk = () =>
  server.use(
    http.post(`${BASE}/v2/checkout/orders/:id/capture`, () => {
      captureCalls += 1;
      return HttpResponse.json(captureFixture, { status: 201 });
    }),
  );
const rows = async (sql: string) => db.$queryRawUnsafe<Record<string, unknown>[]>(sql);

describe('create order', () => {
  it('prices the cart on the server and sends PayPal the amount, items and a request id', async () => {
    const res = await handleCreate(post({ items: cart120 }), deps);
    expect(res.status).toBe(201);
    const sent = created[0]!.body;
    expect(sent.intent).toBe('CAPTURE');
    const unit = sent.purchase_units[0]!;
    expect(unit.amount).toEqual({
      currency_code: 'USD',
      value: '120.00',
      breakdown: { item_total: { currency_code: 'USD', value: '120.00' } },
    });
    expect(unit.items).toEqual([
      {
        name: 'Blue pottery vase, large',
        sku: 'BP1001',
        quantity: '1',
        category: 'PHYSICAL_GOODS',
        unit_amount: { currency_code: 'USD', value: '64.00' },
      },
      {
        name: 'Hand-painted mug, set of 2',
        sku: 'BP1003',
        quantity: '2',
        category: 'PHYSICAL_GOODS',
        unit_amount: { currency_code: 'USD', value: '28.00' },
      },
    ]);
    expect(created[0]!.requestId).toBeTruthy();
  });

  it('answers with the PayPal order id only, and stores a local order with no capture yet', async () => {
    const res = await handleCreate(post({ items: cart120 }), deps);
    expect(await res.json()).toEqual({ id: 'PPORDER1' });
    const o = await db.order.findUniqueOrThrow({ where: { paypalOrderId: 'PPORDER1' } });
    expect(o).toMatchObject({ grossMinor: 12000, currency: 'USD', captureId: null, buyerHash: null, country: 'ZZ' });
    expect(JSON.parse(o.itemsJson)).toEqual([
      { sku: 'BP1001', qty: 1, unitMinor: 6400 },
      { sku: 'BP1003', qty: 2, unitMinor: 2800 },
    ]);
  });

  it('ignores any amount, price or total the browser sends', async () => {
    await handleCreate(
      post({ items: cart120, amount: '0.01', total: 1, price: '0.01', unitMinor: 1, currency: 'EUR', items_extra: [] }),
      deps,
    );
    expect(created[0]!.body.purchase_units[0]!.amount.value).toBe('120.00');
    expect(created[0]!.body.purchase_units[0]!.amount.currency_code).toBe('USD');
    const withPrice = [{ sku: 'BP1001', qty: 1, unitMinor: 1, price: '0.01' }];
    await handleCreate(post({ items: withPrice }), deps);
    expect(created[1]!.body.purchase_units[0]!.amount.value).toBe('64.00');
  });

  it('merges repeated SKUs into one line', async () => {
    await handleCreate(
      post({
        items: [
          { sku: 'BP1003', qty: 1 },
          { sku: 'BP1003', qty: 2 },
        ],
      }),
      deps,
    );
    expect(created[0]!.body.purchase_units[0]!.items).toHaveLength(1);
    expect(created[0]!.body.purchase_units[0]!.amount.value).toBe('84.00');
  });

  it.each([
    ['not JSON', 'nope'],
    ['no items', {}],
    ['empty cart', { items: [] }],
    ['unknown SKU', { items: [{ sku: 'BP9999', qty: 1 }] }],
    ['SKU with a dash', { items: [{ sku: 'BP-1001', qty: 1 }] }],
    ['zero quantity', { items: [{ sku: 'BP1001', qty: 0 }] }],
    ['fractional quantity', { items: [{ sku: 'BP1001', qty: 1.5 }] }],
    ['string quantity', { items: [{ sku: 'BP1001', qty: '2' }] }],
    ['negative quantity', { items: [{ sku: 'BP1001', qty: -1 }] }],
    ['quantity above the limit', { items: [{ sku: 'BP1001', qty: 11 }] }],
    ['too many lines', { items: Array.from({ length: 9 }, () => ({ sku: 'BP1001', qty: 1 })) }],
  ])('rejects %s with 400 and calls PayPal never', async (_n, body) => {
    const before = await db.order.count();
    const res = await handleCreate(post(body), deps);
    expect(res.status).toBe(400);
    expect(created).toHaveLength(0);
    expect(await db.order.count()).toBe(before);
  });

  it('turns a PayPal failure into 502 with the debug id, and keeps no local order', async () => {
    server.use(http.post(`${BASE}/v2/checkout/orders`, () => HttpResponse.json(realError.body, { status: 400 })));
    const before = await db.order.count();
    const res = await handleCreate(post({ items: cart120 }), deps);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'PAYPAL_ERROR', debugId: realError.body.debug_id });
    expect(await db.order.count()).toBe(before);
  });
});

describe('capture order', () => {
  it('captures, then stores ids, country, a keyed buyer hash, seller protection and the ledger entries', async () => {
    captureOk();
    await handleCreate(post({ items: cart120 }), deps);
    const res = await handleCapture('PPORDER1', deps);
    expect(res.status).toBe(200);
    const o = await db.order.findUniqueOrThrow({ where: { paypalOrderId: 'PPORDER1' }, include: { ledger: true } });
    expect(o.captureId).toBe('0HE26749YS519313U');
    expect(o.country).toBe('US');
    expect(o.sellerProtection).toBe('ELIGIBLE');
    expect(o.buyerHash).toMatch(/^[0-9a-f]{64}$/);
    expect(o.ledger.map((l) => [l.type, l.amountMinor, l.sourceType]).sort()).toEqual([
      ['GROSS', 12000, 'PAYPAL_VERIFIED'],
      ['PAYPAL_FEE', 588, 'PAYPAL_VERIFIED'],
    ]);
  });

  it('never stores or returns the raw payer id, email, name or address', async () => {
    captureOk();
    await handleCreate(post({ items: cart120 }), deps);
    const res = await handleCapture('PPORDER1', deps);
    const text = JSON.stringify(await res.json());
    for (const raw of [
      'REDACTED_PAYER_ID',
      'REDACTED_EMAIL_ADDRESS',
      'REDACTED_GIVEN_NAME',
      'REDACTED_SURNAME',
      'REDACTED_ACCOUNT_ID',
    ]) {
      expect(text).not.toContain(raw);
    }
    for (const table of ['Order', 'LedgerEntry', 'AuditEvent']) {
      const dump = JSON.stringify(await rows(`SELECT * FROM "${table}"`));
      for (const raw of ['REDACTED_PAYER_ID', 'REDACTED_EMAIL_ADDRESS', 'REDACTED_GIVEN_NAME', 'REDACTED_SURNAME']) {
        expect(dump).not.toContain(raw);
      }
    }
  });

  it('answers with what the seller may see: capture id, status, gross and the order id', async () => {
    captureOk();
    await handleCreate(post({ items: cart120 }), deps);
    const body = await (await handleCapture('PPORDER1', deps)).json();
    expect(body).toEqual({
      orderId: 'PPORDER1',
      captureId: '0HE26749YS519313U',
      status: 'COMPLETED',
      grossMinor: 12000,
      currency: 'USD',
    });
  });

  it('is safe to call twice: PayPal is captured once and the ledger has two rows', async () => {
    captureOk();
    await handleCreate(post({ items: cart120 }), deps);
    const first = await (await handleCapture('PPORDER1', deps)).json();
    const second = await (await handleCapture('PPORDER1', deps)).json();
    expect(second).toEqual(first);
    expect(captureCalls).toBe(1);
    const o = await db.order.findUniqueOrThrow({ where: { paypalOrderId: 'PPORDER1' }, include: { ledger: true } });
    expect(o.ledger).toHaveLength(2);
  });

  it('404s for an order we never created, without calling PayPal', async () => {
    captureOk();
    const res = await handleCapture('NOSUCHORDER', deps);
    expect(res.status).toBe(404);
    expect(captureCalls).toBe(0);
  });

  it('refuses a capture whose amount differs from the server-priced order, and writes nothing', async () => {
    captureOk(); // the fixture captures 120.00
    await handleCreate(post({ items: [{ sku: 'BP1001', qty: 1 }] }), deps); // we priced 64.00
    const res = await handleCapture('PPORDER1', deps);
    expect(res.status).toBe(409);
    const o = await db.order.findUniqueOrThrow({ where: { paypalOrderId: 'PPORDER1' }, include: { ledger: true } });
    expect(o.captureId).toBeNull();
    expect(o.ledger).toHaveLength(0);
  });

  it('turns a PayPal capture error into 502 and leaves the order uncaptured', async () => {
    server.use(
      http.post(`${BASE}/v2/checkout/orders/:id/capture`, () => HttpResponse.json(realError.body, { status: 400 })),
    );
    await handleCreate(post({ items: cart120 }), deps);
    const res = await handleCapture('PPORDER1', deps);
    expect(res.status).toBe(502);
    const o = await db.order.findUniqueOrThrow({ where: { paypalOrderId: 'PPORDER1' }, include: { ledger: true } });
    expect(o.captureId).toBeNull();
    expect(o.ledger).toHaveLength(0);
  });

  it('fails closed when HMAC_SECRET is missing: no capture call, no order change', async () => {
    captureOk();
    await handleCreate(post({ items: cart120 }), deps);
    const res = await handleCapture('PPORDER1', { ...deps, hmacSecret: undefined });
    expect(res.status).toBe(500);
    expect(captureCalls).toBe(0);
  });
});
