import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCaseFile } from '../../src/case/case-file';
import type { Db } from '../../src/lib/db';
import { createTestDb } from '../helpers/test-db';

let db: Db;
let close: () => Promise<void>;
const T0 = new Date('2026-10-10T08:00:00.000Z');
const T1 = new Date('2026-10-10T08:05:00.000Z');
const DEADLINE = new Date('2026-10-30T18:29:59.000Z');

beforeEach(async () => ({ db, close } = await createTestDb()));
afterEach(async () => close());

const PAYER = 'PAYERID12345A';
const BUYER_HASH = 'b'.repeat(64);

async function setup(over: { demo?: boolean; events?: unknown; actions?: string; evidence?: string; policy?: boolean } = {}) {
  const demo = over.demo ?? false;
  const order = await db.order.create({
    data: {
      paypalOrderId: demo ? 'DEMO-ORD-1' : 'ORD1',
      captureId: demo ? 'DEMO-CAP-1' : '0HE26749YS519313U',
      itemsJson: JSON.stringify([{ sku: 'MUG1', qty: 2, unitMinor: 6000 }]),
      country: 'US',
      grossMinor: 12000,
      currency: 'USD',
      buyerHash: BUYER_HASH,
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
      sourceType: 'PAYPAL_VERIFIED',
      sourceRef: order.captureId,
      calcVersion: 't',
      occurredAt: T1,
    },
  });
  await db.shipment.create({
    data: {
      orderId: order.id,
      carrier: 'INDIA_POST',
      trackingNo: 'EE123456789IN',
      pushStatus: 'PUSHED',
      pushedToPaypalAt: T1,
      eventsJson: JSON.stringify(over.events ?? [{ at: '2026-10-12T09:00:00.000Z', status: 'IN_TRANSIT', source: 'SELLER' }]),
    },
  });
  const c = await db.disputeCase.create({
    data: {
      paypalDisputeId: 'PP-R-TEST-1',
      orderId: order.id,
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      stage: 'CHARGEBACK',
      status: 'WAITING_FOR_SELLER_RESPONSE',
      amountMinor: 12000,
      currency: 'USD',
      sellerDeadline: DEADLINE,
      allowedActionsJson:
        over.actions ?? JSON.stringify({ actions: [{ action: 'PROVIDE_EVIDENCE', rel: 'provide_evidence', method: 'POST', path: '/v1/x' }], acceptClaimTypes: [] }),
      requestedEvidence: over.evidence ?? JSON.stringify(['PROOF_OF_FULFILLMENT', 'PROOF_OF_DELIVERY_SIGNED']),
      buyerHash: BUYER_HASH,
      lastSyncedAt: T1,
      rawHash: `raw-${PAYER}`,
    },
  });
  if (over.policy !== false) {
    await db.sellerPolicy.create({
      data: {
        refundThresholdMinor: 2000,
        highValueBandMinor: 20000,
        returnPolicyText: 'Returns within 14 days. Write to seller@example.com or call +91 98765 43210 about 12 MG Road returns.',
        currency: 'USD',
      },
    });
  }
  return { order, c };
}

describe('buildCaseFile', () => {
  it('holds the dispute, evidence, policy and allowed actions, and every evidence item has a REC id', async () => {
    const { c } = await setup();
    const f = await buildCaseFile(db, c.id);
    expect(f).not.toBeNull();
    expect(f!.dispute).toMatchObject({
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      stage: 'CHARGEBACK',
      status: 'WAITING_FOR_SELLER_RESPONSE',
      amount: { minor: 12000, currency: 'USD' },
      sellerDeadline: DEADLINE.toISOString(),
      requestedEvidence: ['PROOF_OF_FULFILLMENT', 'PROOF_OF_DELIVERY_SIGNED'],
    });
    expect(f!.allowedActions.actions).toEqual(['PROVIDE_EVIDENCE']);
    expect(f!.evidence.map((e) => e.type).sort()).toEqual(['CAPTURE', 'ORDER', 'SHIPMENT', 'TRACKING_EVENT']);
    for (const e of f!.evidence) {
      expect(e.id).toMatch(/^REC-[0-9A-F]{10}$/);
      expect(e.trustState).toBeTruthy();
    }
    expect(f!.policy).toMatchObject({ refundThresholdMinor: 2000, highValueBandMinor: 20000, currency: 'USD' });
    expect(f!.buyerMessages).toEqual([]);
  });

  it('contains no email, phone, street address, buyer hash or payer id', async () => {
    const { c } = await setup();
    const text = JSON.stringify(await buildCaseFile(db, c.id));
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    // Timestamps, the hash and the ids are digits (or hex) too, and can hold a long run by chance: take them
    // out before looking for phone numbers in the content.
    const content = text
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '')
      .replace(/"(?:hash|caseId)":"[^"]*"/g, '')
      .replace(/REC-[0-9A-F]{10}/g, '');
    expect(content).not.toMatch(/\+?\d[\d\s-]{8,}\d/);
    expect(text).not.toMatch(/\b\d{1,5}\s+[A-Za-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Lane|Ln)\b/i);
    expect(text).not.toContain(BUYER_HASH);
    expect(text).not.toContain(PAYER);
    expect(text).not.toMatch(/buyerHash|payerId|payer_id|email/i);
    // The policy text is kept, minus the contact details inside it.
    expect(text).toContain('Returns within 14 days');
  });

  it('is sealed: frozen, and the same data gives the same hash, changed data a different one', async () => {
    const { c, order } = await setup();
    const a = await buildCaseFile(db, c.id);
    const b = await buildCaseFile(db, c.id);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a!.evidence)).toBe(true);
    expect(() => {
      (a!.evidence as unknown[]).push({});
    }).toThrow();
    expect(a!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a!.hash).toBe(b!.hash);
    await db.shipment.update({
      where: { orderId: order.id },
      data: { eventsJson: JSON.stringify([{ at: '2026-10-13T09:00:00.000Z', status: 'DELIVERED', source: 'SELLER' }]) },
    });
    expect((await buildCaseFile(db, c.id))!.hash).not.toBe(a!.hash);
  });

  it('keeps evidence ids stable when only content changes', async () => {
    const { c, order } = await setup();
    const a = await buildCaseFile(db, c.id);
    await db.order.update({ where: { id: order.id }, data: { country: 'GB' } });
    const b = await buildCaseFile(db, c.id);
    expect(b!.evidence.map((e) => e.id)).toEqual(a!.evidence.map((e) => e.id));
  });

  it('carries the demo label on demo cases, and says so when there is no linked order', async () => {
    const { c } = await setup({ demo: true });
    const f = await buildCaseFile(db, c.id);
    expect(f!.evidence.every((e) => e.trustState === 'Simulated demo' || e.type === 'TRACKING_EVENT')).toBe(true);
    const lone = await db.disputeCase.create({
      data: {
        paypalDisputeId: 'PP-R-LONE-1',
        reason: 'UNAUTHORISED',
        stage: 'INQUIRY',
        status: 'OPEN',
        amountMinor: 500,
        currency: 'USD',
        allowedActionsJson: '{}',
        requestedEvidence: '[]',
        lastSyncedAt: T1,
        rawHash: 'x',
      },
    });
    const g = await buildCaseFile(db, lone.id);
    expect(g!.evidence).toEqual([]);
    expect(g!.orderLinked).toBe(false);
  });

  it('treats unreadable stored actions and evidence requests as none, never as allowed', async () => {
    const { c } = await setup({ actions: 'not json', evidence: '{"x":1}', policy: false });
    const f = await buildCaseFile(db, c.id);
    expect(f!.allowedActions).toEqual({ actions: [], acceptClaimTypes: [], source: 'STORED_COPY' });
    expect(f!.dispute.requestedEvidence).toEqual([]);
    expect(f!.policy).toBeNull();
  });

  it('returns null for an unknown case', async () => {
    expect(await buildCaseFile(db, 'nope')).toBeNull();
  });
});
