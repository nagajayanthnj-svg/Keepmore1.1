import { describe, expect, it } from 'vitest';
import { approveOutcome, canonicalText, defaultPayload, editPayload, mainText, sendOutcome } from '../../src/components/workbench/payload';
import { claimText } from '../../src/ai/claim-text';

const ctx = {
  draft: 'Hello,\n\nYour order was shipped on 2026-09-15 with India Post, tracking number DEMO0000001IN.',
  supportable: ['PROOF_OF_FULFILLMENT'],
  evidenceNote: 'Shipped on 2026-09-15 with India Post, tracking number DEMO0000001IN',
};

describe('default payloads (T-401)', () => {
  it('a message starts from the draft', () => expect(defaultPayload('SEND_MESSAGE', ctx)).toEqual({ message: ctx.draft }));
  it('supporting info starts from the draft', () =>
    expect(defaultPayload('PROVIDE_SUPPORTING_INFO', ctx)).toEqual({ notes: ctx.draft }));
  it('evidence lists only the supportable types, never a missing one', () =>
    expect(defaultPayload('PROVIDE_EVIDENCE', ctx)).toEqual({
      evidences: [{ evidenceType: 'PROOF_OF_FULFILLMENT', notes: ctx.evidenceNote }],
    }));
  it('a refund is a full refund with an empty note the seller must write (never prefilled, R9/R11)', () =>
    expect(defaultPayload('ACCEPT_CLAIM', ctx)).toEqual({ note: '', acceptClaimType: 'REFUND' }));
  it('escalating needs the seller own words too', () => expect(defaultPayload('ESCALATE', ctx)).toEqual({ note: '' }));
  it('with no draft the message is empty', () =>
    expect(defaultPayload('SEND_MESSAGE', { ...ctx, draft: null })).toEqual({ message: '' }));
});

describe('editing', () => {
  it('edits the one text field of each action', () => {
    expect(editPayload('SEND_MESSAGE', { message: 'a' }, 'b')).toEqual({ message: 'b' });
    expect(editPayload('ACCEPT_CLAIM', { note: '', acceptClaimType: 'REFUND' }, 'ok')).toEqual({ note: 'ok', acceptClaimType: 'REFUND' });
    expect(editPayload('PROVIDE_EVIDENCE', defaultPayload('PROVIDE_EVIDENCE', ctx), 'new')).toEqual({
      evidences: [{ evidenceType: 'PROOF_OF_FULFILLMENT', notes: 'new' }],
    });
    expect(mainText('PROVIDE_EVIDENCE', defaultPayload('PROVIDE_EVIDENCE', ctx))).toBe(ctx.evidenceNote);
  });
  it('shows the payload with sorted keys, as it is stored and hashed', () =>
    expect(canonicalText({ note: 'x', acceptClaimType: 'REFUND' })).toBe('{\n  "acceptClaimType": "REFUND",\n  "note": "x"\n}'));
});

describe('what the seller is told after pressing Send', () => {
  it('applied', () => expect(sendOutcome(200, { outcome: 'APPLIED' }).tone).toBe('ok'));
  it('pending says PayPal accepted it but has not shown it yet', () =>
    expect(sendOutcome(200, { outcome: 'PENDING' }).text).toMatch(/accepted.*not shown/i));
  it('a lost answer says it may have been sent, check the thread before approving again', () => {
    const m = sendOutcome(502, { error: 'PAYPAL_UNAVAILABLE', retryable: true });
    expect(m.tone).toBe('warn');
    expect(m.text).toMatch(/may have been sent/i);
    expect(m.text).toMatch(/check the .*thread before approving again/i);
  });
  it('already sent is never shown as a new success', () =>
    expect(sendOutcome(409, { error: 'ALREADY_SUBMITTED' }).text).toMatch(/already sent/i));
  it('a PayPal rejection shows its code and debug id', () => {
    const m = sendOutcome(422, { error: 'PAYPAL_REJECTED', paypalCode: 'INVALID_REQUEST', debugId: 'abc123' });
    expect(m.tone).toBe('error');
    expect(m.text).toContain('INVALID_REQUEST');
    expect(m.text).toContain('abc123');
  });
});

describe('claimText names whose tracking record it is (Q2)', () => {
  const c = { id: 'a', type: 'DELIVERED' as const, date: '2026-10-01', recordIds: ['REC-1'] };
  it('seller entered', () => expect(claimText(c, 'Seller entered')).toBe("The seller's tracking record shows delivered on 2026-10-01"));
  it('demo or unknown source stays neutral', () => expect(claimText(c, 'Simulated demo')).toBe('Tracking record shows delivered on 2026-10-01'));
});

describe('what the seller is told after pressing Approve', () => {
  it('approved shows the start of the payload hash', () => {
    const m = approveOutcome(201, { approvalId: 'x', payloadHash: 'abcdef0123456789'.repeat(4) });
    expect(m.tone).toBe('ok');
    expect(m.text).toContain('abcdef012345');
  });
  it('a demo case says nothing is sent', () => expect(approveOutcome(409, { error: 'DEMO_CASE' }).text).toMatch(/nothing is sent/i));
  it('a stale case asks for a sync', () => expect(approveOutcome(409, { error: 'STALE' }).text).toMatch(/sync/i));
  it('a changed case asks for a reload', () => expect(approveOutcome(409, { error: 'CASE_CHANGED' }).text).toMatch(/reload/i));
  it('an invalid payload names the fields', () =>
    expect(approveOutcome(422, { error: 'INVALID_PAYLOAD', issues: ['note'] }).text).toContain('note'));
  it('PayPal unreachable: nothing approved', () =>
    expect(approveOutcome(502, { error: 'PAYPAL_UNAVAILABLE' }).text).toMatch(/nothing was approved/i));
});
