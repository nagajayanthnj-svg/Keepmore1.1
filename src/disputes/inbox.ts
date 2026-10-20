// The dispute inbox (T-208): what the seller sees first. Reads our database only; never PayPal.
import type { Db } from '../lib/db';
import type { TruthState } from '../lib/truth-state';
import { isStale } from './poller';

export interface InboxRow {
  /** Our case id (used in screen URLs). */
  id: string;
  /** PayPal's dispute id. */
  disputeId: string;
  orderId: string | null;
  reason: string;
  stage: string;
  status: string;
  amountMinor: number;
  currency: string;
  /** The dispute amount comes from PayPal, unless the case belongs to a demo order. */
  truthState: TruthState;
  /** ISO time PayPal gave for the seller's response, else null. */
  deadline: string | null;
  syncedAt: string;
  ageSeconds: number;
  stale: boolean;
}

export type Inbox = { ready: false } | { ready: true; rows: InboxRow[] };

/** "just now", "4 min ago", "3 h ago", "2 d ago". */
export function ageText(seconds: number): string {
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}

/** WAITING_FOR_SELLER_RESPONSE -> "Waiting for seller response". Anything that is not a plain code is returned as it is. */
export function humanise(code: string): string {
  if (!/^[A-Z][A-Z0-9_]*$/.test(code)) return code;
  const words = code.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "2026-10-22 18:29 UTC", with " · overdue" once it has passed. "None" when PayPal sent no usable deadline. */
export function deadlineText(iso: string | null, now: Date): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return 'None';
  const text = `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
  return d.getTime() < now.getTime() ? `${text} · overdue` : text;
}

const group = (r: Pick<InboxRow, 'status' | 'deadline'>) => (r.status === 'RESOLVED' ? 2 : r.deadline ? 0 : 1);

/** Earliest deadline first, then open cases with none, then resolved ones. Ties by dispute id. */
export function sortInbox<T extends Pick<InboxRow, 'status' | 'deadline' | 'disputeId'>>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const g = group(a) - group(b);
    if (g !== 0) return g;
    if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1;
    return a.disputeId < b.disputeId ? -1 : a.disputeId > b.disputeId ? 1 : 0;
  });
}

/** Every case, sorted. If the tables do not exist yet, answers { ready: false } instead of throwing. */
export async function loadInbox(db: Db, now: Date): Promise<Inbox> {
  try {
    const cases = await db.disputeCase.findMany({ include: { order: { select: { paypalOrderId: true } } } });
    const rows: InboxRow[] = cases.map((c) => ({
      id: c.id,
      disputeId: c.paypalDisputeId,
      orderId: c.orderId,
      reason: c.reason,
      stage: c.stage,
      status: c.status,
      amountMinor: c.amountMinor,
      currency: c.currency,
      truthState: c.order?.paypalOrderId.startsWith('DEMO-') ? 'Simulated demo' : 'Verified by PayPal',
      deadline: c.sellerDeadline ? c.sellerDeadline.toISOString() : null,
      syncedAt: c.lastSyncedAt.toISOString(),
      ageSeconds: Math.max(0, Math.floor((now.getTime() - c.lastSyncedAt.getTime()) / 1000)),
      stale: isStale(c.lastSyncedAt, now),
    }));
    return { ready: true, rows: sortInbox(rows) };
  } catch {
    return { ready: false };
  }
}
