import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pollOnce } from '../../src/disputes/poller';
import { syncDispute, type SyncDeps } from '../../src/disputes/sync';
import type { Db } from '../../src/lib/db';
import { buyerHash } from '../../src/orders/buyer-hash';
import { createPayPalClient } from '../../src/paypal/client';
import { createTestDb } from '../helpers/test-db';

const BASE = 'https://paypal.test';
const SECRET = 'k'.repeat(32);
const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/paypal/${n}.json`, 'utf8'));
const claim = fx('dispute-details-first'); // IUT: seller_transaction_id 0HE26749YS519313U, payer REDACTED_PAYER_ID
const ID = 'PP-R-IUT-10193562';
const CAPTURE = '0HE26749YS519313U';

const server = setupServer();
let db: Db;
let close: () => Promise<void>;
let deps: SyncDeps;
let body: unknown;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  body = claim;
  deps = { db, paypal: createPayPalClient({ clientId: 'id', clientSecret: 's', baseUrl: BASE }), hmacSecret: SECRET };
  server.use(
    http.post(`${BASE}/v1/oauth2/token`, () => HttpResponse.json({ access_token: 't', expires_in: 3600 })),
    http.get(`${BASE}/v1/customer/disputes/:id`, () => HttpResponse.json(body as object)),
    http.get(`${BASE}/v1/customer/disputes`, () => HttpResponse.json({ items: [{ dispute_id: ID }] })),
  );
});
afterEach(async () => {
  server.resetHandlers();
  await close();
});

const order = (over: Record<string, unknown> = {}) =>
  db.order.create({
    data: {
      paypalOrderId: 'ORD1',
      captureId: CAPTURE,
      itemsJson: '[]',
      country: 'US',
      grossMinor: 12000,
      currency: 'USD',
      ...over,
    },
  });
const theCase = () => db.disputeCase.findUniqueOrThrow({ where: { paypalDisputeId: ID } });

describe('syncDispute links a dispute to its order by transaction id', () => {
  it('matches seller_transaction_id to the order capture id and sets the buyer hash', async () => {
    const o = await order({ buyerHash: buyerHash(SECRET, 'REDACTED_PAYER_ID') });
    await syncDispute(deps, ID);
    const c = await theCase();
    expect(c.orderId).toBe(o.id);
    expect(c.buyerHash).toBe(buyerHash(SECRET, 'REDACTED_PAYER_ID'));
    expect(c.buyerHash).toBe(o.buyerHash); // the same buyer hashes the same on an order and a dispute
  });

  it('keeps an unmatched dispute, flagged by having no order, with its buyer hash', async () => {
    await syncDispute(deps, ID);
    const c = await theCase();
    expect(c.orderId).toBeNull();
    expect(c.buyerHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('links on a later sync when the order appeared after the dispute, even if nothing else changed', async () => {
    await syncDispute(deps, ID);
    const o = await order();
    const r = await syncDispute(deps, ID);
    expect(r.changed).toBe(false);
    expect((await theCase()).orderId).toBe(o.id);
  });

  it('never moves or clears a link that is already set', async () => {
    const o = await order();
    await syncDispute(deps, ID);
    await order({ paypalOrderId: 'ORD2', captureId: '3FG688039F4865201' });
    const other = JSON.parse(JSON.stringify(claim));
    other.disputed_transactions[0].seller_transaction_id = '3FG688039F4865201';
    body = other;
    await syncDispute(deps, ID);
    expect((await theCase()).orderId).toBe(o.id);
    body = { ...claim, disputed_transactions: [] };
    await syncDispute(deps, ID);
    expect((await theCase()).orderId).toBe(o.id);
  });

  it('still links by transaction id, with no buyer hash, when HMAC_SECRET is not usable', async () => {
    const o = await order();
    await syncDispute({ ...deps, hmacSecret: undefined }, ID);
    await db.disputeCase.deleteMany();
    await syncDispute({ ...deps, hmacSecret: 'short' }, ID);
    const c = await theCase();
    expect(c.orderId).toBe(o.id);
    expect(c.buyerHash).toBeNull();
  });

  it('does not link when the payload names no transaction', async () => {
    await order();
    body = { ...claim, disputed_transactions: [] };
    await syncDispute(deps, ID);
    const c = await theCase();
    expect(c.orderId).toBeNull();
    expect(c.buyerHash).toBeNull();
  });
});

describe('the database holds no email or raw payer id', () => {
  it('stores only the hash, whatever the payload carries', async () => {
    const hostile = JSON.parse(JSON.stringify(claim));
    hostile.disputed_transactions[0].buyer = { email: 'buyer@example.com', payer_id: 'PAYERABC123', name: 'Jane Doe' };
    hostile.disputed_transactions[0].seller.email = 'seller@example.com';
    body = hostile;
    await order();
    await syncDispute(deps, ID);
    const dump = JSON.stringify({
      cases: await db.disputeCase.findMany(),
      orders: await db.order.findMany(),
      events: await db.webhookEvent.findMany(),
      audit: await db.auditEvent.findMany(),
    });
    expect(dump).not.toContain('@');
    expect(dump).not.toContain('PAYERABC123');
    expect(dump).not.toContain('Jane Doe');
    expect(dump).toContain(buyerHash(SECRET, 'PAYERABC123'));
  });
});

describe('pollOnce keeps trying to link a case that has no order', () => {
  it('re-reads a resolved case with no order, and links it once the order exists', async () => {
    body = fx('t009-PP-R-IUT-10193562-accept-3-final');
    await syncDispute(deps, ID);
    expect((await theCase()).status).toBe('RESOLVED');
    expect((await pollOnce(deps)).synced).toBe(1); // unmatched: still read
    const o = await order();
    await pollOnce(deps);
    expect((await theCase()).orderId).toBe(o.id);
    expect((await pollOnce(deps)).synced).toBe(0); // resolved and matched: left alone
  });
});
