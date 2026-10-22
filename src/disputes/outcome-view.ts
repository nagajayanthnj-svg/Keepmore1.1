// What the outcome screen (T-404) shows: how the dispute ended and what money moved, each amount apart with its
// source. Read from our ledger only (the lines T-403 wrote from PayPal's own money lines). No net cost is shown:
// whether a lost dispute also keeps the original fee is UNVERIFIED (DECISIONS, T-403).
import { DEMO_DISPUTE_PREFIX } from '../demo/disputes';
import type { Db } from '../lib/db';
import { truthStateForSource, type TruthState } from '../lib/truth-state';
import { classifyOutcome, type OutcomeKind } from './outcome';
import { DISPUTE_ID } from './parse';

const CASE_ID = /^[a-z0-9]{20,40}$/i;

export interface Bucket {
  minor: number;
  currency: string;
  /** The label of the lines in it; null when there are none; Unknown when they disagree. */
  truthState: TruthState | null;
}
export interface OutcomeLine {
  type: string;
  minor: number;
  currency: string;
  occurredAt: string;
  truthState: TruthState;
  sourceRef: string | null;
}
export interface OutcomeView {
  caseId: string;
  disputeId: string;
  status: string;
  decided: boolean;
  kind: OutcomeKind;
  verified: boolean;
  outcomeCode: string | null;
  amountMinor: number;
  currency: string;
  orderRef: string | null;
  demo: boolean;
  buckets: { refunded: Bucket; fees: Bucket; retained: Bucket };
  lines: OutcomeLine[];
}

export async function loadOutcome(db: Db, id: string): Promise<OutcomeView | null> {
  const where = DISPUTE_ID.test(id) ? { paypalDisputeId: id } : CASE_ID.test(id) ? { id } : null;
  if (!where) return null;
  const c = await db.disputeCase.findUnique({ where, include: { order: { select: { paypalOrderId: true } } } });
  if (!c) return null;
  const rows = c.orderId
    ? await db.ledgerEntry.findMany({ where: { orderId: c.orderId, sourceRef: c.paypalDisputeId }, orderBy: { occurredAt: 'asc' } })
    : [];
  const lines: OutcomeLine[] = rows.map((r) => ({
    type: r.type,
    minor: r.amountMinor,
    currency: r.currency,
    occurredAt: r.occurredAt.toISOString(),
    truthState: truthStateForSource(r.sourceType),
    sourceRef: r.sourceRef,
  }));
  const bucket = (type: string): Bucket => {
    const mine = lines.filter((l) => l.type === type);
    const labels = [...new Set(mine.map((l) => l.truthState))];
    return {
      minor: mine.reduce((s, l) => s + l.minor, 0),
      currency: mine[0]?.currency ?? c.currency,
      truthState: labels.length === 0 ? null : labels.length === 1 ? labels[0]! : 'Unknown',
    };
  };
  const { kind, verified } = classifyOutcome(c.outcomeCode);
  return {
    caseId: c.id,
    disputeId: c.paypalDisputeId,
    status: c.status,
    decided: c.status === 'RESOLVED',
    kind,
    verified,
    outcomeCode: c.outcomeCode,
    amountMinor: c.amountMinor,
    currency: c.currency,
    orderRef: c.order?.paypalOrderId ?? null,
    demo: c.paypalDisputeId.startsWith(DEMO_DISPUTE_PREFIX),
    buckets: { refunded: bucket('REFUND'), fees: bucket('DISPUTE_FEE'), retained: bucket('RETAINED') },
    lines,
  };
}
