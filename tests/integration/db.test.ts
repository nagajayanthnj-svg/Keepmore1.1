import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/lib/db';
import * as ledgerStore from '../../src/ledger/store';
import { createTestDb } from '../helpers/test-db';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});

const order = (n: number) => ({
  paypalOrderId: `ORDER${n}`,
  captureId: `CAPTURE${n}`,
  itemsJson: JSON.stringify([{ sku: 'SKU1042', qty: 1 }]),
  country: 'US',
  grossMinor: 12000,
  currency: 'USD',
});

describe('schema', () => {
  it('has all twelve tables', async () => {
    const rows = await db.$queryRawUnsafe<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%'",
    );
    expect(rows.map((r) => r.name).sort()).toEqual(
      [
        'AgentRun',
        'AuditEvent',
        'CaseAction',
        'DisputeCase',
        'EvidenceRecord',
        'FxRate',
        'LedgerEntry',
        'Order',
        'ReturnlessGrant',
        'SellerPolicy',
        'Shipment',
        'WebhookEvent',
      ].sort(),
    );
  });
});

describe('Order', () => {
  it('writes and reads back', async () => {
    const created = await db.order.create({ data: order(1) });
    const read = await db.order.findUniqueOrThrow({ where: { paypalOrderId: 'ORDER1' } });
    expect(read.id).toBe(created.id);
    expect(read.grossMinor).toBe(12000);
    expect(read.createdAt).toBeInstanceOf(Date);
  });

  it('rejects a duplicate PayPal order id', async () => {
    await db.order.create({ data: order(2) });
    await expect(db.order.create({ data: order(2) })).rejects.toThrow();
  });

  it('links a dispute case to its order', async () => {
    const o = await db.order.create({ data: order(3) });
    await db.disputeCase.create({
      data: {
        paypalDisputeId: 'PP-R-TEST-1',
        orderId: o.id,
        reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
        stage: 'CHARGEBACK',
        status: 'WAITING_FOR_SELLER_RESPONSE',
        amountMinor: 12000,
        currency: 'USD',
        allowedActionsJson: '[]',
        requestedEvidence: '[]',
        lastSyncedAt: new Date('2026-10-19T16:00:00Z'),
        rawHash: 'abc',
      },
    });
    const withCases = await db.order.findUniqueOrThrow({
      where: { id: o.id },
      include: { disputes: true },
    });
    expect(withCases.disputes.map((d) => d.paypalDisputeId)).toEqual(['PP-R-TEST-1']);
  });
});

describe('ledger store', () => {
  // Invalid values are passed on purpose in some tests, hence the cast.
  const entry = (orderId: string, over: Record<string, unknown> = {}) =>
    ({
      orderId,
      type: 'GROSS',
      amountMinor: 12000,
      currency: 'USD',
      sourceType: 'PAYPAL_VERIFIED',
      sourceRef: 'CAPTURE-X',
      calcVersion: 'v1',
      occurredAt: new Date('2026-10-19T16:00:00Z'),
      ...over,
    }) as ledgerStore.LedgerEntryInput;

  it('appends and lists entries for an order', async () => {
    const o = await db.order.create({ data: order(10) });
    await ledgerStore.appendLedgerEntry(db, entry(o.id));
    await ledgerStore.appendLedgerEntry(
      db,
      entry(o.id, { type: 'PAYPAL_FEE', amountMinor: -588, sourceRef: 'CAPTURE-X' }),
    );
    const list = await ledgerStore.listLedgerEntries(db, o.id);
    expect(list.map((e) => [e.type, e.amountMinor])).toEqual([
      ['GROSS', 12000],
      ['PAYPAL_FEE', -588],
    ]);
  });

  it('keeps a decimal rate exactly', async () => {
    const o = await db.order.create({ data: order(11) });
    await ledgerStore.appendLedgerEntry(
      db,
      entry(o.id, {
        type: 'FX',
        sourceType: 'REFERENCE_RATE_ESTIMATE',
        rate: '95.4627',
        rateDate: new Date('2026-10-19T00:00:00Z'),
        inrMinor: 95546,
      }),
    );
    const [e] = await ledgerStore.listLedgerEntries(db, o.id);
    expect(e?.rate?.toString()).toBe('95.4627');
  });

  it('rejects an unknown type, an unknown source and a non-integer amount', async () => {
    const o = await db.order.create({ data: order(12) });
    await expect(ledgerStore.appendLedgerEntry(db, entry(o.id, { type: 'BONUS' }))).rejects.toThrow();
    await expect(ledgerStore.appendLedgerEntry(db, entry(o.id, { sourceType: 'GUESS' }))).rejects.toThrow();
    await expect(ledgerStore.appendLedgerEntry(db, entry(o.id, { amountMinor: 114.42 }))).rejects.toThrow();
  });

  it('exports no update or delete', () => {
    const functions = Object.entries(ledgerStore)
      .filter(([, v]) => typeof v === 'function')
      .map(([k]) => k);
    expect(functions.sort()).toEqual(['appendLedgerEntries', 'appendLedgerEntry', 'listLedgerEntries']);
    expect(Object.keys(ledgerStore).filter((n) => /update|delete|remove|upsert/i.test(n))).toEqual([]);
  });

  it('is append-only in the database too', async () => {
    const o = await db.order.create({ data: order(13) });
    const e = await ledgerStore.appendLedgerEntry(db, entry(o.id));
    // Prisma's adapter reports a trigger ABORT with a generic constraint message, so the
    // client calls only need to fail; the raw statements show the trigger's own message.
    await expect(db.ledgerEntry.update({ where: { id: e.id }, data: { amountMinor: 1 } })).rejects.toThrow();
    await expect(db.ledgerEntry.delete({ where: { id: e.id } })).rejects.toThrow();
    await expect(
      db.$executeRawUnsafe('UPDATE "LedgerEntry" SET "amountMinor" = 1 WHERE "id" = ?', e.id),
    ).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe('DELETE FROM "LedgerEntry" WHERE "id" = ?', e.id)).rejects.toThrow(/append-only/);
    const [still] = await ledgerStore.listLedgerEntries(db, o.id);
    expect(still?.amountMinor).toBe(12000);
  });

  it('audit events are append-only too', async () => {
    const a = await db.auditEvent.create({
      data: { entity: 'Order', entityId: 'x', kind: 'TEST', detailJson: '{}' },
    });
    await expect(db.auditEvent.update({ where: { id: a.id }, data: { kind: 'EDITED' } })).rejects.toThrow();
    await expect(db.auditEvent.delete({ where: { id: a.id } })).rejects.toThrow();
    await expect(db.$executeRawUnsafe('DELETE FROM "AuditEvent" WHERE "id" = ?', a.id)).rejects.toThrow(/append-only/);
    expect(await db.auditEvent.count({ where: { id: a.id, kind: 'TEST' } })).toBe(1);
  });
});
