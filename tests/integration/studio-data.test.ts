import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedDemoDisputes } from '../../src/demo/disputes';
import { seedDemo } from '../../src/demo/seed';
import { loadStudioData } from '../../src/overview/studio-data';
import type { Db } from '../../src/lib/db';
import { TRUTH_STATES } from '../../src/lib/truth-state';
import { createTestDb } from '../helpers/test-db';
import { fromMinor } from '../../src/normalise/money';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await seedDemo(db);
  await seedDemoDisputes(db, new Date('2026-10-20T12:00:00Z'));
});
afterEach(async () => close());

describe('loadStudioData (T-405): the rows AG Studio gets', () => {
  it('one ledger row per entry, in integer minor units, each with exactly one truth state', async () => {
    const d = await loadStudioData(db);
    expect(d.ledger.length).toBe(await db.ledgerEntry.count());
    for (const r of d.ledger) {
      expect(Number.isInteger(r.amountMinor)).toBe(true);
      expect(TRUTH_STATES).toContain(r.truthState);
      expect(r.month).toMatch(/^\d{4}-\d\d$/);
      expect(r.series).toBe(`${r.kind} · ${r.truthState}`);
      // Exact money by currency for tiles and tables; a display copy in major units for chart axes only.
      expect(r.usdMinor).toBe(r.currency === 'USD' ? r.amountMinor : null);
      expect(r.inrMinor).toBe(r.currency === 'INR' ? r.amountMinor : null);
      expect(r.usd).toBe(r.currency === 'USD' ? Number(fromMinor(r.amountMinor, 'USD')) : null);
    }
  });
  it('orders and disputes link by id so Studio can join them', async () => {
    const d = await loadStudioData(db);
    const ids = new Set(d.orders.map((o) => o.id));
    expect(d.ledger.every((l) => ids.has(l.orderId))).toBe(true);
    expect(d.disputes.length).toBe(3);
    expect(d.disputes.every((x) => x.orderId === null || ids.has(x.orderId))).toBe(true);
    expect(d.orders.filter((o) => o.disputed)).toHaveLength(3);
  });
  it('sends no buyer data: no buyer hash, capture id, email or message text', async () => {
    const text = JSON.stringify(await loadStudioData(db));
    const order = await db.order.findFirstOrThrow();
    expect(text).not.toContain(order.buyerHash);
    expect(text).not.toContain(order.captureId!);
    expect(text).not.toContain('@');
    expect(text).not.toMatch(/has not arrived/);
  });
  it('names the main truth state of each kind, for the KPI titles', async () => {
    const d = await loadStudioData(db);
    expect(d.mainTruthState.GROSS).toBe('Simulated demo');
    expect(d.mainCurrency.GROSS).toBe('USD');
    expect(d.mainCurrency.FX).toBe('INR');
  });
  it('demo-only mode (for the AI assistant) leaves out every real order, ledger line and dispute', async () => {
    const real = await db.order.create({
      data: { paypalOrderId: '5O190127TN364715T', captureId: '3C679366HH908993F', itemsJson: '[]', country: 'US', grossMinor: 100, currency: 'USD', buyerHash: 'b'.repeat(64) },
    });
    await db.ledgerEntry.create({
      data: { orderId: real.id, type: 'GROSS', amountMinor: 100, currency: 'USD', sourceType: 'PAYPAL_VERIFIED', calcVersion: 't', occurredAt: new Date() },
    });
    const all = await loadStudioData(db);
    const demo = await loadStudioData(db, { demoOnly: true });
    expect(all.orders.some((o) => o.orderRef === '5O190127TN364715T')).toBe(true);
    expect(demo.orders.every((o) => o.orderRef.startsWith('DEMO-'))).toBe(true);
    expect(demo.ledger.some((l) => l.orderId === real.id)).toBe(false);
    expect(demo.disputes.every((d) => d.disputeId.startsWith('PP-DEMO-'))).toBe(true);
    expect(JSON.stringify(demo)).not.toContain('5O190127TN364715T');
  });

  it('an empty database gives empty sources, not an error', async () => {
    const { db: empty, close: c2 } = await createTestDb();
    const d = await loadStudioData(empty);
    expect(d).toMatchObject({ ledger: [], orders: [], disputes: [] });
    await c2();
  });
});
