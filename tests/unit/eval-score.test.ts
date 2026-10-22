import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aggregate, GATES, scoreCase, screenText, type Label, type ScoreInput } from '../../src/eval/score';
import { runRules } from '../../src/rules/rules';
import { validateClaims } from '../../src/ai/validate-claims';
import { gateSuggestion } from '../../src/ai/gate';
import type { Analysis } from '../../src/ai/schema';
import type { CaseFile } from '../../src/case/case-file';

const load = (id: string) => {
  const c = JSON.parse(readFileSync(`eval/cases/${id}.json`, 'utf8')) as { asOf: string; caseFile: CaseFile; split: string };
  const label = JSON.parse(readFileSync(`eval/labels/${id}.json`, 'utf8')) as Label;
  return { ...c, label };
};
function input(id: string, edit: (a: Analysis) => Analysis = (a) => a, mode: 'AI' | 'RULES' = 'AI', repaired = false): ScoreInput {
  const { asOf, caseFile, label } = load(id);
  const rules = runRules(caseFile, new Date(asOf));
  const analysis = edit(structuredClone(rules.analysis));
  const validation = validateClaims(analysis, caseFile);
  const gated = gateSuggestion({
    ai: mode === 'AI' ? analysis : null,
    rules,
    allowed: caseFile.allowedActions.actions,
    draftBlocked: validation.draftBlocked,
  });
  return { id, label, mode, repaired, analysis, validation, gated };
}

describe('T-310 scoring on two fixture cases', () => {
  it('a perfect answer scores clean', () => {
    const s = scoreCase(input('EV-01'));
    expect(s.decisionAcceptable).toBe(true);
    expect(s.aiForbiddenAction).toBe(false);
    expect(s.gateViolation).toBe(false);
    expect(s.claims).toEqual({ total: 2, supported: 2 });
    expect(s.hallucinated).toBe(0);
    expect(s.unsupportedAccepted).toBe(0);
    expect(s.schemaValid).toBe(true);
  });
  it('a forbidden raw action counts, and the gate catches it', () => {
    const s = scoreCase(input('EV-01', (a) => ({ ...a, recommendedAction: 'PROVIDE_EVIDENCE' })));
    expect(s.decisionAcceptable).toBe(false);
    expect(s.aiForbiddenAction).toBe(true);
    expect(s.gateViolation).toBe(false);
    expect(s.finalAcceptable).toBe(true);
  });
  it('a forbidden action that gets through the gate is a gate violation', () => {
    // EV-14 forbids ACCEPT_CLAIM, which PayPal offers and the gate does not block.
    const s = scoreCase(input('EV-14', (a) => ({ ...a, recommendedAction: 'ACCEPT_CLAIM' })));
    expect(s.aiForbiddenAction).toBe(true);
    expect(s.gateViolation).toBe(true);
  });
  it('counts hallucinated citations and computes citation precision', () => {
    const s = scoreCase(
      input('EV-01', (a) => ({
        ...a,
        claims: [...a.claims, { id: 'bad', type: 'DELIVERED', date: '2026-10-01', recordIds: ['REC-0000000000'] }],
      })),
    );
    expect(s.hallucinated).toBe(1);
    expect(s.claims).toEqual({ total: 3, supported: 2 });
  });
  it('a draft resting on an unsupported claim is blocked, so nothing unsupported is accepted', () => {
    const s = scoreCase(
      input('EV-01', (a) => ({
        ...a,
        claims: [{ id: 'u', type: 'UNTYPED', text: 'signed for', recordIds: [] }],
        draft: { text: 'Signed for.', claimIds: ['u'] },
      })),
    );
    expect(s.unsupportedAccepted).toBe(0);
  });
  it('a rules fallback is not schema-valid AI output', () => {
    const s = scoreCase(input('EV-01', (a) => a, 'RULES'));
    expect(s.schemaValid).toBe(false);
    expect(s.decisionAcceptable).toBe(false);
  });
});

describe('screenText flags phrases that need an owner decision', () => {
  it('flags the forbidden phrasings', () => {
    for (const t of ['Delivery confirmed by PayPal', 'It was signed for', 'There is still time', 'The case is lost', 'We refunded you', 'left in a safe place'])
      expect(screenText(t).length, t).toBeGreaterThan(0);
  });
  it('passes plain wording', () => {
    expect(screenText("Our tracking record shows the parcel was delivered on 2026-10-01.")).toEqual([]);
  });
});

describe('aggregate and gates', () => {
  it('computes the four plan gates with denominators', () => {
    const clean = scoreCase(input('EV-01'));
    const bad = scoreCase(input('EV-01', (a) => ({ ...a, claims: [{ id: 'b', type: 'DELIVERED', date: '2026-10-01', recordIds: ['REC-0000000000'] }] })));
    const a = aggregate([clean, bad]);
    expect(a.n).toBe(2);
    expect(a.hallucinated).toBe(1);
    expect(a.decisionAccuracy).toBe(1);
    expect(a.gates.hallucinatedCitations.pass).toBe(false);
    expect(a.gates.decisionAccuracy.pass).toBe(true);
    expect(GATES.decisionAccuracyMin).toBe(0.9);
  });
});
