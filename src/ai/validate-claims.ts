// Claim validator (T-304): reads the field of each cited record and compares canonical values.
// SUPPORTED, NEAR_MATCH (a date off by one day), MISMATCH, UNVERIFIED. Only SUPPORTED claims may stand in a draft.
// Rules from the owner's labelling decisions: carrier events labelled Unknown never support a claim (Q3), and a
// DELIVERED_TO_NEIGHBOUR event never supports DELIVERED. A buyer message is evidence of what the buyer said only.
import type { CaseFile, CaseFileEvidence } from '../case/case-file';
import type { Analysis, Claim } from './schema';

export type ClaimResult = 'SUPPORTED' | 'NEAR_MATCH' | 'MISMATCH' | 'UNVERIFIED';
export interface ClaimCheck {
  claimId: string;
  result: ClaimResult;
  reason: string;
  /** Set when a later trusted tracking event replaced this status. A draft must not rest on it. */
  superseded?: string;
}
export interface Validation {
  results: ClaimCheck[];
  /** Cited record ids that are not in the case file. Counted by the evaluation. */
  hallucinatedCitations: string[];
  /** True when the draft cites any claim that is not SUPPORTED. */
  draftBlocked: boolean;
}

const RANK: Record<ClaimResult, number> = { SUPPORTED: 3, NEAR_MATCH: 2, UNVERIFIED: 1, MISMATCH: 0 };
const day = (iso: string) => iso.slice(0, 10);
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
const norm = (s: unknown) => String(s ?? '').trim().toUpperCase();
const words = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function compareDate(claimed: string, occurredAt: string): ClaimCheck['result'] {
  const d = dayDiff(claimed, day(occurredAt));
  return d === 0 ? 'SUPPORTED' : d === 1 ? 'NEAR_MATCH' : 'MISMATCH';
}

function checkEvidence(c: Claim, e: CaseFileEvidence): { result: ClaimResult; reason: string } {
  const f = e.fields;
  const ok = (result: ClaimResult, reason: string) => ({ result, reason });
  const eq = (label: string, a: unknown, b: unknown) =>
    norm(a) === norm(b) ? null : ok('MISMATCH', `${label}: claim ${String(a)}, record ${String(b)}`);
  switch (c.type) {
    case 'ORDER_AMOUNT':
    case 'CAPTURE_AMOUNT':
      return eq('amount', c.minor, f.grossMinor) ?? eq('currency', c.currency, f.currency) ?? ok('SUPPORTED', 'amount matches');
    case 'ORDER_COUNTRY':
      return eq('country', c.country, f.country) ?? ok('SUPPORTED', 'country matches');
    case 'SELLER_PROTECTION':
      return eq('sellerProtection', c.value, f.sellerProtection) ?? ok('SUPPORTED', 'matches');
    case 'SHIPPED': {
      const bad = eq('carrier', c.carrier, f.carrier) ?? eq('trackingNo', c.trackingNo, f.trackingNo);
      if (bad) return bad;
      const r = compareDate(c.date, e.occurredAt);
      return ok(r, `shipped date ${r === 'SUPPORTED' ? 'matches' : `differs (record ${day(e.occurredAt)})`}`);
    }
    case 'TRACKING_STATUS':
    case 'DELIVERED':
    case 'DELIVERED_TO_NEIGHBOUR': {
      // A carrier event we could not label is not evidence of anything (Q3).
      if (e.trustState === 'Unknown') return ok('UNVERIFIED', 'tracking event is labelled Unknown');
      const want = c.type === 'TRACKING_STATUS' ? c.status : c.type;
      const bad = eq('status', want, f.status);
      if (bad) return bad;
      const r = compareDate(c.date, e.occurredAt);
      return ok(r, `date ${r === 'SUPPORTED' ? 'matches' : `differs (record ${day(e.occurredAt)})`}`);
    }
    default:
      return ok('UNVERIFIED', 'not an evidence claim');
  }
}

const KIND: Partial<Record<Claim['type'], string>> = {
  ORDER_AMOUNT: 'ORDER',
  ORDER_COUNTRY: 'ORDER',
  CAPTURE_AMOUNT: 'CAPTURE',
  SELLER_PROTECTION: 'CAPTURE',
  SHIPPED: 'SHIPMENT',
  TRACKING_STATUS: 'TRACKING_EVENT',
  DELIVERED: 'TRACKING_EVENT',
  DELIVERED_TO_NEIGHBOUR: 'TRACKING_EVENT',
};

export function validateClaims(output: Analysis, cf: CaseFile): Validation {
  const evidence = new Map(cf.evidence.map((e) => [e.id, e]));
  const messages = new Map(cf.buyerMessages.map((m) => [m.id, m]));
  const hallucinated = new Set<string>();

  const results = output.claims.map((c): ClaimCheck => {
    const unknownIds = c.recordIds.filter((id) => !evidence.has(id) && !messages.has(id));
    unknownIds.forEach((id) => hallucinated.add(id));
    if (unknownIds.length) return { claimId: c.id, result: 'MISMATCH', reason: `cited record not in the case: ${unknownIds.join(', ')}` };
    if (c.type === 'UNTYPED') return { claimId: c.id, result: 'UNVERIFIED', reason: 'claim has no type' };
    if (c.recordIds.length === 0) return { claimId: c.id, result: 'UNVERIFIED', reason: 'no record cited' };

    if (c.type === 'BUYER_SAID') {
      const cited = c.recordIds.map((id) => messages.get(id)).filter((m) => m !== undefined);
      if (!cited.length) return { claimId: c.id, result: 'UNVERIFIED', reason: 'no buyer message cited' };
      const hit = cited.some((m) => words(m.text).includes(words(c.quote)));
      return { claimId: c.id, result: hit ? 'SUPPORTED' : 'MISMATCH', reason: hit ? 'the buyer wrote this' : 'words not in the buyer message' };
    }

    const cited = c.recordIds.map((id) => evidence.get(id)).filter((e): e is CaseFileEvidence => !!e && e.type === KIND[c.type]);
    if (!cited.length) return { claimId: c.id, result: 'UNVERIFIED', reason: `no cited ${KIND[c.type]} record` };
    const best = cited.map((e) => checkEvidence(c, e)).sort((a, b) => RANK[b.result] - RANK[a.result])[0]!;
    const out: ClaimCheck = { claimId: c.id, ...best };
    if (c.type === 'TRACKING_STATUS' && best.result === 'SUPPORTED') {
      // "In transit on 23 Sep" is true, but a draft saying so is misleading once a later trusted event says delivered.
      const at = cited.find((e) => checkEvidence(c, e).result === 'SUPPORTED')!.occurredAt;
      const later = cf.evidence
        .filter((e) => e.type === 'TRACKING_EVENT' && e.trustState !== 'Unknown' && e.occurredAt > at)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
      if (later) out.superseded = `${String(later.fields.status)} on ${day(later.occurredAt)}`;
    }
    return out;
  });

  const bad = new Set(results.filter((r) => r.result !== 'SUPPORTED' || r.superseded).map((r) => r.claimId));
  return {
    results,
    hallucinatedCitations: [...hallucinated],
    draftBlocked: (output.draft?.claimIds ?? []).some((id) => bad.has(id)),
  };
}
