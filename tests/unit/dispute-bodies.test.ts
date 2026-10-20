import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DisputeBodyError,
  MAX_EVIDENCE_FILE_BYTES,
  buildDisputeBody,
  buildEvidenceForm,
} from '../../src/disputes/bodies';

const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/paypal/${n}.json`, 'utf8'));
const ctx = { currency: 'USD', amountMinor: 12000 };

describe('buildDisputeBody: equals the requests PayPal accepted in Phase 0', () => {
  it('send-message', () => {
    const real = fx('t010-PP-R-RAV-10193566-message-2-response').request.body;
    expect(buildDisputeBody('SEND_MESSAGE', { message: real.message }, ctx)).toEqual(real);
  });
  it('escalate', () => {
    const real = fx('t010-PP-R-RAV-10193566-escalate-2-response').request.body;
    expect(buildDisputeBody('ESCALATE', { note: real.note }, ctx)).toEqual(real);
  });
  it('provide-evidence (notes only, evidence_type PROOF_OF_FULFILLMENT)', () => {
    const real = fx('t010-PP-R-RAV-10193566-evidence-2-response').request.body;
    const e = real.evidences[0];
    expect(
      buildDisputeBody('PROVIDE_EVIDENCE', { evidences: [{ evidenceType: e.evidence_type, notes: e.notes }] }, ctx),
    ).toEqual(real);
  });
  it('provide-supporting-info', () => {
    const real = fx('supporting-info-response').attempts[0].request;
    expect(buildDisputeBody('PROVIDE_SUPPORTING_INFO', { notes: real.notes }, ctx)).toEqual(real);
  });
  it('accept-claim with a full refund sends the note only, as the accepted request did', () => {
    const real = fx('t009-PP-R-IUT-10193562-accept-2-response-2026-10-19T18-54-44-257Z').request.body;
    expect(buildDisputeBody('ACCEPT_CLAIM', { note: real.note, acceptClaimType: 'REFUND' }, ctx)).toEqual(real);
  });
});

describe('buildDisputeBody: parts Phase 0 did not exercise', () => {
  it('a partial refund adds the type and the amount as a decimal string from minor units (UNVERIFIED at PayPal)', () => {
    expect(
      buildDisputeBody(
        'ACCEPT_CLAIM',
        { note: 'Partial.', acceptClaimType: 'PARTIAL_REFUND', refundAmountMinor: 2050 },
        ctx,
      ),
    ).toEqual({
      note: 'Partial.',
      accept_claim_type: 'PARTIAL_REFUND',
      refund_amount: { currency_code: 'USD', value: '20.50' },
    });
  });
  it('uses the currency exponent: a zero-decimal currency has no decimals', () => {
    const body = buildDisputeBody(
      'ACCEPT_CLAIM',
      { note: 'x', acceptClaimType: 'PARTIAL_REFUND', refundAmountMinor: 500 },
      { currency: 'JPY', amountMinor: 1000 },
    ) as { refund_amount: { value: string } };
    expect(body.refund_amount.value).toBe('500');
  });
});

describe('buildDisputeBody: refuses before anything is sent', () => {
  it('a note over 2,000 characters', () => {
    expect(() => buildDisputeBody('SEND_MESSAGE', { message: 'x'.repeat(2001) }, ctx)).toThrow(DisputeBodyError);
    expect(buildDisputeBody('SEND_MESSAGE', { message: 'x'.repeat(2000) }, ctx)).toEqual({ message: 'x'.repeat(2000) });
  });
  it('an unknown key, a missing field, a partial refund above the dispute, and a payload for another action', () => {
    expect(() => buildDisputeBody('SEND_MESSAGE', { message: 'hi', extra: 1 }, ctx)).toThrow(DisputeBodyError);
    expect(() => buildDisputeBody('ACCEPT_CLAIM', { note: 'x' }, ctx)).toThrow(DisputeBodyError);
    expect(() =>
      buildDisputeBody('ACCEPT_CLAIM', { note: 'x', acceptClaimType: 'PARTIAL_REFUND', refundAmountMinor: 12001 }, ctx),
    ).toThrow(DisputeBodyError);
    expect(() => buildDisputeBody('ESCALATE', { message: 'hi' }, ctx)).toThrow(DisputeBodyError);
  });
  it('an action it has no body for, and an error that never repeats the text', () => {
    expect(() => buildDisputeBody('MAKE_OFFER' as never, {}, ctx)).toThrow(DisputeBodyError);
    try {
      buildDisputeBody('SEND_MESSAGE', { message: 5, secret: 'BUYER@EXAMPLE.COM' }, ctx);
    } catch (e) {
      expect(String(e)).not.toContain('BUYER');
    }
  });
});

describe('buildEvidenceForm: a file with the evidence (multipart)', () => {
  const evidences = [{ evidenceType: 'PROOF_OF_FULFILLMENT', notes: 'Posted.' }];
  const pdf = { name: 'receipt.pdf', type: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) };

  it('has an `input` part with the JSON body and a file part with the bytes, name and type', async () => {
    const form = buildEvidenceForm({ evidences }, pdf);
    const input = form.get('input') as File;
    expect(JSON.parse(await input.text())).toEqual({
      evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', notes: 'Posted.' }],
    });
    expect(input.type).toBe('application/json');
    const file = form.get('evidence_file') as File;
    expect(file.name).toBe('receipt.pdf');
    expect(file.type).toBe('application/pdf');
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([37, 80, 68, 70]);
  });

  it.each(['image/jpeg', 'image/gif', 'image/png', 'application/pdf'])('accepts %s', (type) => {
    expect(() => buildEvidenceForm({ evidences }, { ...pdf, type })).not.toThrow();
  });

  it.each([['text/html'], ['image/svg+xml'], ['application/zip'], ['']])('refuses type %j', (type) => {
    expect(() => buildEvidenceForm({ evidences }, { ...pdf, type })).toThrow(DisputeBodyError);
  });

  it('refuses a file over 10 MB or empty, and a note over 2,000 characters', () => {
    const big = { ...pdf, bytes: new Uint8Array(MAX_EVIDENCE_FILE_BYTES + 1) };
    expect(() => buildEvidenceForm({ evidences }, big)).toThrow(DisputeBodyError);
    expect(() =>
      buildEvidenceForm({ evidences }, { ...pdf, bytes: new Uint8Array(MAX_EVIDENCE_FILE_BYTES) }),
    ).not.toThrow();
    expect(() => buildEvidenceForm({ evidences }, { ...pdf, bytes: new Uint8Array(0) })).toThrow(DisputeBodyError);
    expect(() => buildEvidenceForm({ evidences: [{ evidenceType: 'OTHER', notes: 'x'.repeat(2001) }] }, pdf)).toThrow(
      DisputeBodyError,
    );
  });

  it('keeps only a plain file name: no path, no control characters, at most 100 characters', () => {
    const name = (n: string) =>
      (buildEvidenceForm({ evidences }, { ...pdf, name: n }).get('evidence_file') as File).name;
    expect(name('../../etc/passwd.pdf')).toBe('passwd.pdf');
    expect(name('C:\\Users\\me\\scan.pdf')).toBe('scan.pdf');
    expect(name('a\r\nb".pdf')).toBe('ab.pdf');
    expect(name(`${'x'.repeat(200)}.pdf`)).toHaveLength(100);
    expect(name('')).toBe('evidence');
  });
});
