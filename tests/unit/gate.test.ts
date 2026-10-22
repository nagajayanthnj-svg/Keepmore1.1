import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gateSuggestion } from '../../src/ai/gate';
import { runRules } from '../../src/rules/rules';
import type { Analysis } from '../../src/ai/schema';
import type { ActionCode } from '../../src/disputes/allowed-actions';
import type { CaseFile } from '../../src/case/case-file';

const load = (id: string) => JSON.parse(readFileSync(`eval/cases/${id}.json`, 'utf8')) as { asOf: string; caseFile: CaseFile };
const setup = (id: string) => {
  const { asOf, caseFile } = load(id);
  return { cf: caseFile, rules: runRules(caseFile, new Date(asOf)) };
};
const ai = (base: Analysis, over: Partial<Analysis>): Analysis => ({ ...base, ...over });
const ALL: ActionCode[] = ['ACCEPT_CLAIM', 'PROVIDE_EVIDENCE', 'PROVIDE_SUPPORTING_INFO', 'SEND_MESSAGE', 'ESCALATE'];

describe('T-306 executable action = AI suggestion ∩ allowed actions', () => {
  const { rules } = setup('EV-01'); // rules: SEND_MESSAGE

  it('uses the AI suggestion when PayPal offers it', () => {
    const g = gateSuggestion({ ai: ai(rules.analysis, { recommendedAction: 'SEND_MESSAGE' }), rules, allowed: ALL });
    expect(g).toMatchObject({ action: 'SEND_MESSAGE', source: 'AI', reason: null });
  });
  it('AI suggests ACCEPT_CLAIM when it is not allowed: not executable, rules shown with the reason', () => {
    const g = gateSuggestion({
      ai: ai(rules.analysis, { recommendedAction: 'ACCEPT_CLAIM' }),
      rules,
      allowed: ['SEND_MESSAGE', 'ESCALATE'],
    });
    expect(g.action).toBe('SEND_MESSAGE');
    expect(g.source).toBe('RULES');
    expect(g.reason).toMatch(/ACCEPT_CLAIM/);
    expect(g.reason).toMatch(/not offer/i);
  });
  it('never makes ESCALATE the recommendation, even when allowed', () => {
    const g = gateSuggestion({ ai: ai(rules.analysis, { recommendedAction: 'ESCALATE' }), rules, allowed: ALL });
    expect(g.action).toBe('SEND_MESSAGE');
    expect(g.source).toBe('RULES');
    expect(g.reason).toMatch(/escalat/i);
  });
  it('WAIT and NO_ACTION need no permission', () => {
    expect(gateSuggestion({ ai: ai(rules.analysis, { recommendedAction: 'WAIT' }), rules, allowed: [] })).toMatchObject({
      action: 'WAIT',
      source: 'AI',
      approvalRequired: false,
    });
  });
  it('approval need comes from the final action, not from what the model said', () => {
    const g = gateSuggestion({
      ai: ai(rules.analysis, { recommendedAction: 'SEND_MESSAGE', approvalRequired: false }),
      rules,
      allowed: ALL,
    });
    expect(g.approvalRequired).toBe(true);
  });
  it('rules mode (no AI) uses the rules action', () => {
    expect(gateSuggestion({ ai: null, rules, allowed: ALL })).toMatchObject({ action: 'SEND_MESSAGE', source: 'RULES', reason: null });
  });
  it('the rules action is checked against the fresh set too: if it was withdrawn, nothing is executable', () => {
    const g = gateSuggestion({ ai: null, rules, allowed: [] });
    expect(g.action).toBe('NO_ACTION');
    expect(g.approvalRequired).toBe(false);
    expect(g.reason).toMatch(/sync/i);
  });
  it('flags when the AI and the rules disagree', () => {
    const g = gateSuggestion({ ai: ai(rules.analysis, { recommendedAction: 'WAIT' }), rules, allowed: ALL });
    expect(g.agreesWithRules).toBe(false);
    expect(gateSuggestion({ ai: rules.analysis, rules, allowed: ALL }).agreesWithRules).toBe(true);
  });
  it('holds back an AI draft that cites unsupported claims and uses the rules draft', () => {
    const g = gateSuggestion({ ai: ai(rules.analysis, { draft: { text: 'AI text', claimIds: ['c-shipped'] } }), rules, allowed: ALL, draftBlocked: true });
    expect(g.source).toBe('AI');
    expect(g.draft?.text).toBe(rules.analysis.draft?.text);
    expect(g.reason).toMatch(/draft/i);
  });
  it('keeps the AI draft when it is clean', () => {
    const g = gateSuggestion({ ai: ai(rules.analysis, { draft: { text: 'AI text', claimIds: ['c-shipped'] } }), rules, allowed: ALL, draftBlocked: false });
    expect(g.draft?.text).toBe('AI text');
  });
  it('no draft when the action is not a message', () => {
    const r = setup('EV-09').rules;
    expect(gateSuggestion({ ai: null, rules: r, allowed: ALL }).draft).toBeNull();
  });
});

describe('T-306 PROVIDE_EVIDENCE needs something the records can support (seen live on EV-01)', () => {
  it('blocks PROVIDE_EVIDENCE at an inquiry with nothing requested, even though PayPal offers it', () => {
    const { rules } = setup('EV-01');
    const g = gateSuggestion({ ai: ai(rules.analysis, { recommendedAction: 'PROVIDE_EVIDENCE' }), rules, allowed: ALL });
    expect(g.action).toBe('SEND_MESSAGE');
    expect(g.source).toBe('RULES');
    expect(g.reason).toMatch(/no requested evidence/i);
  });
  it('blocks it when none of the requested types can be supported', () => {
    const { rules } = setup('EV-13');
    const g = gateSuggestion({ ai: ai(rules.analysis, { recommendedAction: 'PROVIDE_EVIDENCE' }), rules, allowed: ALL });
    expect(g.action).not.toBe('PROVIDE_EVIDENCE');
  });
  it('allows it when a requested type is supportable', () => {
    const { rules } = setup('EV-09');
    const g = gateSuggestion({ ai: ai(rules.analysis, { recommendedAction: 'PROVIDE_EVIDENCE' }), rules, allowed: ALL });
    expect(g).toMatchObject({ action: 'PROVIDE_EVIDENCE', source: 'AI' });
  });
});
