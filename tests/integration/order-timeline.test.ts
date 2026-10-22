import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedDemoDisputes } from '../../src/demo/disputes';
import { seedDemo } from '../../src/demo/seed';
import type { Db } from '../../src/lib/db';
import { TRUTH_STATES } from '../../src/lib/truth-state';
import { loadOrderTimeline } from '../../src/orders/timeline';
import { createTestDb } from '../helpers/test-db';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await seedDemo(db);
  await seedDemoDisputes(db, new Date('2026-10-20T12:00:00Z'));
});
afterEach(async () => {
  await close();
});

const demoDisputeOrder = async (id: string) =>
  (await db.disputeCase.findUniqueOrThrow({ where: { paypalDisputeId: id }, include: { order: true } })).order!.paypalOrderId;

describe('order timeline (T-406)', () => {
  it('every line has one truth state, a time (or says it was not recorded), a rate or formula, and a reference', async () => {
    const t = await loadOrderTimeline(db, await demoDisputeOrder('PP-DEMO-0001'));
    expect(t).not.toBeNull();
    expect(t!.lines.length).toBeGreaterThan(5);
    for (const l of t!.lines) {
      expect(TRUTH_STATES, l.title).toContain(l.truthState);
      expect(l.formula.length, l.title).toBeGreaterThan(5);
      expect(l.ref.length, l.title).toBeGreaterThan(0);
      if (l.at) expect(Date.parse(l.at), l.title).not.toBeNaN();
    }
    const times = t!.lines.filter((l) => l.at).map((l) => Date.parse(l.at!));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('the fee says how it was made; the FX line shows its working with the rate and spread, and it adds up', async () => {
    const t = (await loadOrderTimeline(db, 'DEMO-ORD-0010'))!;
    const fee = t.lines.find((l) => l.type === 'PAYPAL_FEE')!;
    expect(fee.formula).toMatch(/4\.6% of the gross \+ 0\.36/);
    const fx = t.lines.find((l) => l.type === 'FX')!;
    expect(fx.formula).toMatch(/^\(\d+\.\d\d − \d+\.\d\d\) USD × \d+\.\d{4} INR\/USD \(rate of \d{4}-\d\d-\d\d\) × 3% spread = \d+\.\d\d INR$/);
    expect(fx.amount!.currency).toBe('INR');
  });

  it('lists the leakage line by line with labels and never adds them into one total', async () => {
    const t = (await loadOrderTimeline(db, 'DEMO-ORD-0010'))!;
    expect(t.leakage.map((l) => l.type).sort()).toEqual(['FX', 'PAYPAL_FEE']);
    expect(t.leakage.every((l) => l.truthState)).toBe(true);
    expect(t).not.toHaveProperty('leakageTotal');
  });

  it('shows the shipment, tracking events and the dispute with links', async () => {
    const t = (await loadOrderTimeline(db, await demoDisputeOrder('PP-DEMO-0001')))!;
    expect(t.lines.find((l) => l.kind === 'SHIPMENT')).toMatchObject({ title: 'Shipped with India Post', truthState: 'Simulated demo' });
    expect(t.lines.find((l) => l.kind === 'SHIPMENT')!.ref).toMatch(/^DEMO/);
    expect(t.lines.filter((l) => l.kind === 'TRACKING').map((l) => l.title)).toEqual(['Tracking: in transit', 'Tracking: delivered']);
    const d = t.lines.find((l) => l.kind === 'DISPUTE')!;
    expect(d.ref).toBe('PP-DEMO-0001');
    expect(d.href).toMatch(/^\/disputes\//);
  });

  it('a won dispute shows the RETAINED line with the outcome link', async () => {
    const t = (await loadOrderTimeline(db, await demoDisputeOrder('PP-DEMO-0003')))!;
    const r = t.lines.find((l) => l.type === 'RETAINED')!;
    expect(r).toMatchObject({ truthState: 'Simulated demo', ref: 'PP-DEMO-0003' });
    expect(r.href).toMatch(/^\/outcome\//);
  });

  it('a real order: capture lines say they are read from PayPal; a missing FX estimate is shown as Unknown, not skipped', async () => {
    const o = await db.order.create({
      data: { paypalOrderId: '87V16475BG7563510', captureId: '1YP10400KC305794V', itemsJson: '[{"sku":"SKU1042","qty":1,"unitMinor":3000}]', country: 'US', grossMinor: 3000, currency: 'USD', buyerHash: 'b'.repeat(64) },
    });
    for (const [type, amountMinor] of [['GROSS', 3000], ['PAYPAL_FEE', 173]] as const)
      await db.ledgerEntry.create({ data: { orderId: o.id, type, amountMinor, currency: 'USD', sourceType: 'PAYPAL_VERIFIED', sourceRef: '1YP10400KC305794V', calcVersion: 'ledger-v1', occurredAt: new Date('2026-10-19T12:00:00Z') } });
    const t = (await loadOrderTimeline(db, '87V16475BG7563510'))!;
    expect(t.lines.find((l) => l.type === 'PAYPAL_FEE')).toMatchObject({ truthState: 'Verified by PayPal', ref: '1YP10400KC305794V' });
    expect(t.lines.find((l) => l.type === 'PAYPAL_FEE')!.formula).toMatch(/paypal_fee.*never recalculated/);
    expect(t.lines.find((l) => l.type === 'FX')).toMatchObject({ truthState: 'Unknown', amount: null });
    expect(JSON.stringify(t)).not.toContain(o.buyerHash);
  });

  it('finds the order by its internal id too; unknown or malformed ids are null', async () => {
    const o = await db.order.findFirstOrThrow({ where: { paypalOrderId: 'DEMO-ORD-0010' } });
    expect((await loadOrderTimeline(db, o.id))?.orderRef).toBe('DEMO-ORD-0010');
    expect(await loadOrderTimeline(db, 'NOPE')).toBeNull();
    expect(await loadOrderTimeline(db, "x' OR 1=1")).toBeNull();
  });
});
