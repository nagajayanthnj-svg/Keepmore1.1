import { describe, expect, it } from 'vitest';
import { canonicalPayload, parseApprovalPayload, payloadHash } from '../../src/disputes/approval-payload';

const ok = (action: Parameters<typeof parseApprovalPayload>[0], payload: unknown, amountMinor = 12000) => {
  const r = parseApprovalPayload(action, payload, amountMinor);
  if (!r.ok) throw new Error(`expected ok: ${r.issues.join(',')}`);
  return r.payload;
};
const bad = (action: Parameters<typeof parseApprovalPayload>[0], payload: unknown, amountMinor = 12000) => {
  const r = parseApprovalPayload(action, payload, amountMinor);
  if (r.ok) throw new Error('expected a refusal');
  return r.issues;
};

describe('parseApprovalPayload: every action has exactly one allowed shape', () => {
  it('accepts a note for each action that takes one', () => {
    expect(ok('SEND_MESSAGE', { message: 'Shipped on 12 Oct.' })).toEqual({ message: 'Shipped on 12 Oct.' });
    expect(ok('ESCALATE', { note: 'Please review.' })).toEqual({ note: 'Please review.' });
    expect(ok('PROVIDE_SUPPORTING_INFO', { notes: 'Tracking attached.' })).toEqual({ notes: 'Tracking attached.' });
    expect(ok('PROVIDE_EVIDENCE', { evidences: [{ evidenceType: 'PROOF_OF_FULFILLMENT', notes: 'Posted.' }] })).toEqual(
      {
        evidences: [{ evidenceType: 'PROOF_OF_FULFILLMENT', notes: 'Posted.' }],
      },
    );
  });

  it('accept claim needs a note and a refund type (F-33: an empty body fails at PayPal)', () => {
    expect(ok('ACCEPT_CLAIM', { note: 'Refunding in full.', acceptClaimType: 'REFUND' })).toEqual({
      note: 'Refunding in full.',
      acceptClaimType: 'REFUND',
    });
    expect(bad('ACCEPT_CLAIM', {})).not.toHaveLength(0);
    expect(bad('ACCEPT_CLAIM', { note: 'x' })).toContain('acceptClaimType');
    expect(bad('ACCEPT_CLAIM', { note: '', acceptClaimType: 'REFUND' })).toContain('note');
    expect(bad('ACCEPT_CLAIM', { note: 'x', acceptClaimType: 'EVERYTHING' })).toContain('acceptClaimType');
  });

  it('a partial refund carries an integer amount in minor units, above zero and not above the dispute', () => {
    const p = { note: 'Partial.', acceptClaimType: 'PARTIAL_REFUND' };
    expect(ok('ACCEPT_CLAIM', { ...p, refundAmountMinor: 5000 })).toEqual({ ...p, refundAmountMinor: 5000 });
    expect(ok('ACCEPT_CLAIM', { ...p, refundAmountMinor: 12000 })).toMatchObject({ refundAmountMinor: 12000 });
    expect(bad('ACCEPT_CLAIM', p)).toContain('refundAmountMinor');
    for (const v of [0, -1, 12001, 50.5, '5000', '50.00', null, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(bad('ACCEPT_CLAIM', { ...p, refundAmountMinor: v })).toContain('refundAmountMinor');
    }
  });

  it('a full refund carries no amount', () => {
    expect(bad('ACCEPT_CLAIM', { note: 'x', acceptClaimType: 'REFUND', refundAmountMinor: 100 })).not.toHaveLength(0);
  });

  it('notes are 1 to 2000 characters and not only whitespace', () => {
    expect(ok('SEND_MESSAGE', { message: 'x'.repeat(2000) })).toBeTruthy();
    expect(bad('SEND_MESSAGE', { message: 'x'.repeat(2001) })).toContain('message');
    expect(bad('SEND_MESSAGE', { message: '' })).toContain('message');
    expect(bad('SEND_MESSAGE', { message: '   \n ' })).toContain('message');
  });

  it('keeps the text exactly as written: nothing is trimmed or rewritten', () => {
    expect(ok('SEND_MESSAGE', { message: '  two  spaces\n' })).toEqual({ message: '  two  spaces\n' });
  });

  it('refuses unknown keys, wrong types and extra evidence', () => {
    expect(bad('SEND_MESSAGE', { message: 'hi', extra: 1 })).not.toHaveLength(0);
    expect(bad('SEND_MESSAGE', { message: 5 })).toContain('message');
    expect(bad('SEND_MESSAGE', 'hi')).not.toHaveLength(0);
    expect(bad('SEND_MESSAGE', null)).not.toHaveLength(0);
    expect(bad('PROVIDE_EVIDENCE', { evidences: [] })).toContain('evidences');
    expect(bad('PROVIDE_EVIDENCE', { evidences: [{ evidenceType: 'lower', notes: 'x' }] })).not.toHaveLength(0);
    expect(
      bad('PROVIDE_EVIDENCE', { evidences: [{ evidenceType: 'OTHER', notes: 'x', url: 'http://x' }] }),
    ).not.toHaveLength(0);
  });

  it('issues name fields, never the values (a note can hold buyer data)', () => {
    const issues = bad('SEND_MESSAGE', { message: 5, secret: 'BUYER@EXAMPLE.COM' });
    expect(JSON.stringify(issues)).not.toContain('BUYER');
  });
});

describe('payloadHash', () => {
  it('is a SHA-256 hex of the canonical payload and does not depend on key order', () => {
    const a = { note: 'x', acceptClaimType: 'REFUND' } as const;
    const b = { acceptClaimType: 'REFUND', note: 'x' } as const;
    expect(canonicalPayload(a)).toBe(canonicalPayload(b));
    expect(payloadHash('ACCEPT_CLAIM', a)).toBe(payloadHash('ACCEPT_CLAIM', b));
    expect(payloadHash('ACCEPT_CLAIM', a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes with any character, and with the action', () => {
    const base = payloadHash('SEND_MESSAGE', { message: 'Shipped.' });
    expect(payloadHash('SEND_MESSAGE', { message: 'Shipped!' })).not.toBe(base);
    expect(payloadHash('SEND_MESSAGE', { message: 'Shipped. ' })).not.toBe(base);
    expect(payloadHash('ESCALATE', { note: 'Shipped.' })).not.toBe(base);
  });
});
