// The case file (T-301): the one sealed, PII-free record of a dispute that the rules engine, the claim
// validator and the AI see. Nothing else goes to the model. Built from our own database; no PayPal call.
// Left out on purpose: buyer name, email, address, payer id and buyer hash. Seller-written text is scrubbed.
import { createHash } from 'node:crypto';
import type { Db } from '../lib/db';
import type { TruthState } from '../lib/truth-state';
import { canonical, syncEvidenceRecords, type EvidenceType } from '../disputes/evidence';
import type { ActionCode } from '../disputes/allowed-actions';

const ACTIONS: readonly ActionCode[] = ['ACCEPT_CLAIM', 'PROVIDE_EVIDENCE', 'PROVIDE_SUPPORTING_INFO', 'SEND_MESSAGE', 'ESCALATE'];
const CODE = /^[A-Z][A-Z0-9_]{0,59}$/;

export interface CaseFileEvidence {
  id: string;
  type: EvidenceType;
  source: string;
  occurredAt: string;
  trustState: TruthState;
  fields: Record<string, unknown>;
}

export interface CaseFile {
  version: 1;
  caseId: string;
  disputeId: string;
  dispute: {
    reason: string;
    stage: string;
    status: string;
    amount: { minor: number; currency: string };
    sellerDeadline: string | null;
    requestedEvidence: string[];
    outcome: string | null;
  };
  /**
   * Display copy from the last sync. It informs the suggestion only: what may be sent is decided by a fresh
   * GET of the dispute's links when the seller approves (CLAUDE.md).
   */
  allowedActions: { actions: ActionCode[]; acceptClaimTypes: string[]; source: 'STORED_COPY' };
  orderLinked: boolean;
  evidence: CaseFileEvidence[];
  policy: {
    refundThresholdMinor: number;
    highValueBandMinor: number;
    minCarrierSample: number;
    returnlessCapPerYear: number;
    currency: string;
    returnPolicyText: string;
  } | null;
  /** Buyer messages are not stored yet (the BUYER_MESSAGE record is not built), so this is always empty. */
  buyerMessages: never[];
  /** SHA-256 of everything above: the AgentRun input hash. */
  hash: string;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /\+?\d(?:[\s().-]?\d){8,}/g;
const STREET = /\b\d{1,5}[A-Za-z]?\s+(?:[A-Za-z.]+\s+){1,3}(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Marg|Nagar|Colony)\b\.?/gi;

/** Seller-written text keeps its meaning but loses contact details a seller may have typed into it. */
export function scrubText(s: string): string {
  return s.replace(EMAIL, '[removed]').replace(PHONE, '[removed]').replace(STREET, '[removed]');
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function storedActions(json: string): CaseFile['allowedActions'] {
  const v = parseJson(json);
  const list = isObject(v) && Array.isArray(v.actions) ? v.actions : [];
  const actions = list.flatMap((a) =>
    isObject(a) && typeof a.action === 'string' && (ACTIONS as readonly string[]).includes(a.action)
      ? [a.action as ActionCode]
      : [],
  );
  const types = isObject(v) && Array.isArray(v.acceptClaimTypes) ? v.acceptClaimTypes : [];
  return {
    actions: [...new Set(actions)],
    acceptClaimTypes: types.filter((t): t is string => typeof t === 'string' && CODE.test(t)),
    source: 'STORED_COPY',
  };
}

function requested(json: string): string[] {
  const v = parseJson(json);
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string' && CODE.test(t)) : [];
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

/** Null when the case does not exist. Refreshes the case's evidence records first, so ids and content are current. */
export async function buildCaseFile(db: Db, caseId: string): Promise<Readonly<CaseFile> | null> {
  const c = await db.disputeCase.findUnique({ where: { id: caseId } });
  if (!c) return null;
  const records = await syncEvidenceRecords(db, caseId);
  const policy = await db.sellerPolicy.findFirst({ orderBy: { id: 'asc' } });

  const body: Omit<CaseFile, 'hash'> = {
    version: 1,
    caseId: c.id,
    disputeId: c.paypalDisputeId,
    dispute: {
      reason: c.reason,
      stage: c.stage,
      status: c.status,
      amount: { minor: c.amountMinor, currency: c.currency },
      sellerDeadline: c.sellerDeadline ? c.sellerDeadline.toISOString() : null,
      requestedEvidence: requested(c.requestedEvidence),
      outcome: c.outcomeCode,
    },
    allowedActions: storedActions(c.allowedActionsJson),
    orderLinked: c.orderId !== null,
    evidence: records.map((r) => ({
      id: r.id,
      type: r.type,
      source: r.source,
      occurredAt: r.occurredAt.toISOString(),
      trustState: r.trustState,
      fields: r.fields,
    })),
    policy: policy
      ? {
          refundThresholdMinor: policy.refundThresholdMinor,
          highValueBandMinor: policy.highValueBandMinor,
          minCarrierSample: policy.minCarrierSample,
          returnlessCapPerYear: policy.returnlessCapPerYear,
          currency: policy.currency,
          returnPolicyText: scrubText(policy.returnPolicyText),
        }
      : null,
    buyerMessages: [],
  };
  const hash = createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
  return deepFreeze({ ...body, hash });
}
