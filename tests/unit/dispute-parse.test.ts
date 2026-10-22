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

describe('parseDispute: the transaction and payer used to link a dispute (T-206)', () => {
  const real = JSON.parse(readFileSync('tests/fixtures/paypal/dispute-details-first.json', 'utf8'));
  const withTxn = (t: unknown) => ({ ...structuredClone(real), disputed_transactions: t });

  it('reads the seller transaction id (the capture id) and the payer id from the first transaction', () => {
    const d = parseDispute(real);
    expect(d.sellerTransactionId).toBe('0HE26749YS519313U');
    expect(d.buyerPayerId).toBe('REDACTED_PAYER_ID');
  });

  it.each([
    [undefined],
    [[]],
    ['x'],
    [[null]],
    [[{}]],
    [[{ seller_transaction_id: 5, buyer: { payer_id: {} } }]],
    [[{ seller_transaction_id: '../x', buyer: { payer_id: 'a b@c' } }]],
  ])('gives null, and does not fail the parse, for disputed_transactions = %j', (t) => {
    const d = parseDispute(withTxn(t));
    expect(d.sellerTransactionId).toBeNull();
    expect(d.buyerPayerId).toBeNull();
  });
});

describe('parseDispute: messages', () => {
  it('reads the real messages in time order, with who posted them', () => {
    const m = parseDispute(rav).messages;
    expect(m).toHaveLength(3);
    expect(m[0]).toEqual({ postedBy: 'BUYER', at: new Date('2026-10-19T16:07:41.708Z'), text: 'SEHTH' });
    expect(m.map((x) => x.postedBy)).toEqual(['BUYER', 'SELLER', 'SELLER']);
  });

  it('gives no messages when PayPal sends none', () => {
    expect(parseDispute(first).messages).toEqual([]);
  });

  it('drops malformed entries, labels an unknown poster OTHER, caps length and count, and never throws', () => {
    const base = { ...rav };
    const odd = [
      { posted_by: 'BUYER', time_posted: 'not a date', content: 'x' },
      { posted_by: 'BUYER', time_posted: '2026-10-19T10:00:00.000Z' },
      { posted_by: 'PAYPAL_AGENT', time_posted: '2026-10-19T10:01:00.000Z', content: 'hello' },
      { posted_by: 'BUYER', time_posted: '2026-10-19T10:02:00.000Z', content: 'y'.repeat(5000) },
      'junk',
      null,
    ];
    const d = parseDispute({ ...base, messages: odd });
    expect(d.messages.map((x) => x.postedBy)).toEqual(['OTHER', 'BUYER']);
    expect(d.messages[1]!.text).toHaveLength(2000);
    const many = Array.from({ length: 80 }, (_, i) => ({
      posted_by: 'BUYER',
      time_posted: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
      content: `m${i}`,
    }));
    const kept = parseDispute({ ...base, messages: many }).messages;
    expect(kept).toHaveLength(50);
    expect(kept.at(-1)!.text).toBe('m79');
    expect(parseDispute({ ...base, messages: 'nope' }).messages).toEqual([]);
  });
});
