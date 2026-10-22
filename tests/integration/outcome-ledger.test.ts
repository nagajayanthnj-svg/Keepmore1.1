import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { syncDispute, type SyncDeps } from '../../src/disputes/sync';
import type { Db } from '../../src/lib/db';
import { createPayPalClient } from '../../src/paypal/client';
import { createTestDb } from '../helpers/test-db';

const BASE = 'https://paypal.test';
const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/paypal/${n}.json`, 'utf8'));
const LOST = fx('t009-PP-R-IUT-10193562-accept-3-final'); // RESOLVED_BUYER_FAVOUR; seller debited 120.00 + 5.88 fee
const WON = fx('t009-PP-R-RAV-10193566-adjudicate-3-final'); // RESOLVED_SELLER_FAVOUR; hold 47.34 released; no refund
const OPEN = fx('t009-PP-R-RAV-10193566-adjudicate-1-before'); // same dispute, still open
const bodies: Record<string, unknown> = {};

const server = setupServer();
let db: Db;
let close: () => Promise<void>;
let deps: SyncDeps;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  bodies['PP-R-IUT-10193562'] = LOST;
  bodies['PP-R-RAV-10193566'] = WON;
  deps = { db, paypal: createPayPalClient({ clientId: 'id', clientSecret: 's', baseUrl: BASE }) };
  server.use(
    http.post(`${BASE}/v1/oauth2/token`, () => HttpResponse.json({ access_token: 't', expires_in: 3600 })),
    http.get(`${BASE}/v1/customer/disputes/:id`, ({ params }) => HttpResponse.json(bodies[String(params.id)] as object)),
  );
});
afterEach(async () => {
  server.resetHandlers();
  await close();
});

const order = (captureId: string, grossMinor: number) =>
  db.order.create({
    data: {
      paypalOrderId: `ORD-${captureId}`,
      captureId,
      itemsJson: '[]',
      country: 'US',
      grossMinor,
      currency: 'USD',
      buyerHash: 'b'.repeat(64),
      sellerProtection: 'ELIGIBLE',
    },
  });
const entries = (orderId: string) => db.ledgerEntry.findMany({ where: { orderId }, orderBy: { type: 'asc' } });

describe('outcome entries on sync (T-403)', () => {
  it('a lost dispute adds the settlement and the fee PayPal debited, verified, and no RETAINED', async () => {
    const o = await order('0HE26749YS519313U', 12000);
    await syncDispute(deps, 'PP-R-IUT-10193562');
    const e = await entries(o.id);
    expect(e.map((x) => [x.type, x.amountMinor, x.sourceType, x.sourceRef])).toEqual([
      ['DISPUTE_FEE', -588, 'PAYPAL_VERIFIED', 'PP-R-IUT-10193562'],
      ['REFUND', -12000, 'PAYPAL_VERIFIED', 'PP-R-IUT-10193562'],
    ]);
    expect(e.every((x) => x.occurredAt.toISOString() === '2026-10-19T18:54:49.200Z')).toBe(true);
  });

  it('a won dispute with no refund adds one RETAINED entry for the disputed amount', async () => {
    const o = await order('3FG688039F4865201', 5000);
    await syncDispute(deps, 'PP-R-RAV-10193566');
    const e = await entries(o.id);
    expect(e.map((x) => [x.type, x.amountMinor, x.sourceRef])).toEqual([['RETAINED', 5000, 'PP-R-RAV-10193566']]);
  });

  it('the raw outcome code is always stored on the case', async () => {
    await syncDispute(deps, 'PP-R-RAV-10193566');
    expect((await db.disputeCase.findUniqueOrThrow({ where: { paypalDisputeId: 'PP-R-RAV-10193566' } })).outcomeCode).toBe(
      'RESOLVED_SELLER_FAVOUR',
    );
  });

  it('syncing again adds nothing (append-only ledger, one set per dispute)', async () => {
    const o = await order('0HE26749YS519313U', 12000);
    await syncDispute(deps, 'PP-R-IUT-10193562');
    await syncDispute(deps, 'PP-R-IUT-10193562');
    expect(await entries(o.id)).toHaveLength(2);
  });

  it('an open dispute adds nothing; it is recorded once it resolves', async () => {
    const o = await order('3FG688039F4865201', 5000);
    bodies['PP-R-RAV-10193566'] = OPEN;
    await syncDispute(deps, 'PP-R-RAV-10193566');
    expect(await entries(o.id)).toHaveLength(0);
    bodies['PP-R-RAV-10193566'] = WON;
    await syncDispute(deps, 'PP-R-RAV-10193566');
    expect(await entries(o.id)).toHaveLength(1);
  });

  it('a dispute with no linked order adds nothing (the ledger is per order)', async () => {
    await syncDispute(deps, 'PP-R-IUT-10193562');
    expect(await db.ledgerEntry.count()).toBe(0);
  });

  it('a won dispute whose capture already has a refund in the ledger is not RETAINED', async () => {
    const o = await order('3FG688039F4865201', 5000);
    await db.ledgerEntry.create({
      data: {
        orderId: o.id,
        type: 'REFUND',
        amountMinor: -5000,
        currency: 'USD',
        sourceType: 'PAYPAL_VERIFIED',
        sourceRef: 'REFUND-1',
        calcVersion: 'test',
        occurredAt: new Date('2026-10-19T17:00:00Z'),
      },
    });
    await syncDispute(deps, 'PP-R-RAV-10193566');
    expect((await entries(o.id)).filter((x) => x.type === 'RETAINED')).toHaveLength(0);
  });
});
