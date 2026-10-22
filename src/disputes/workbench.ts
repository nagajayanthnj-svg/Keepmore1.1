// What the dispute workbench (T-401) shows before any analysis: the case header, the records and what the buyer
// wrote. Read from our database only; no PayPal call. The allowed actions come later, from the analyse route.
import { buildCaseFile, type CaseFile } from '../case/case-file';
import { DEMO_DISPUTE_PREFIX } from '../demo/disputes';
import type { Db } from '../lib/db';
import type { TruthState } from '../lib/truth-state';
import { DISPUTE_ID } from './parse';
import { isStale } from './poller';

const CASE_ID = /^[a-z0-9]{20,40}$/i;

export interface WorkbenchView {
  caseId: string;
  disputeId: string;
  reason: string;
  stage: string;
  status: string;
  amountMinor: number;
  currency: string;
  deadline: string | null;
  outcomeCode: string | null;
  lastSyncedAt: string;
  stale: boolean;
  /** The dispute state the seller is looking at; an approval must quote it. */
  rawHash: string;
  demo: boolean;
  /** Where the dispute itself comes from. */
  truthState: TruthState;
  requestedEvidence: string[];
  evidence: CaseFile['evidence'];
  buyerMessages: CaseFile['buyerMessages'];
}

export async function loadWorkbench(db: Db, id: string, now: Date): Promise<WorkbenchView | null> {
  const where = DISPUTE_ID.test(id) ? { paypalDisputeId: id } : CASE_ID.test(id) ? { id } : null;
  if (!where) return null;
  const c = await db.disputeCase.findUnique({ where });
  if (!c) return null;
  const cf = await buildCaseFile(db, c.id);
  if (!cf) return null;
  const demo = c.paypalDisputeId.startsWith(DEMO_DISPUTE_PREFIX);
  return {
    caseId: c.id,
    disputeId: c.paypalDisputeId,
    reason: c.reason,
    stage: c.stage,
    status: c.status,
    amountMinor: c.amountMinor,
    currency: c.currency,
    deadline: c.sellerDeadline?.toISOString() ?? null,
    outcomeCode: c.outcomeCode,
    lastSyncedAt: c.lastSyncedAt.toISOString(),
    stale: isStale(c.lastSyncedAt, now),
    rawHash: c.rawHash,
    demo,
    truthState: demo ? 'Simulated demo' : 'Verified by PayPal',
    requestedEvidence: cf.dispute.requestedEvidence,
    evidence: cf.evidence,
    buyerMessages: cf.buyerMessages,
  };
}
