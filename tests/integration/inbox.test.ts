import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadInbox } from '../../src/disputes/inbox';
import type { Db } from '../../src/lib/db';
import { createTestDb } from '../helpers/test-db';

let db: Db;
let close: () => Promise<void>;
const NOW = new Date('2026-10-20T12:00:00.000Z');
const ago = (s: number) => new Date(NOW.getTime() - s * 1000);

beforeEach(async () => ({ db, close } = await createTestDb()));
afterEach(async () => close());

const mk = (id: string, over: Record<string, unknown> = {}) =>
  db.disputeCase.create({
    data: {
      paypalDisputeId: id,
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      stage: 'CHARGEBACK',
      status: 'WAITING_FOR_SELLER_RESPONSE',
      amountMinor: 12000,
      currency: 'USD',
      allowedActionsJson: '{}',
      requestedEvidence: '[]',
      lastSyncedAt: ago(10),
      rawHash: 'x',
      ...over,
    },
  });
const order = (paypalOrderId: string) =>
  db.order.create({
    data: {
      paypalOrderId,
      captureId: `${paypalOrderId}-C`,
      itemsJson: '[]',
      country: 'US',
      grossMinor: 1,
      currency: 'USD',
    },
  });

describe('loadInbox', () => {
  it('is empty when there are no cases', async () => {
    expect(await loadInbox(db, NOW)).toEqual({ ready: true, rows: [] });
  });

  it('sorts by deadline and carries what the inbox shows', async () => {
    await mk('PP-LATE', { sellerDeadline: new Date('2026-10-25T00:00:00.000Z') });
    await mk('PP-SOON', { sellerDeadline: new Date('2026-10-22T18:29:59.000Z'), amountMinor: 3000 });
    await mk('PP-DONE', { status: 'RESOLVED', outcomeCode: 'RESOLVED_BUYER_FAVOUR' });
    const v = await loadInbox(db, NOW);
    if (!v.ready) throw new Error('not ready');
    expect(v.rows.map((r) => r.disputeId)).toEqual(['PP-SOON', 'PP-LATE', 'PP-DONE']);
    expect(v.rows[0]).toMatchObject({
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      stage: 'CHARGEBACK',
      status: 'WAITING_FOR_SELLER_RESPONSE',
      amountMinor: 3000,
      currency: 'USD',
      deadline: '2026-10-22T18:29:59.000Z',
      orderId: null,
    });
  });

  it('marks a case stale from 5 minutes after its last sync, and gives its age', async () => {
    await mk('PP-FRESH', { lastSyncedAt: ago(299) });
    await mk('PP-STALE', { lastSyncedAt: ago(300) });
    const v = await loadInbox(db, NOW);
    if (!v.ready) throw new Error('not ready');
    const by = Object.fromEntries(v.rows.map((r) => [r.disputeId, r]));
    expect(by['PP-FRESH']).toMatchObject({ stale: false, ageSeconds: 299 });
    expect(by['PP-STALE']).toMatchObject({ stale: true, ageSeconds: 300 });
  });

  it('labels the amount Simulated demo for a demo order and Verified by PayPal otherwise', async () => {
    const demo = await order('DEMO-ORD-1');
    const real = await order('REALORD');
    await mk('PP-DEMO', { orderId: demo.id });
    await mk('PP-REAL', { orderId: real.id });
    await mk('PP-NOORDER');
    const v = await loadInbox(db, NOW);
    if (!v.ready) throw new Error('not ready');
    const by = Object.fromEntries(v.rows.map((r) => [r.disputeId, r]));
    expect(by['PP-DEMO']).toMatchObject({ truthState: 'Simulated demo', orderId: demo.id });
    expect(by['PP-REAL']).toMatchObject({ truthState: 'Verified by PayPal', orderId: real.id });
    expect(by['PP-NOORDER']).toMatchObject({ truthState: 'Verified by PayPal', orderId: null });
  });

  it('answers ready:false, not an error, when the tables do not exist', async () => {
    await db.$executeRawUnsafe('DROP TABLE "DisputeCase"');
    expect(await loadInbox(db, NOW)).toEqual({ ready: false });
  });
});
