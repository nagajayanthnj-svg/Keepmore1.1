import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDemo } from '../../src/demo/seed';
import type { Db } from '../../src/lib/db';
import { createPayPalClient } from '../../src/paypal/client';
import { handleShip, shipOrder, type ShipDeps } from '../../src/shipments/ship';
import { createTestDb } from '../helpers/test-db';

const BASE = 'https://paypal.test';
const fixture = (n: string) => JSON.parse(readFileSync(`tests/fixtures/paypal/${n}.json`, 'utf8'));
const trackRequest = fixture('track-request-carrier-india_post'); // real sandbox request
const trackResponse = fixture('track-response-carrier-india_post').body; // real 201 body, tracker 0HE26749YS519313U-EE123456789IN
const realError = fixture('provide-evidence-response-v2').response; // a real PayPal error body; the test sets the status
const PAYPAL_ORDER = '0MP44471063301822';
const CAPTURE = '0HE26749YS519313U';
const NOW = new Date('2026-10-21T10:00:00Z');

const server = setupServer();
let db: Db;
let close: () => Promise<void>;
let deps: ShipDeps;
let calls: { body: unknown; requestId: string | null; contentType: string | null }[] = [];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  calls = [];
  deps = {
    db,
    paypal: createPayPalClient({ clientId: 'id', clientSecret: 's', baseUrl: BASE }),
    clock: () => NOW,
  };
  server.use(http.post(`${BASE}/v1/oauth2/token`, () => HttpResponse.json({ access_token: 't', expires_in: 3600 })));
});
afterEach(async () => {
  server.resetHandlers();
  await close();
});

const order = (over: Partial<{ paypalOrderId: string; captureId: string | null }> = {}) =>
  db.order.create({
    data: {
      paypalOrderId: PAYPAL_ORDER,
      captureId: CAPTURE,
      itemsJson: '[]',
      country: 'US',
      grossMinor: 12000,
      currency: 'USD',
      ...over,
    },
  });
const trackOk = (response: unknown = trackResponse) =>
  server.use(
    http.post(`${BASE}/v2/checkout/orders/${PAYPAL_ORDER}/track`, async ({ request }) => {
      calls.push({
        body: await request.json(),
        requestId: request.headers.get('paypal-request-id'),
        contentType: request.headers.get('content-type'),
      });
      return HttpResponse.json(response as object, { status: 201 });
    }),
  );
const ship = (carrier = 'INDIA_POST', trackingNo = 'EE123456789IN') =>
  shipOrder(deps, { paypalOrderId: PAYPAL_ORDER, carrier, trackingNo });
const shipments = () => db.shipment.findMany();

describe('shipOrder: pushed', () => {
  it('sends exactly the request PayPal accepted in the sandbox, with a request id and JSON', async () => {
    await order();
    trackOk();
    const r = await ship();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual(trackRequest.body);
    expect(calls[0]!.requestId).toBe(`track-${CAPTURE}-EE123456789IN`);
    expect(calls[0]!.contentType).toContain('application/json');
    expect(r).toMatchObject({ kind: 'OK', outcome: 'PUSHED', pushStatus: 'PUSHED' });
  });

  it('records the push time from the injected clock and clears any error', async () => {
    await order();
    trackOk();
    await ship();
    const [s] = await shipments();
    expect(s).toMatchObject({
      pushStatus: 'PUSHED',
      pushError: null,
      carrier: 'INDIA_POST',
      trackingNo: 'EE123456789IN',
    });
    expect(s!.pushedToPaypalAt).toEqual(NOW);
    expect(s!.eventsJson).toBe('[]');
  });

  it('normalises the carrier and tracking number before saving and sending', async () => {
    await order();
    trackOk();
    await ship('India Post', 'ee 123-456 789 in');
    expect(calls[0]!.body).toEqual(trackRequest.body);
    expect((await shipments())[0]).toMatchObject({ carrier: 'INDIA_POST', trackingNo: 'EE123456789IN' });
  });

  it('keeps one shipment per order when shipped again', async () => {
    await order();
    trackOk();
    await ship();
    await ship();
    expect(await shipments()).toHaveLength(1);
  });
});

describe('shipOrder: local only, and still a success', () => {
  it('a PayPal 403 stores the error, saves the shipment and returns LOCAL_ONLY', async () => {
    await order();
    server.use(
      http.post(`${BASE}/v2/checkout/orders/${PAYPAL_ORDER}/track`, () =>
        HttpResponse.json(realError, { status: 403 }),
      ),
    );
    const r = await ship();
    expect(r).toMatchObject({ kind: 'OK', outcome: 'LOCAL_ONLY', pushStatus: 'REJECTED' });
    const [s] = await shipments();
    expect(s).toMatchObject({ pushStatus: 'REJECTED', pushedToPaypalAt: null, trackingNo: 'EE123456789IN' });
    expect(s!.pushError).toMatch(/^403 /);
  });

  it('a network failure is also stored, not thrown', async () => {
    await order();
    server.use(http.post(`${BASE}/v2/checkout/orders/${PAYPAL_ORDER}/track`, () => HttpResponse.error()));
    const r = await ship();
    expect(r).toMatchObject({ kind: 'OK', outcome: 'LOCAL_ONLY', pushStatus: 'REJECTED' });
    expect((await shipments())[0]!.pushError).toMatch(/^NETWORK/);
  });

  it('a 201 that does not show our tracker is not counted as pushed', async () => {
    await order();
    trackOk(); // the real response holds the tracker for EE123456789IN, not this one
    const r = await ship('INDIA_POST', 'EE999999999IN');
    expect(r).toMatchObject({ outcome: 'LOCAL_ONLY', pushStatus: 'REJECTED' });
    const [s] = await shipments();
    expect(s!.pushedToPaypalAt).toBeNull();
    expect(s!.pushError).toBe('TRACKER_NOT_CONFIRMED');
  });

  it.each<[string, { carrier?: string }, { paypalOrderId?: string; captureId?: string | null }, string]>([
    [
      'an OTHER carrier (no PayPal request has been seen for it)',
      { carrier: 'Royal Mail' },
      {},
      'CARRIER_NOT_PUSHABLE',
    ],
    ['the demo carrier', { carrier: 'DEMO' }, {}, 'CARRIER_NOT_PUSHABLE'],
    ['a demo order', {}, { paypalOrderId: 'DEMO-ORD-0001' }, 'DEMO_ORDER'],
    ['an order that was never captured', {}, { captureId: null }, 'NO_CAPTURE'],
  ])('%s is saved and never sent', async (_name, input, orderOver, reason) => {
    const o = await order(orderOver);
    const r = await shipOrder(deps, {
      paypalOrderId: o.paypalOrderId,
      carrier: input.carrier ?? 'INDIA_POST',
      trackingNo: 'EE123456789IN',
    }); // an unhandled PayPal request would fail the test
    expect(r).toMatchObject({ kind: 'OK', outcome: 'LOCAL_ONLY', pushStatus: 'NOT_ATTEMPTED', reason });
    expect((await shipments())[0]).toMatchObject({ pushStatus: 'NOT_ATTEMPTED', pushedToPaypalAt: null });
  });

  it('works without PayPal credentials', async () => {
    await order();
    const r = await shipOrder(
      { ...deps, paypal: null },
      { paypalOrderId: PAYPAL_ORDER, carrier: 'INDIA_POST', trackingNo: 'EE123456789IN' },
    );
    expect(r).toMatchObject({ outcome: 'LOCAL_ONLY', pushStatus: 'NOT_ATTEMPTED', reason: 'PAYPAL_NOT_CONFIGURED' });
  });

  it('a later successful push clears the earlier error', async () => {
    await order();
    server.use(
      http.post(`${BASE}/v2/checkout/orders/${PAYPAL_ORDER}/track`, () =>
        HttpResponse.json(realError, { status: 403 }),
      ),
    );
    await ship();
    server.resetHandlers();
    server.use(http.post(`${BASE}/v1/oauth2/token`, () => HttpResponse.json({ access_token: 't', expires_in: 3600 })));
    trackOk();
    await ship();
    expect((await shipments())[0]).toMatchObject({ pushStatus: 'PUSHED', pushError: null });
  });
});

describe('handleShip', () => {
  const req = (body: unknown) =>
    new Request('http://x', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

  it('answers 200 with the outcome', async () => {
    await order();
    trackOk();
    const res = await handleShip(req({ carrier: 'India Post', trackingNo: 'EE123456789IN' }), PAYPAL_ORDER, deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: 'PUSHED', pushStatus: 'PUSHED' });
  });

  it('answers 200 LOCAL_ONLY when PayPal rejects', async () => {
    await order();
    server.use(
      http.post(`${BASE}/v2/checkout/orders/${PAYPAL_ORDER}/track`, () =>
        HttpResponse.json(realError, { status: 403 }),
      ),
    );
    const res = await handleShip(req({ carrier: 'INDIA_POST', trackingNo: 'EE123456789IN' }), PAYPAL_ORDER, deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: 'LOCAL_ONLY', pushStatus: 'REJECTED' });
  });

  it('answers 404 for an unknown order and saves nothing', async () => {
    const res = await handleShip(req({ carrier: 'INDIA_POST', trackingNo: 'EE123456789IN' }), 'NOPE', deps);
    expect(res.status).toBe(404);
    expect(await shipments()).toHaveLength(0);
  });

  it.each([
    ['not JSON', 'nope'],
    ['no tracking number', { carrier: 'INDIA_POST' }],
    ['no carrier', { trackingNo: 'EE123456789IN' }],
    ['a tracking number with symbols', { carrier: 'INDIA_POST', trackingNo: 'EE12<script>' }],
    ['a tracking number that is too short', { carrier: 'INDIA_POST', trackingNo: 'A1' }],
    ['a carrier name that is too long', { carrier: 'x'.repeat(61), trackingNo: 'EE123456789IN' }],
  ])('answers 400 for %s and saves nothing', async (_n, body) => {
    await order();
    const res = await handleShip(req(body), PAYPAL_ORDER, deps);
    expect(res.status).toBe(400);
    expect(await shipments()).toHaveLength(0);
  });

  it('answers 400 for a hostile order id in the URL without touching the database', async () => {
    const res = await handleShip(
      req({ carrier: 'INDIA_POST', trackingNo: 'EE123456789IN' }),
      "x'; DROP TABLE Order;--",
      deps,
    );
    expect(res.status).toBe(400);
  });
});

describe('resetDemo with a demo shipment', () => {
  it('removes the shipment with its order instead of failing on the foreign key', async () => {
    const o = await order({ paypalOrderId: 'DEMO-ORD-0001', captureId: 'DEMO-CAP-0001' });
    await shipOrder(deps, { paypalOrderId: o.paypalOrderId, carrier: 'DEMO', trackingNo: 'DEMO12345' });
    await resetDemo(db, { demoMode: true });
    expect(await db.order.count()).toBe(0);
    expect(await shipments()).toHaveLength(0);
  });
});
