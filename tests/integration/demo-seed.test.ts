import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATALOGUE, DEMO_COUNTRIES } from '../../src/demo/catalogue';
import { DEMO_ANCHOR, demoContentHash, demoFee, resetDemo, seedDemo } from '../../src/demo/seed';
import { estimateFx } from '../../src/ledger/fx';
import { rateOnOrBefore } from '../../src/ledger/fx-rates';
import type { Db } from '../../src/lib/db';
import { createTestDb } from '../helpers/test-db';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
}, 30_000);
afterAll(async () => {
  await close();
});

describe('seedDemo', () => {
  it('creates 400 Neel Pottery orders, each marked DEMO and carrying GROSS, PAYPAL_FEE and FX entries', async () => {
    const result = await seedDemo(db);
    expect(result.orders).toBe(400);
    const orders = await db.order.findMany({ include: { ledger: true } });
    expect(orders).toHaveLength(400);
    for (const o of orders) {
      expect(o.paypalOrderId).toMatch(/^DEMO-ORD-\d{4}$/);
      expect(o.captureId).toMatch(/^DEMO-CAP-\d{4}$/);
      expect(o.ledger.map((l) => l.type).sort()).toEqual(['FX', 'GROSS', 'PAYPAL_FEE']);
    }
  }, 30_000);

  it('labels every seeded ledger row DEMO_SEEDED and every seeded rate DEMO_SEED', async () => {
    expect(await db.ledgerEntry.count({ where: { sourceType: { not: 'DEMO_SEEDED' } } })).toBe(0);
    expect(await db.fxRate.count({ where: { source: { not: 'DEMO_SEED' } } })).toBe(0);
    expect(await db.fxRate.count()).toBeGreaterThan(100);
  });

  it('uses catalogue SKUs made of letters and digits only, and gross equals the items', async () => {
    const skus = new Set(CATALOGUE.map((p) => p.sku));
    for (const p of CATALOGUE) expect(p.sku).toMatch(/^[A-Za-z0-9]+$/);
    const orders = await db.order.findMany({ include: { ledger: true } });
    for (const o of orders) {
      const items = JSON.parse(o.itemsJson) as { sku: string; qty: number; unitMinor: number }[];
      expect(items.length).toBeGreaterThan(0);
      for (const i of items) expect(skus.has(i.sku)).toBe(true);
      const sum = items.reduce((s, i) => s + i.qty * i.unitMinor, 0);
      expect(o.grossMinor).toBe(sum);
      expect(o.currency).toBe('USD');
      expect(o.ledger.find((l) => l.type === 'GROSS')!.amountMinor).toBe(sum);
    }
  });

  it('spreads orders over six months ending at the anchor, from a fixed country mix, US most', async () => {
    const orders = await db.order.findMany();
    const times = orders.map((o) => o.createdAt.getTime());
    const end = DEMO_ANCHOR.getTime();
    expect(Math.max(...times)).toBeLessThanOrEqual(end);
    expect(Math.min(...times)).toBeGreaterThanOrEqual(end - 184 * 86_400_000);
    expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(170 * 86_400_000);
    const counts = new Map<string, number>();
    for (const o of orders) counts.set(o.country, (counts.get(o.country) ?? 0) + 1);
    for (const c of counts.keys()) expect(DEMO_COUNTRIES.map((x) => x.code)).toContain(c);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    expect(top).toBe('US');
  });

  it('computes the demo fee as 4.6% + $0.36 in integers (matches the sandbox on 120, 50 and 25 USD)', () => {
    expect(demoFee(12000)).toBe(588);
    expect(demoFee(5000)).toBe(266);
    expect(demoFee(2500)).toBe(151);
  });

  it('writes the fee from demoFee and the FX estimate from the seeded rate on or before the order date', async () => {
    const orders = await db.order.findMany({ include: { ledger: true }, take: 25 });
    for (const o of orders) {
      const fee = o.ledger.find((l) => l.type === 'PAYPAL_FEE')!;
      expect(fee.amountMinor).toBe(demoFee(o.grossMinor));
      const fx = o.ledger.find((l) => l.type === 'FX')!;
      const r = await rateOnOrBefore(db, 'USD/INR', o.createdAt, { source: 'DEMO_SEED' });
      expect(fx.currency).toBe('INR');
      expect(fx.rate!.toString()).toBe(r!.rate);
      expect(fx.amountMinor).toBe(estimateFx(o.grossMinor - fee.amountMinor, r!.rate, '0.03'));
      expect(fx.inrMinor).toBe(fx.amountMinor);
    }
  });

  it('seeding again adds nothing and the content hash is unchanged', async () => {
    const before = await demoContentHash(db);
    expect((await seedDemo(db)).orders).toBe(0);
    expect(await db.order.count()).toBe(400);
    expect(await db.ledgerEntry.count()).toBe(1200);
    expect(await demoContentHash(db)).toBe(before);
  }, 30_000);

  it('gives the same content hash in a different database', async () => {
    const other = await createTestDb();
    try {
      await seedDemo(other.db);
      expect(await demoContentHash(other.db)).toBe(await demoContentHash(db));
    } finally {
      await other.close();
    }
  }, 30_000);
});

describe('resetDemo', () => {
  it('refuses unless demo mode is on', async () => {
    await expect(resetDemo(db, { demoMode: false })).rejects.toThrow(/DEMO_MODE/);
    expect(await db.order.count()).toBe(400);
  });

  it('removes demo rows only, and re-seeding gives the same hash', async () => {
    const hash = await demoContentHash(db);
    const real = await db.order.create({
      data: {
        paypalOrderId: 'REALSANDBOX1',
        captureId: 'CAPREAL1',
        itemsJson: '[]',
        country: 'US',
        grossMinor: 5000,
        currency: 'USD',
      },
    });
    await db.ledgerEntry.create({
      data: {
        orderId: real.id,
        type: 'GROSS',
        amountMinor: 5000,
        currency: 'USD',
        sourceType: 'PAYPAL_VERIFIED',
        calcVersion: 'v',
        occurredAt: new Date(),
      },
    });
    await resetDemo(db, { demoMode: true });
    expect(await db.order.count()).toBe(1);
    expect(await db.ledgerEntry.count()).toBe(1);
    expect(await db.fxRate.count()).toBe(0);
    await seedDemo(db);
    expect(await demoContentHash(db)).toBe(hash);
    expect(await db.ledgerEntry.count({ where: { orderId: real.id } })).toBe(1);
  }, 60_000);
});

describe('append-only triggers still guard everything that is not demo data', () => {
  it('refuses to delete a PAYPAL_VERIFIED row', async () => {
    await expect(
      db.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "sourceType" = 'PAYPAL_VERIFIED'`),
    ).rejects.toThrow();
    const rows = await db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*) AS n FROM "LedgerEntry" WHERE "sourceType" = 'PAYPAL_VERIFIED'`,
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });
  it('refuses to update a DEMO_SEEDED row', async () => {
    await expect(
      db.$executeRawUnsafe(`UPDATE "LedgerEntry" SET "amountMinor" = 1 WHERE "sourceType" = 'DEMO_SEEDED'`),
    ).rejects.toThrow(/append-only/);
  });
  it('refuses to delete a row of any other source', async () => {
    for (const s of ['SELLER_ENTERED', 'REFERENCE_RATE_ESTIMATE', 'HYPOTHETICAL_SCENARIO']) {
      const o = await db.order.findFirstOrThrow({ where: { paypalOrderId: 'REALSANDBOX1' } });
      const e = await db.ledgerEntry.create({
        data: {
          orderId: o.id,
          type: 'GROSS',
          amountMinor: 1,
          currency: 'USD',
          sourceType: s,
          calcVersion: 'v',
          occurredAt: new Date(),
        },
      });
      await expect(db.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "id" = '${e.id}'`)).rejects.toThrow();
    }
  });
});
