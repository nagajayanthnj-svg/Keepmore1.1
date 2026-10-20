import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DisputeParseError, parseDispute } from '../../src/disputes/parse';

const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/paypal/${n}.json`, 'utf8'));
const first = fx('dispute-details-first'); // IUT, 120.00, CHARGEBACK, three types requested
const rav = fx('dispute-details'); // RAV, 50.00, CHARGEBACK, three requested and two already submitted
const resolved = fx('t009-PP-R-IUT-10193562-accept-3-final'); // RESOLVED_BUYER_FAVOUR
const inquiry = fx('t010-PP-R-RAV-10193566-evidence-1-before'); // INQUIRY, one type requested, no deadline
const underReview = fx('dispute-after-require-evidence'); // UNDER_REVIEW, nothing requested

describe('parseDispute: the fields we keep', () => {
  it('reads a chargeback that waits for the seller', () => {
    expect(parseDispute(first)).toMatchObject({
      paypalDisputeId: 'PP-R-IUT-10193562',
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      stage: 'CHARGEBACK',
      status: 'WAITING_FOR_SELLER_RESPONSE',
      amountMinor: 12000,
      currency: 'USD',
      requestedEvidence: ['PROOF_OF_FULFILLMENT', 'PROOF_OF_REFUND', 'PROOF_OF_DELIVERY_SIGNATURE'],
      outcomeCode: null,
    });
    expect(parseDispute(first).sellerDeadline).toEqual(new Date('2026-10-22T18:29:59.000Z'));
  });

  it('keeps a requested type listed after the seller has submitted it: PayPal still lists it', () => {
    const d = parseDispute(rav);
    expect(d.requestedEvidence).toEqual(['PROOF_OF_FULFILLMENT', 'PROOF_OF_REFUND', 'OTHER']);
    expect(d.amountMinor).toBe(5000);
    expect(d.sellerDeadline).toEqual(new Date('2026-10-29T18:29:59.000Z'));
  });

  it('reads the raw outcome code of a resolved dispute and has no deadline', () => {
    expect(parseDispute(resolved)).toMatchObject({
      status: 'RESOLVED',
      outcomeCode: 'RESOLVED_BUYER_FAVOUR',
      sellerDeadline: null,
      requestedEvidence: [],
    });
  });

  it('reads an inquiry: no seller deadline, one type requested', () => {
    expect(parseDispute(inquiry)).toMatchObject({
      stage: 'INQUIRY',
      status: 'WAITING_FOR_BUYER_RESPONSE',
      sellerDeadline: null,
      requestedEvidence: ['PROOF_OF_FULFILLMENT'],
    });
  });

  it('reads an under-review case with nothing requested', () => {
    expect(parseDispute(underReview)).toMatchObject({
      status: 'UNDER_REVIEW',
      sellerDeadline: null,
      requestedEvidence: [],
    });
  });

  it('lists each requested type once, in the order PayPal first lists it', () => {
    const d = structuredClone(first);
    d.evidences.push(structuredClone(d.evidences[1]), { evidence_type: 'OTHER', source: 'REQUESTED_FROM_SELLER' });
    expect(parseDispute(d).requestedEvidence).toEqual([
      'PROOF_OF_FULFILLMENT',
      'PROOF_OF_REFUND',
      'PROOF_OF_DELIVERY_SIGNATURE',
      'OTHER',
    ]);
  });

  it('ignores evidence the buyer or seller submitted when listing what is requested', () => {
    const d = structuredClone(rav);
    d.evidences = d.evidences.filter((e: { source: string }) => e.source !== 'REQUESTED_FROM_SELLER');
    expect(parseDispute(d).requestedEvidence).toEqual([]);
  });

  it('works when PayPal sends no evidences at all', () => {
    const d = structuredClone(first);
    delete d.evidences;
    expect(parseDispute(d).requestedEvidence).toEqual([]);
  });

  it('drops a requested type that is not a plain code instead of storing it', () => {
    const d = structuredClone(first);
    d.evidences.push({ evidence_type: '<script>', source: 'REQUESTED_FROM_SELLER' });
    expect(parseDispute(d).requestedEvidence).toEqual([
      'PROOF_OF_FULFILLMENT',
      'PROOF_OF_REFUND',
      'PROOF_OF_DELIVERY_SIGNATURE',
    ]);
  });

  it('stores amounts as integer minor units, with no float on the way', () => {
    const d = structuredClone(first);
    d.dispute_amount = { currency_code: 'JPY', value: '5000' };
    expect(parseDispute(d)).toMatchObject({ amountMinor: 5000, currency: 'JPY' });
    d.dispute_amount = { currency_code: 'USD', value: '0.10' };
    expect(parseDispute(d).amountMinor).toBe(10);
  });
});

describe('parseDispute: refuses what it cannot trust', () => {
  const broken = (mutate: (d: Record<string, unknown>) => void) => {
    const d = structuredClone(first);
    mutate(d);
    return d;
  };
  it.each([
    ['not an object', null],
    ['an array', []],
    ['no dispute id', broken((d) => delete d.dispute_id)],
    ['a dispute id with symbols', broken((d) => (d.dispute_id = "PP-R-X'; DROP TABLE x;--"))],
    ['no status', broken((d) => delete d.status)],
    ['no reason', broken((d) => delete d.reason)],
    ['no life-cycle stage', broken((d) => delete d.dispute_life_cycle_stage)],
    ['no amount', broken((d) => delete d.dispute_amount)],
    ['an amount that is a number', broken((d) => (d.dispute_amount = { currency_code: 'USD', value: 50 }))],
    ['an amount with too many decimals', broken((d) => (d.dispute_amount = { currency_code: 'USD', value: '12.345' }))],
    ['a currency that is not a code', broken((d) => (d.dispute_amount = { currency_code: 'usd', value: '1.00' }))],
    ['a deadline that is not a date', broken((d) => (d.seller_response_due_date = 'soon'))],
  ])('throws DisputeParseError for %s', (_name, details) => {
    expect(() => parseDispute(details)).toThrow(DisputeParseError);
  });
});
