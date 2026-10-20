import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncEvidenceRecords } from '../../src/disputes/evidence';
import type { Db } from '../../src/lib/db';
import { TRUTH_STATES } from '../../src/lib/truth-state';
import { createTestDb } from '../helpers/test-db';

let db: Db;
let close: () => Promise<void>;
const T0 = new Date('2026-10-10T08:00:00.000Z');
const T1 = new Date('2026-10-10T08:05:00.000Z');

beforeEach(async () => ({ db, close } = await createTestDb()));
afterEach(async () => close());

async function setup(over: { demo?: boolean; shipment?: boolean; events?: unknown; noOrder?: boolean } = {}) {
  const demo = over.demo ?? false;
  const order = await db.order.create({
    data: {
      paypalOrderId: demo ? 'DEMO-ORD-1' : 'ORD1',
      captureId: demo ? 'DEMO-CAP-1' : '0HE26749YS519313U',
      itemsJson: JSON.stringify([{ sku: 'MUG1', qty: 2, unitMinor: 6000 }]),
      country: 'US',
      grossMinor: 12000,
      currency: 'USD',
      buyerHash: 'a'.repeat(64),
      sellerProtection: 'ELIGIBLE',
      createdAt: T0,
    },
  });
  await db.ledgerEntry.create({
    data: {
      orderId: order.id,
      type: 'GROSS',
      amountMinor: 12000,
      currency: 'USD',
      sourceType: demo ? 'DEMO_SEEDED' : 'PAYPAL_VERIFIED',
      sourceRef: order.captureId,
      calcVersion: 't',
      occurredAt: T1,
    },
  });
  if (over.shipment !== false) {
    await db.shipment.create({
      data: {
        orderId: order.id,
        carrier: 'INDIA_POST',
        trackingNo: 'EE123456789IN',
        pushStatus: 'PUSHED',
        pushedToPaypalAt: T1,
        eventsJson: JSON.stringify(over.events ?? []),
      },
    });
  }
  const c = await db.disputeCase.create({
    data: {
      paypalDisputeId: 'PP-R-TEST-1',
      orderId: over.noOrder ? null : order.id,
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      stage: 'CHARGEBACK',
      status: 'WAITING_FOR_SELLER_RESPONSE',
      amountMinor: 12000,
      currency: 'USD',
      allowedActionsJson: '{}',
      requestedEvidence: '[]',
      lastSyncedAt: T1,
      rawHash: 'x',
    },
  });
  return { order, c };
}
const types = (r: { type: string }[]) => r.map((x) => x.type).sort();

describe('syncEvidenceRecords: what the case file is built from', () => {
  it('makes an order, capture and shipment record for a linked case', async () => {
    const { c } = await setup();
    const r = await syncEvidenceRecords(db, c.id);
    expect(types(r)).toEqual(['CAPTURE', 'ORDER', 'SHIPMENT']);
    for (const x of r) expect(x.id).toMatch(/^REC-[0-9A-F]{10}$/);
    const by = Object.fromEntries(r.map((x) => [x.type, x]));
    expect(by.ORDER).toMatchObject({ trustState: 'Seller entered', occurredAt: T0 });
    expect(by.ORDER!.fields).toEqual({
      country: 'US',
      grossMinor: 12000,
      currency: 'USD',
      items: [{ sku: 'MUG1', qty: 2, unitMinor: 6000 }],
    });
    expect(by.CAPTURE).toMatchObject({ trustState: 'Verified by PayPal', source: 'PAYPAL', occurredAt: T1 });
    expect(by.CAPTURE!.fields).toEqual({
      captureId: '0HE26749YS519313U',
      grossMinor: 12000,
      currency: 'USD',
      sellerProtection: 'ELIGIBLE',
    });
    expect(by.SHIPMENT).toMatchObject({ trustState: 'Seller entered', occurredAt: T1 });
    expect(by.SHIPMENT!.fields).toEqual({ carrier: 'INDIA_POST', trackingNo: 'EE123456789IN', pushStatus: 'PUSHED' });
    for (const x of r) expect(TRUTH_STATES).toContain(x.trustState);
  });

  it('stores the records it returns', async () => {
    const { c } = await setup();
    const r = await syncEvidenceRecords(db, c.id);
    const rows = await db.evidenceRecord.findMany({ where: { caseId: c.id } });
    expect(rows.map((x) => x.id).sort()).toEqual(r.map((x) => x.id).sort());
    expect(rows.every((x) => /^[0-9a-f]{64}$/.test(x.contentHash))).toBe(true);
  });

  it('makes nothing for a case with no order, or an unknown case', async () => {
    const { c } = await setup({ noOrder: true });
    expect(await syncEvidenceRecords(db, c.id)).toEqual([]);
    expect(await syncEvidenceRecords(db, 'nope')).toEqual([]);
    expect(await db.evidenceRecord.count()).toBe(0);
  });

  it('leaves out a shipment that does not exist: nothing is invented', async () => {
    const { c } = await setup({ shipment: false });
    expect(types(await syncEvidenceRecords(db, c.id))).toEqual(['CAPTURE', 'ORDER']);
  });

  it('labels every record of a demo order Simulated demo', async () => {
    const { c } = await setup({ demo: true });
    const r = await syncEvidenceRecords(db, c.id);
    expect(r.map((x) => x.trustState)).toEqual(['Simulated demo', 'Simulated demo', 'Simulated demo']);
  });

  it('puts no email, name, payer id or buyer hash in any record', async () => {
    const { c } = await setup();
    await syncEvidenceRecords(db, c.id);
    const dump = JSON.stringify(await db.evidenceRecord.findMany());
    expect(dump).not.toContain('@');
    expect(dump).not.toContain('a'.repeat(64));
  });
});

describe('stable REC ids', () => {
  it('keeps the same ids and hashes when the same content is synced again, and adds no rows', async () => {
    const { c } = await setup();
    const a = await syncEvidenceRecords(db, c.id);
    const b = await syncEvidenceRecords(db, c.id);
    expect(b.map((x) => [x.id, x.contentHash])).toEqual(a.map((x) => [x.id, x.contentHash]));
    expect(await db.evidenceRecord.count()).toBe(3);
  });

  it('keeps the id and changes the hash and fields when the content changes', async () => {
    const { order, c } = await setup();
    const a = (await syncEvidenceRecords(db, c.id)).find((x) => x.type === 'SHIPMENT')!;
    await db.shipment.update({ where: { orderId: order.id }, data: { trackingNo: 'EE999999999IN' } });
    const b = (await syncEvidenceRecords(db, c.id)).find((x) => x.type === 'SHIPMENT')!;
    expect(b.id).toBe(a.id);
    expect(b.contentHash).not.toBe(a.contentHash);
    expect(b.fields).toMatchObject({ trackingNo: 'EE999999999IN' });
    expect(await db.evidenceRecord.count()).toBe(3);
  });

  it('gives a second case on the same order different ids', async () => {
    const { order, c } = await setup();
    const c2 = await db.disputeCase.create({
      data: {
        paypalDisputeId: 'PP-R-TEST-2',
        orderId: order.id,
        reason: 'x',
        stage: 'INQUIRY',
        status: 'OPEN',
        amountMinor: 1,
        currency: 'USD',
        allowedActionsJson: '{}',
        requestedEvidence: '[]',
        lastSyncedAt: T1,
        rawHash: 'y',
      },
    });
    const a = await syncEvidenceRecords(db, c.id);
    const b = await syncEvidenceRecords(db, c2.id);
    expect(new Set([...a, ...b].map((x) => x.id)).size).toBe(6);
  });

  it('removes a record whose source is gone', async () => {
    const { order, c } = await setup();
    await syncEvidenceRecords(db, c.id);
    await db.shipment.delete({ where: { orderId: order.id } });
    expect(types(await syncEvidenceRecords(db, c.id))).toEqual(['CAPTURE', 'ORDER']);
    expect(await db.evidenceRecord.count()).toBe(2);
  });
});

describe('tracking events', () => {
  const ev = (at: string, status: string, source = 'SELLER') => ({ at, status, source });
  const e1 = ev('2026-10-12T09:00:00.000Z', 'IN_TRANSIT');
  const e2 = ev('2026-10-15T09:00:00.000Z', 'DELIVERED');

  it('makes one record per valid event, with a status from the fixed list only', async () => {
    const { c } = await setup({ events: [e1, e2, ev('2026-10-16T09:00:00.000Z', 'Delivered to a friend!')] });
    const t = (await syncEvidenceRecords(db, c.id)).filter((x) => x.type === 'TRACKING_EVENT');
    expect(t).toHaveLength(3);
    expect(t.map((x) => (x.fields as { status: string }).status)).toEqual(['IN_TRANSIT', 'DELIVERED', 'UNKNOWN']);
    expect(t[0]).toMatchObject({ occurredAt: new Date(e1.at), trustState: 'Seller entered', source: 'SELLER' });
    expect(t[0]!.fields).toEqual({ carrier: 'INDIA_POST', status: 'IN_TRANSIT' });
  });

  it('ignores malformed events, and labels an unrecognised source Unknown', async () => {
    const { c } = await setup({
      events: [
        e1,
        null,
        'x',
        { at: 'not a date', status: 'DELIVERED', source: 'SELLER' },
        { status: 'DELIVERED' },
        ev(e2.at, 'DELIVERED', 'CARRIER_FEED?'),
      ],
    });
    const t = (await syncEvidenceRecords(db, c.id)).filter((x) => x.type === 'TRACKING_EVENT');
    expect(t.map((x) => x.trustState)).toEqual(['Seller entered', 'Unknown']);
  });

  it('keeps event ids when the list is reordered, and drops a removed event', async () => {
    const { order, c } = await setup({ events: [e1, e2] });
    const a = (await syncEvidenceRecords(db, c.id))
      .filter((x) => x.type === 'TRACKING_EVENT')
      .map((x) => x.id)
      .sort();
    await db.shipment.update({ where: { orderId: order.id }, data: { eventsJson: JSON.stringify([e2, e1]) } });
    const b = (await syncEvidenceRecords(db, c.id))
      .filter((x) => x.type === 'TRACKING_EVENT')
      .map((x) => x.id)
      .sort();
    expect(b).toEqual(a);
    await db.shipment.update({ where: { orderId: order.id }, data: { eventsJson: JSON.stringify([e1]) } });
    expect((await syncEvidenceRecords(db, c.id)).filter((x) => x.type === 'TRACKING_EVENT')).toHaveLength(1);
  });

  it('survives eventsJson that is not JSON or not a list', async () => {
    const { order, c } = await setup();
    for (const bad of ['{not json', '{"a":1}', '"x"', 'null']) {
      await db.shipment.update({ where: { orderId: order.id }, data: { eventsJson: bad } });
      expect(types(await syncEvidenceRecords(db, c.id))).toEqual(['CAPTURE', 'ORDER', 'SHIPMENT']);
    }
  });

  it('marks events of a demo order Simulated demo, whatever their source says', async () => {
    const { c } = await setup({ demo: true, events: [e1] });
    const t = (await syncEvidenceRecords(db, c.id)).filter((x) => x.type === 'TRACKING_EVENT');
    expect(t[0]!.trustState).toBe('Simulated demo');
  });
});
