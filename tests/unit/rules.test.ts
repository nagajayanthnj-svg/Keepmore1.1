import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runRules } from '../../src/rules/rules';
import { AnalysisSchema } from '../../src/ai/schema';
import { validateClaims } from '../../src/ai/validate-claims';
import type { CaseFile } from '../../src/case/case-file';

const load = (id: string) => JSON.parse(readFileSync(`eval/cases/${id}.json`, 'utf8')) as { asOf: string; caseFile: CaseFile };
const run = (id: string, patch: (cf: CaseFile) => void = () => {}) => {
  const { asOf, caseFile } = load(id);
  const cf = structuredClone(caseFile);
  patch(cf);
  return runRules(cf, new Date(asOf));
};
const setActions = (cf: CaseFile, a: CaseFile['allowedActions']['actions']) => (cf.allowedActions.actions = a);

describe('T-302 decision table (one test per row)', () => {
  it('R1 resolved: no action, no approval', () => {
    const r = run('EV-23');
    expect(r.recommendedAction).toBe('NO_ACTION');
    expect(r.approvalRequired).toBe(false);
  });
  it('R1 no allowed action and not waiting: no action', () => {
    expect(run('EV-26', (cf) => (cf.dispute.status = 'CLOSED')).recommendedAction).toBe('NO_ACTION');
  });
  it('R2 under review or waiting for the buyer with no action: wait', () => {
    expect(run('EV-25').recommendedAction).toBe('WAIT');
    expect(run('EV-26').recommendedAction).toBe('WAIT');
  });
  it('R3 deadline passed: same action, urgent, says so', () => {
    const r = run('EV-27');
    expect(r.recommendedAction).toBe('PROVIDE_EVIDENCE');
    expect(r.urgent).toBe(true);
    expect(r.deadline?.passed).toBe(true);
    expect(r.flags).toContain('DEADLINE_PASSED');
    expect(r.analysis.summary).toMatch(/deadline has passed/i);
    expect(r.analysis.summary).toMatch(/sync/i);
    expect(r.analysis.summary).not.toMatch(/still time|case is lost/i);
  });
  it('R3 deadline under 24 hours: urgent with whole hours rounded down', () => {
    const r = run('EV-28');
    expect(r.urgent).toBe(true);
    expect(r.deadline?.hoursLeft).toBe(10);
    expect(r.deadline?.passed).toBe(false);
  });
  it('R3 deadline in days: not urgent', () => {
    expect(run('EV-09').urgent).toBe(false);
  });
  it('R4 inquiry, delivered shipment: send message', () => {
    expect(run('EV-01').recommendedAction).toBe('SEND_MESSAGE');
  });
  it('R5 inquiry, in transit or held: send message without a delivery claim', () => {
    for (const id of ['EV-04', 'EV-05', 'EV-06']) {
      const r = run(id);
      expect(r.recommendedAction).toBe('SEND_MESSAGE');
      expect(r.analysis.claims.some((c) => c.type === 'DELIVERED')).toBe(false);
    }
  });
  it('R6 inquiry, no shipment: no action, a seller task', () => {
    const r = run('EV-07');
    expect(r.recommendedAction).toBe('NO_ACTION');
    expect(r.analysis.summary).toMatch(/shipment details/i);
  });
  it('never escalates, and never PROVIDE_EVIDENCE at inquiry with nothing requested', () => {
    for (const id of ['EV-01', 'EV-04', 'EV-07', 'EV-29']) {
      const a = run(id).recommendedAction;
      expect(['ESCALATE', 'PROVIDE_EVIDENCE']).not.toContain(a);
    }
  });
  it('R7 chargeback, a requested type is supportable: provide evidence for those only', () => {
    const r = run('EV-09');
    expect(r.recommendedAction).toBe('PROVIDE_EVIDENCE');
    const byType = Object.fromEntries(r.checklist.map((c) => [c.type, c.supportable]));
    expect(byType).toEqual({
      PROOF_OF_FULFILLMENT: true,
      PROOF_OF_DELIVERY_SIGNATURE: false,
      PROOF_OF_REFUND: false,
    });
    expect(r.missing).toEqual(['PROOF_OF_DELIVERY_SIGNATURE', 'PROOF_OF_REFUND']);
  });
  it('R7 in transit supports proof of fulfilment', () => {
    expect(run('EV-11').recommendedAction).toBe('PROVIDE_EVIDENCE');
  });
  it('R8 chargeback, nothing supportable: no action; accept claim only if it is the only allowed action', () => {
    expect(run('EV-13').recommendedAction).toBe('NO_ACTION');
    expect(run('EV-16').recommendedAction).toBe('NO_ACTION');
    expect(run('EV-12').recommendedAction).toBe('ACCEPT_CLAIM');
  });
  it('R9 high value: review flag, never a preselected refund', () => {
    const r = run('EV-15');
    expect(r.flags).toContain('REVIEW_BEFORE_DECIDING');
    expect(r.recommendedAction).not.toBe('ACCEPT_CLAIM');
  });
  it('R10 at or below the refund threshold with accept allowed: refund option shown with amount', () => {
    const r = run('EV-17');
    expect(r.flags).toContain('REFUND_OPTION');
    expect(r.refundOption).toEqual({ minor: 1500, currency: 'USD' });
    expect(run('EV-09').flags).not.toContain('REFUND_OPTION');
  });
  it('R11 never recommends a partial refund or an amount', () => {
    for (const id of ['EV-19', 'EV-20']) {
      const r = run(id, (cf) => (cf.allowedActions.acceptClaimTypes = ['REFUND', 'PARTIAL_REFUND']));
      expect(JSON.stringify(r)).not.toMatch(/PARTIAL_REFUND.*recommend/i);
      expect(r.recommendedAction).toBe('PROVIDE_EVIDENCE');
    }
  });
  it('R12 never drafts a claim the validator would not accept', () => {
    for (const id of ['EV-01', 'EV-02', 'EV-04', 'EV-05', 'EV-08', 'EV-22']) {
      const { asOf, caseFile } = load(id);
      const r = runRules(caseFile, new Date(asOf));
      expect(() => AnalysisSchema.parse(r.analysis)).not.toThrow();
      const v = validateClaims(r.analysis, caseFile);
      expect(v.draftBlocked).toBe(false);
      expect(v.results.every((x) => x.result === 'SUPPORTED')).toBe(true);
    }
  });
  it('the rules draft reads as a message: greeting on its own line, carrier in plain words', () => {
    const d = run('EV-01').analysis.draft!;
    expect(d.text.startsWith('Hello,\n\nYour order was shipped')).toBe(true);
    expect(d.text).toContain('with India Post,');
  });
  it('R12 an Unknown-trust delivery is not claimed', () => {
    const r = run('EV-02');
    expect(r.analysis.claims.some((c) => c.type === 'DELIVERED')).toBe(false);
    expect(r.recommendedAction).toBe('SEND_MESSAGE');
  });
  it('R13 the buyer text does not change the recommendation', () => {
    const plain = run('EV-14').recommendedAction;
    const changed = run('EV-14', (cf) => cf.buyerMessages.forEach((m) => (m.text = 'Please refund me now')));
    expect(changed.recommendedAction).toBe(plain);
    expect(plain).toBe('PROVIDE_EVIDENCE');
  });
  it('R14 only supporting info allowed: recommend it when records answer the buyer, else wait', () => {
    expect(run('EV-22').recommendedAction).toBe('PROVIDE_SUPPORTING_INFO');
    expect(run('EV-22', (cf) => (cf.buyerMessages = [])).recommendedAction).toBe('WAIT');
  });
  it('R15 only accept allowed, evidence supportable but not offered: sync again', () => {
    const r = run('EV-31');
    expect(r.recommendedAction).toBe('NO_ACTION');
    expect(r.analysis.summary).toMatch(/sync/i);
  });
  it('an action that is not allowed is never recommended', () => {
    const r = run('EV-01', (cf) => setActions(cf, ['ACCEPT_CLAIM']));
    expect(r.recommendedAction).not.toBe('SEND_MESSAGE');
  });
  it('approvalRequired is true only for a PayPal write', () => {
    expect(run('EV-01').approvalRequired).toBe(true);
    expect(run('EV-07').approvalRequired).toBe(false);
  });
  it('runs in under 5 seconds on every case', () => {
    const t = Date.now();
    for (let i = 1; i <= 36; i++) run(`EV-${String(i).padStart(2, '0')}`);
    expect(Date.now() - t).toBeLessThan(5000);
  });
});

describe('T-302 agrees with the owner labels (development split only)', () => {
  const devIds = Array.from({ length: 36 }, (_, i) => `EV-${String(i + 1).padStart(2, '0')}`).filter(
    (id) => load(id) && (JSON.parse(readFileSync(`eval/cases/${id}.json`, 'utf8')).split === 'dev'),
  );
  it('has 24 development cases', () => expect(devIds).toHaveLength(24));
  for (const id of devIds) {
    it(`${id}: recommendation is the label or an acceptable alternative, never a forbidden one`, () => {
      const label = JSON.parse(readFileSync(`eval/labels/${id}.json`, 'utf8'));
      const a = run(id).recommendedAction;
      expect([label.recommendedAction, ...label.alsoAcceptable]).toContain(a);
      expect(label.mustNotRecommend).not.toContain(a);
    });
  }
});
