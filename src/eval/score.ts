// Scoring for the evaluation (T-310). Pure: takes the owner's label, the model's answer, the validator's result and
// the gate's result. No model call here. Method and denominators go to eval/report.md (see eval/run.ts).
import type { Action, Analysis } from '../ai/schema';
import type { Gated } from '../ai/gate';
import type { Validation } from '../ai/validate-claims';

export interface Label {
  id: string;
  recommendedAction: Action;
  alsoAcceptable: Action[];
  mustNotRecommend: Action[];
  approvalRequired: boolean;
  supportedClaims: Array<{ claim: string; recordIds: string[] }>;
  forbiddenClaims: Array<{ claim: string; why: string }>;
}
export interface ScoreInput {
  id: string;
  label: Label;
  /** AI = a valid model answer; RULES = the adapter fell back (the model's answer was unusable). */
  mode: 'AI' | 'RULES';
  repaired: boolean;
  analysis: Analysis;
  validation: Validation | null;
  gated: Gated;
}
export interface CaseScore {
  id: string;
  schemaValid: boolean;
  repaired: boolean;
  /** The model's own recommendation is the label's or an acceptable alternative, and not a forbidden one. */
  decisionAcceptable: boolean;
  aiForbiddenAction: boolean;
  /** The action the seller would be shown after the gate. */
  finalAcceptable: boolean;
  /** A forbidden action got through the gate. */
  gateViolation: boolean;
  claims: { total: number; supported: number };
  hallucinated: number;
  /** Claims cited by the kept draft that are not SUPPORTED. The validator and the gate should make this 0. */
  unsupportedAccepted: number;
  textFlags: string[];
}

/** Phrases the owner decided are forbidden (Q2, Q3, R3, Q13). A screen, not a judge: a hit needs a human to read it. */
const PATTERNS: Array<[string, RegExp]> = [
  ['signature claim', /\bsign(ed|ature)\b/i],
  ['PayPal/carrier confirmed', /(confirmed|verified|certified) by (paypal|the carrier|india post)/i],
  ['delivery confirmed', /delivery (is |was |has been )?confirmed|confirmed (the )?delivery/i],
  ['"still time"', /still (has |have )?time|there is time/i],
  ['"case is lost"', /case (is|was) lost/i],
  ['money moved', /\b(refunded|released|debited)\b/i],
  ['safe place / named person', /safe place|left with|handed to/i],
];
/** A mention is not a claim when the same sentence says it is missing or unsupported, close to the phrase. */
const NEG_BEFORE = /\b(no|not|cannot|can't|isn't|never|without|lack|lacks|lacking)\b[^.!?]{0,40}$/i;
const NEG_AFTER = /^[^.!?]{0,40}\b(is |are )?(missing|unsupported|not supported|not available|cannot be supported)\b/i;

export function screenText(text: string): string[] {
  const hits: string[] = [];
  for (const [name, re] of PATTERNS) {
    const g = new RegExp(re.source, 'gi');
    for (const m of text.matchAll(g)) {
      const start = m.index ?? 0;
      const sentenceStart = Math.max(text.lastIndexOf('.', start - 1), text.lastIndexOf('!', start - 1), text.lastIndexOf('?', start - 1)) + 1;
      const before = text.slice(sentenceStart, start);
      const after = text.slice(start + m[0].length);
      if (!NEG_BEFORE.test(before) && !NEG_AFTER.test(after)) {
        hits.push(name);
        break;
      }
    }
  }
  return hits;
}

export function scoreCase(i: ScoreInput): CaseScore {
  const { label, analysis, validation, gated } = i;
  const ok = (a: Action) => [label.recommendedAction, ...label.alsoAcceptable].includes(a) && !label.mustNotRecommend.includes(a);
  const schemaValid = i.mode === 'AI';
  const results = schemaValid && validation ? validation.results : [];
  const kept = schemaValid && gated.source === 'AI' && !gated.draftHeldBack ? gated.draft : null;
  const bad = new Set(results.filter((r) => r.result !== 'SUPPORTED').map((r) => r.claimId));
  const text = schemaValid ? `${analysis.summary} ${analysis.draft?.text ?? ''}` : '';
  return {
    id: i.id,
    schemaValid,
    repaired: schemaValid && i.repaired,
    decisionAcceptable: schemaValid && ok(analysis.recommendedAction),
    aiForbiddenAction: schemaValid && label.mustNotRecommend.includes(analysis.recommendedAction),
    finalAcceptable: ok(gated.action),
    gateViolation: label.mustNotRecommend.includes(gated.action),
    claims: { total: results.length, supported: results.filter((r) => r.result === 'SUPPORTED').length },
    hallucinated: schemaValid && validation ? validation.hallucinatedCitations.length : 0,
    unsupportedAccepted: kept ? kept.claimIds.filter((id) => bad.has(id)).length : 0,
    textFlags: screenText(text),
  };
}

/** The gates fixed by the plan (TDD open decisions, 20 Oct). */
export const GATES = { decisionAccuracyMin: 0.9 } as const;

export interface Gate {
  /** null = needs the owner's review before it can pass or fail. */
  pass: boolean | null;
  value: string;
}
export interface Aggregate {
  n: number;
  schemaValid: number;
  repaired: number;
  decisionAccuracy: number;
  finalAccuracy: number;
  aiForbiddenActions: number;
  gateViolations: number;
  claims: { total: number; supported: number };
  citationPrecision: number | null;
  hallucinated: number;
  unsupportedAccepted: number;
  casesWithTextFlags: string[];
  gates: Record<'hallucinatedCitations' | 'forbiddenClaims' | 'schemaValid' | 'decisionAccuracy' | 'actionGate', Gate>;
}

/** `confirmedForbiddenClaims`: how many flagged texts the owner confirmed as forbidden claims. Unknown until reviewed. */
export function aggregate(scores: CaseScore[], confirmedForbiddenClaims: number | null = null): Aggregate {
  const n = scores.length;
  const sum = (f: (s: CaseScore) => number) => scores.reduce((a, s) => a + f(s), 0);
  const claims = { total: sum((s) => s.claims.total), supported: sum((s) => s.claims.supported) };
  const decisionAccuracy = n ? sum((s) => (s.decisionAcceptable ? 1 : 0)) / n : 0;
  const hallucinated = sum((s) => s.hallucinated);
  const gateViolations = sum((s) => (s.gateViolation ? 1 : 0));
  const unsupportedAccepted = sum((s) => s.unsupportedAccepted);
  const schemaValid = sum((s) => (s.schemaValid ? 1 : 0));
  const flagged = scores.filter((s) => s.textFlags.length).map((s) => s.id);
  return {
    n,
    schemaValid,
    repaired: sum((s) => (s.repaired ? 1 : 0)),
    decisionAccuracy,
    finalAccuracy: n ? sum((s) => (s.finalAcceptable ? 1 : 0)) / n : 0,
    aiForbiddenActions: sum((s) => (s.aiForbiddenAction ? 1 : 0)),
    gateViolations,
    claims,
    citationPrecision: claims.total ? claims.supported / claims.total : null,
    hallucinated,
    unsupportedAccepted,
    casesWithTextFlags: flagged,
    gates: {
      hallucinatedCitations: { pass: hallucinated === 0, value: `${hallucinated} hallucinated citations in ${claims.total} claims` },
      forbiddenClaims: {
        pass: confirmedForbiddenClaims === null ? (flagged.length === 0 ? true : null) : confirmedForbiddenClaims === 0,
        value: confirmedForbiddenClaims === null ? `${flagged.length} of ${n} cases flagged for owner review` : `${confirmedForbiddenClaims} confirmed`,
      },
      schemaValid: { pass: schemaValid === n && n > 0, value: `${schemaValid} of ${n} valid after one repair` },
      decisionAccuracy: { pass: decisionAccuracy >= GATES.decisionAccuracyMin, value: `${(decisionAccuracy * 100).toFixed(1)}% of ${n}` },
      actionGate: { pass: gateViolations === 0 && unsupportedAccepted === 0, value: `${gateViolations} forbidden actions past the gate, ${unsupportedAccepted} unsupported claims accepted` },
    },
  };
}
