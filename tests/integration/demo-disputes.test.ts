import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedDemoDisputes } from '../../src/demo/disputes';
import { resetDemo, seedDemo } from '../../src/demo/seed';
import { handleManualSync } from '../../src/disputes/manual-sync';
import { loadInbox } from '../../src/disputes/inbox';
import type { Db } from '../../src/lib/db';
import { createTestDb } from '../helpers/test-db';

let db: Db;
let close: () => Promise<void>;
const NOW = new Date('2026-10-20T12:00:00.000Z');

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await seedDemo(db);
});
afterEach(async () => close());

describe('seedDemoDisputes', () => {
  it('adds three demo cases linked to demo orders, once', async () => {
    expect(await seedDemoDisputes(db, NOW)).toEqual({ cases: 3 });
    expect(await seedDemoDisputes(db, NOW)).toEqual({ cases: 0 });
    const cases = await db.disputeCase.findMany({ include: { order: true }, orderBy: { paypalDisputeId: 'asc' } });
    expect(cases.map((c) => c.paypalDisputeId)).toEqual(['PP-DEMO-0001', 'PP-DEMO-0002', 'PP-DEMO-0003']);
    expect(cases.every((c) => c.order?.paypalOrderId.startsWith('DEMO-'))).toBe(true);
  });

  it('shows in the inbox as Simulated demo, one fresh, one stale, one resolved, with a deadline on the open chargeback', async () => {
    await seedDemoDisputes(db, NOW);
    const v = await loadInbox(db, NOW);
    if (!v.ready) throw new Error('not ready');
    expect(v.rows).toHaveLength(3);
    expect(v.rows.every((r) => r.truthState === 'Simulated demo')).toBe(true);
    expect(v.rows.map((r) => r.stale).sort()).toEqual([false, true, true]);
    expect(v.rows[0]).toMatchObject({ stage: 'CHARGEBACK', status: 'WAITING_FOR_SELLER_RESPONSE' });
    expect(v.rows[0]!.deadline).not.toBeNull();
    expect(v.rows.at(-1)).toMatchObject({ status: 'RESOLVED' });
  });

  it('gives the open demo cases what a real case has: allowed actions, requested evidence and an invented shipment', async () => {
    await seedDemoDisputes(db, NOW);
    const one = await db.disputeCase.findUniqueOrThrow({ where: { paypalDisputeId: 'PP-DEMO-0001' }, include: { order: { include: { shipment: true } } } });
    expect(JSON.parse(one.allowedActionsJson).actions.map((a: { action: string }) => a.action)).toEqual(['ACCEPT_CLAIM', 'PROVIDE_EVIDENCE']);
    expect(JSON.parse(one.requestedEvidence)).toEqual(['PROOF_OF_FULFILLMENT', 'PROOF_OF_DELIVERY_SIGNATURE']);
    expect(one.order?.shipment?.trackingNo).toMatch(/^DEMO/);
    const events = JSON.parse(one.order!.shipment!.eventsJson) as { status: string; source: string }[];
    expect(events.map((e) => e.status)).toEqual(['IN_TRANSIT', 'DELIVERED']);
    expect(events.every((e) => e.source === 'DEMO')).toBe(true);
    // A believable story: shipped a day after the order, tracking events after that, all within a few weeks.
    const ordered = one.order!.createdAt.getTime();
    const shipped = one.order!.shipment!.pushedToPaypalAt!.getTime();
    expect(shipped).toBeGreaterThan(ordered);
    for (const e of events as unknown as { at: string }[]) {
      expect(Date.parse(e.at)).toBeGreaterThan(shipped);
      expect(Date.parse(e.at) - ordered).toBeLessThan(30 * 86_400_000);
    }
    const two = await db.disputeCase.findUniqueOrThrow({ where: { paypalDisputeId: 'PP-DEMO-0002' } });
    expect(JSON.parse(two.allowedActionsJson).actions.map((a: { action: string }) => a.action)).toEqual(['ACCEPT_CLAIM', 'SEND_MESSAGE', 'ESCALATE']);
    const three = await db.disputeCase.findUniqueOrThrow({ where: { paypalDisputeId: 'PP-DEMO-0003' } });
    expect(JSON.parse(three.allowedActionsJson).actions).toEqual([]);
  });

  it('is removed by the demo reset', async () => {
    await seedDemoDisputes(db, NOW);
    await resetDemo(db, { demoMode: true });
    expect(await db.disputeCase.count()).toBe(0);
  });

  it('is never sent to PayPal: the sync button says DEMO_CASE', async () => {
    const res = await handleManualSync(null, 'PP-DEMO-0001');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'DEMO_CASE' });
  });
});
