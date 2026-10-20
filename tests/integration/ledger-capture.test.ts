import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureFromOrder, recordCapture } from '../../src/ledger/entries';
import { listLedgerEntries } from '../../src/ledger/store';
import type { Db } from '../../src/lib/db';
import { createTestDb } from '../helpers/test-db';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});

const cap = captureFromOrder(JSON.parse(readFileSync('tests/fixtures/paypal/capture-usd-primary.json', 'utf8')));
const mkOrder = (n: string) =>
  db.order.create({
    data: {
      paypalOrderId: `O${n}`,
      captureId: `C${n}`,
      itemsJson: '[]',
      country: 'US',
      grossMinor: 12000,
      currency: 'USD',
    },
  });

describe('recordCapture', () => {
  it('appends GROSS and PAYPAL_FEE for the order', async () => {
    const o = await mkOrder('1');
    const added = await recordCapture(db, o.id, cap);
    expect(added).toBe(2);
    const rows = await listLedgerEntries(db, o.id);
    expect(rows.map((r) => [r.type, r.amountMinor, r.currency, r.sourceType, r.sourceRef])).toEqual([
      ['GROSS', 12000, 'USD', 'PAYPAL_VERIFIED', '0HE26749YS519313U'],
      ['PAYPAL_FEE', 588, 'USD', 'PAYPAL_VERIFIED', '0HE26749YS519313U'],
    ]);
  });

  it('is safe to run twice: the webhook and the capture route may both record the same capture', async () => {
    const o = await mkOrder('2');
    await recordCapture(db, o.id, cap);
    expect(await recordCapture(db, o.id, cap)).toBe(0);
    expect(await listLedgerEntries(db, o.id)).toHaveLength(2);
  });

  it('writes nothing when the breakdown is unusable', async () => {
    const o = await mkOrder('3');
    const bad = { ...cap, seller_receivable_breakdown: undefined };
    await expect(recordCapture(db, o.id, bad as never)).rejects.toThrow();
    expect(await listLedgerEntries(db, o.id)).toHaveLength(0);
  });
});
