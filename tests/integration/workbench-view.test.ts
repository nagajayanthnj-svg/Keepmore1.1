import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedDemoDisputes } from '../../src/demo/disputes';
import { seedDemo } from '../../src/demo/seed';
import { loadWorkbench } from '../../src/disputes/workbench';
import type { Db } from '../../src/lib/db';
import { createTestDb } from '../helpers/test-db';

let db: Db;
let close: () => Promise<void>;
const NOW = new Date('2026-10-20T12:00:00.000Z');
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await seedDemo(db);
  await seedDemoDisputes(db, NOW);
});
afterEach(async () => close());

describe('loadWorkbench (T-401)', () => {
  it('loads a case by its id or its PayPal id, with what the header and truth map need', async () => {
    const row = await db.disputeCase.findUniqueOrThrow({ where: { paypalDisputeId: 'PP-DEMO-0001' } });
    const v = await loadWorkbench(db, row.id, NOW);
    expect(v).not.toBeNull();
    expect(await loadWorkbench(db, 'PP-DEMO-0001', NOW)).toMatchObject({ caseId: row.id });
    expect(v).toMatchObject({
      disputeId: 'PP-DEMO-0001',
      stage: 'CHARGEBACK',
      status: 'WAITING_FOR_SELLER_RESPONSE',
      demo: true,
      truthState: 'Simulated demo',
      stale: false,
      rawHash: 'demo',
    });
    expect(v!.deadline).not.toBeNull();
    expect(v!.evidence.find((e) => e.type === 'SHIPMENT')).toMatchObject({ trustState: 'Simulated demo' });
    expect(v!.buyerMessages[0]).toMatchObject({ quoted: true });
    expect(v!.requestedEvidence).toEqual(['PROOF_OF_FULFILLMENT', 'PROOF_OF_DELIVERY_SIGNATURE']);
  });
  it('null for an unknown or malformed id, so a hostile id never reaches a query', async () => {
    expect(await loadWorkbench(db, 'PP-R-AAA-10000000', NOW)).toBeNull();
    expect(await loadWorkbench(db, "x' OR 1=1", NOW)).toBeNull();
  });
  it('marks a case not synced for five minutes as stale', async () => {
    expect((await loadWorkbench(db, 'PP-DEMO-0002', NOW))!.stale).toBe(true);
  });
});
