import { describe, expect, it } from 'vitest';
import { OUTCOMES, classifyOutcome, shouldRetain } from '../../src/disputes/outcome';

describe('outcome mapping table (T-403)', () => {
  it('the two codes seen in the sandbox (T-008/T-009) are marked verified', () => {
    expect(classifyOutcome('RESOLVED_SELLER_FAVOUR')).toEqual({ kind: 'WON', verified: true });
    expect(classifyOutcome('RESOLVED_BUYER_FAVOUR')).toEqual({ kind: 'LOST', verified: true });
  });
  it('the other documented codes are mapped but unverified', () => {
    expect(classifyOutcome('CANCELED_BY_BUYER')).toEqual({ kind: 'CANCELLED', verified: false });
    for (const c of ['RESOLVED_WITH_PAYOUT', 'ACCEPTED', 'DENIED', 'NONE']) expect(classifyOutcome(c).verified).toBe(false);
  });
  it('an unknown or missing code is UNKNOWN, never a win', () => {
    expect(classifyOutcome('SOMETHING_NEW')).toEqual({ kind: 'UNKNOWN', verified: false });
    expect(classifyOutcome(null)).toEqual({ kind: 'UNKNOWN', verified: false });
  });
  it('every row has a kind', () => expect(Object.values(OUTCOMES).every((o) => o.kind)).toBe(true));
});

describe('the retained rule (TDD: seller-favourable or buyer-cancelled, and no refund for this capture)', () => {
  it('seller-favourable with no refund: retained', () => expect(shouldRetain('WON', false)).toBe(true));
  it('seller-favourable but a refund exists: not retained', () => expect(shouldRetain('WON', true)).toBe(false));
  it('buyer cancelled with no refund: retained', () => expect(shouldRetain('CANCELLED', false)).toBe(true));
  it('buyer cancelled with a refund: not retained', () => expect(shouldRetain('CANCELLED', true)).toBe(false));
  it('lost or unknown: never retained', () => {
    expect(shouldRetain('LOST', false)).toBe(false);
    expect(shouldRetain('UNKNOWN', false)).toBe(false);
  });
});
