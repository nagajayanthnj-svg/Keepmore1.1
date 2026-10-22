import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnalysisSchema, ACTION_VALUES } from '../../src/ai/schema';
import { validateClaims } from '../../src/ai/validate-claims';
import type { CaseFile } from '../../src/case/case-file';

const ev01 = JSON.parse(readFileSync('eval/cases/EV-01.json', 'utf8')).caseFile as CaseFile;
const ORDER = 'REC-A1E0FD3A94';
const CAPTURE = 'REC-D48C86874E';
const SHIP = 'REC-FBC79863F3';
const TRANSIT = 'REC-75F0702B0A';
const DELIVERED = 'REC-7EBD6DD0C4';
const MSG = 'REC-F8628BE5D5';

const base = { recommendedAction: 'SEND_MESSAGE', approvalRequired: true, urgent: false, summary: 'x', draft: null };
const parse = (claims: unknown[], draft: unknown = null) =>
  AnalysisSchema.parse({ ...base, claims, draft });
const one = (claim: Record<string, unknown>, cf: CaseFile = ev01) => {
  const out = parse([{ id: 'c1', ...claim }]);
  return validateClaims(out, cf).results[0]!;
};

describe('T-303 output schema', () => {
  it('accepts a valid fixture', () => {
    const out = parse(
      [{ id: 'c1', type: 'SHIPPED', carrier: 'INDIA_POST', trackingNo: 'EE100007919IN', date: '2026-09-22', recordIds: [SHIP] }],
      { text: 'Hello', claimIds: ['c1'] },
    );
    expect(out.claims).toHaveLength(1);
  });
  it('rejects an unknown action', () => {
    expect(() => AnalysisSchema.parse({ ...base, recommendedAction: 'REFUND_NOW', claims: [] })).toThrow();
  });
  it('rejects an unknown claim type', () => {
    expect(() => parse([{ id: 'c1', type: 'SIGNED_FOR', recordIds: [SHIP] }])).toThrow();
  });
  it('rejects a draft that cites a claim id that does not exist', () => {
    expect(() => parse([], { text: 'Hi', claimIds: ['nope'] })).toThrow();
  });
  it('lists all seven actions', () => {
    expect(ACTION_VALUES).toContain('NO_ACTION');
    expect(ACTION_VALUES).toHaveLength(7);
  });
});

describe('T-304 claim validator', () => {
  it('SUPPORTED: shipment details match', () => {
    const r = one({ type: 'SHIPPED', carrier: 'INDIA_POST', trackingNo: 'EE100007919IN', date: '2026-09-22', recordIds: [SHIP] });
    expect(r.result).toBe('SUPPORTED');
  });
  it('NEAR_MATCH: date off by one day', () => {
    const r = one({ type: 'SHIPPED', carrier: 'INDIA_POST', trackingNo: 'EE100007919IN', date: '2026-09-23', recordIds: [SHIP] });
    expect(r.result).toBe('NEAR_MATCH');
  });
  it('MISMATCH: wrong tracking number', () => {
    const r = one({ type: 'SHIPPED', carrier: 'INDIA_POST', trackingNo: 'EE999999999IN', date: '2026-09-22', recordIds: [SHIP] });
    expect(r.result).toBe('MISMATCH');
  });
  it('MISMATCH: date two days off', () => {
    const r = one({ type: 'DELIVERED', date: '2026-10-03', recordIds: [DELIVERED] });
    expect(r.result).toBe('MISMATCH');
  });
  it('SUPPORTED: seller-entered delivery on the right date', () => {
    expect(one({ type: 'DELIVERED', date: '2026-10-01', recordIds: [DELIVERED] }).result).toBe('SUPPORTED');
  });
  it('MISMATCH: a delivery claim citing an in-transit event', () => {
    expect(one({ type: 'DELIVERED', date: '2026-09-24', recordIds: [TRANSIT] }).result).toBe('MISMATCH');
  });
  it('SUPPORTED: amounts from order and capture', () => {
    expect(one({ type: 'ORDER_AMOUNT', minor: 4500, currency: 'USD', recordIds: [ORDER] }).result).toBe('SUPPORTED');
    expect(one({ type: 'CAPTURE_AMOUNT', minor: 4500, currency: 'USD', recordIds: [CAPTURE] }).result).toBe('SUPPORTED');
    expect(one({ type: 'CAPTURE_AMOUNT', minor: 4400, currency: 'USD', recordIds: [CAPTURE] }).result).toBe('MISMATCH');
  });
  it('SUPPORTED: seller protection value', () => {
    expect(one({ type: 'SELLER_PROTECTION', value: 'ELIGIBLE', recordIds: [CAPTURE] }).result).toBe('SUPPORTED');
    expect(one({ type: 'SELLER_PROTECTION', value: 'NOT_ELIGIBLE', recordIds: [CAPTURE] }).result).toBe('MISMATCH');
  });
  it('BUYER_SAID: the words must appear in the buyer message', () => {
    expect(one({ type: 'BUYER_SAID', quote: 'has not arrived', recordIds: [MSG] }).result).toBe('SUPPORTED');
    expect(one({ type: 'BUYER_SAID', quote: 'I want a refund', recordIds: [MSG] }).result).toBe('MISMATCH');
  });
  it('UNVERIFIED: an untyped claim', () => {
    expect(one({ type: 'UNTYPED', text: 'The parcel was signed for', recordIds: [SHIP] }).result).toBe('UNVERIFIED');
  });
  it('UNVERIFIED: a typed claim with no cited record', () => {
    expect(one({ type: 'DELIVERED', date: '2026-10-01', recordIds: [] }).result).toBe('UNVERIFIED');
  });
  it('UNVERIFIED: cited record is of the wrong kind for the claim', () => {
    expect(one({ type: 'SHIPPED', carrier: 'INDIA_POST', trackingNo: 'EE100007919IN', date: '2026-09-22', recordIds: [ORDER] }).result).toBe('UNVERIFIED');
  });
  it('hallucinated citation: a record id not in the case file', () => {
    const out = parse([{ id: 'c1', type: 'DELIVERED', date: '2026-10-01', recordIds: ['REC-0000000000'] }]);
    const v = validateClaims(out, ev01);
    expect(v.results[0]!.result).toBe('MISMATCH');
    expect(v.hallucinatedCitations).toEqual(['REC-0000000000']);
  });

  describe('trust and delivery rules', () => {
    const withEvent = (status: string, trust: string): CaseFile => ({
      ...ev01,
      evidence: ev01.evidence.map((e) =>
        e.id === DELIVERED ? { ...e, trustState: trust as never, fields: { ...e.fields, status } } : e,
      ),
    });
    it('Unknown-trust carrier event never supports a claim (Q3)', () => {
      const r = one({ type: 'DELIVERED', date: '2026-10-01', recordIds: [DELIVERED] }, withEvent('DELIVERED', 'Unknown'));
      expect(r.result).toBe('UNVERIFIED');
    });
    it('DELIVERED_TO_NEIGHBOUR never supports DELIVERED', () => {
      const r = one({ type: 'DELIVERED', date: '2026-10-01', recordIds: [DELIVERED] }, withEvent('DELIVERED_TO_NEIGHBOUR', 'Seller entered'));
      expect(r.result).toBe('MISMATCH');
    });
    it('DELIVERED_TO_NEIGHBOUR can be claimed as its own type', () => {
      const r = one({ type: 'DELIVERED_TO_NEIGHBOUR', date: '2026-10-01', recordIds: [DELIVERED] }, withEvent('DELIVERED_TO_NEIGHBOUR', 'Seller entered'));
      expect(r.result).toBe('SUPPORTED');
    });
  });

  describe('drafts', () => {
    it('allows a draft whose claims are all SUPPORTED', () => {
      const out = parse(
        [{ id: 'c1', type: 'DELIVERED', date: '2026-10-01', recordIds: [DELIVERED] }],
        { text: 'Tracking shows delivery', claimIds: ['c1'] },
      );
      expect(validateClaims(out, ev01).draftBlocked).toBe(false);
    });
    it('blocks a draft that cites a NEAR_MATCH claim', () => {
      const out = parse(
        [{ id: 'c1', type: 'DELIVERED', date: '2026-10-02', recordIds: [DELIVERED] }],
        { text: 'x', claimIds: ['c1'] },
      );
      const v = validateClaims(out, ev01);
      expect(v.results[0]!.result).toBe('NEAR_MATCH');
      expect(v.draftBlocked).toBe(true);
    });
    it('does not block when the unsupported claim is not cited by the draft', () => {
      const out = parse(
        [
          { id: 'c1', type: 'UNTYPED', text: 'signed for', recordIds: [] },
          { id: 'c2', type: 'DELIVERED', date: '2026-10-01', recordIds: [DELIVERED] },
        ],
        { text: 'x', claimIds: ['c2'] },
      );
      expect(validateClaims(out, ev01).draftBlocked).toBe(false);
    });
  });
});
