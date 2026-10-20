import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemo } from '../../src/demo/seed';
import { captureFromOrder, recordCapture } from '../../src/ledger/entries';
import { listLedgerEntries } from '../../src/ledger/store';
import { loadOverview } from '../../src/ledger/views';
import { createDb, type Db } from '../../src/lib/db';
import { createTestDb } from '../helpers/test-db';

describe('loadOverview on a seeded database with one real capture', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await seedDemo(db);
    const o = await db.order.create({
      data: {
        paypalOrderId: 'REAL1',
        captureId: 'CAP1',
        itemsJson: '[]',
        country: 'US',
        grossMinor: 12000,
        currency: 'USD',
      },
    });
    const cap = captureFromOrder(JSON.parse(readFileSync('tests/fixtures/paypal/capture-usd-primary.json', 'utf8')));
    await recordCapture(db, o.id, cap);
  }, 60_000);
  afterAll(async () => {
    await close();
  });

  it('counts demo orders and real orders apart', async () => {
    const v = await loadOverview(db);
    expect(v.ready && v.orders).toEqual({ demo: 400, other: 1 });
  });

  it('gives one row per type, source and currency, never mixing sources', async () => {
    const v = await loadOverview(db);
    if (!v.ready) throw new Error('not ready');
    expect(v.rows.map((r) => [r.type, r.sourceType, r.currency, r.entries])).toEqual([
      ['GROSS', 'PAYPAL_VERIFIED', 'USD', 1],
      ['GROSS', 'DEMO_SEEDED', 'USD', 400],
      ['PAYPAL_FEE', 'PAYPAL_VERIFIED', 'USD', 1],
      ['PAYPAL_FEE', 'DEMO_SEEDED', 'USD', 400],
      ['FX', 'DEMO_SEEDED', 'INR', 400],
    ]);
  });

  it('totals come from the ledger: each row equals an independent sum of its entries', async () => {
    const v = await loadOverview(db);
    if (!v.ready) throw new Error('not ready');
    const orders = await db.order.findMany({ select: { id: true } });
    const all = (await Promise.all(orders.map((o) => listLedgerEntries(db, o.id)))).flat();
    for (const row of v.rows) {
      const expected = all
        .filter((e) => e.type === row.type && e.sourceType === row.sourceType && e.currency === row.currency)
        .reduce((s, e) => s + e.amountMinor, 0);
      expect(row.totalMinor).toBe(expected);
    }
    const real = v.rows.find((r) => r.type === 'PAYPAL_FEE' && r.sourceType === 'PAYPAL_VERIFIED')!;
    expect(real.totalMinor).toBe(588);
  });
});

describe('loadOverview when the database is not ready', () => {
  it('is ready with nothing in it for a migrated, empty database', async () => {
    const { db, close } = await createTestDb();
    try {
      expect(await loadOverview(db)).toEqual({ ready: true, orders: { demo: 0, other: 0 }, rows: [] });
    } finally {
      await close();
    }
  });
  it('is not ready (and does not throw) for a database with no tables', async () => {
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), 'keepmore-test-')), 'empty.db')}`);
    try {
      expect(await loadOverview(db)).toEqual({ ready: false });
    } finally {
      await db.$disconnect();
    }
  });
});
