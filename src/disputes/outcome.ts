// Outcome mapping and the retained rule (T-403). Read from the dispute details on sync; written to the ledger once.
// Money comes from PayPal's own lines (money_movements, else fund_movements), never recalculated (CLAUDE.md).
// One mapping table. Only the codes seen in the sandbox (T-008/T-009, 19 Oct) are marked verified.
import type { Db } from '../lib/db';
import { appendLedgerEntries, type LedgerEntryInput } from '../ledger/store';
import { toMinor } from '../normalise/money';

export type OutcomeKind = 'WON' | 'LOST' | 'CANCELLED' | 'UNKNOWN';

export const OUTCOMES: Record<string, { kind: OutcomeKind; verified: boolean }> = {
  RESOLVED_SELLER_FAVOUR: { kind: 'WON', verified: true }, // PP-R-RAV-10193566, adjudicated
  RESOLVED_BUYER_FAVOUR: { kind: 'LOST', verified: true }, // PP-R-IUT-10193562, claim accepted
  CANCELED_BY_BUYER: { kind: 'CANCELLED', verified: false },
  RESOLVED_WITH_PAYOUT: { kind: 'UNKNOWN', verified: false }, // PayPal paid the buyer itself; effect on the seller unseen
  ACCEPTED: { kind: 'UNKNOWN', verified: false },
  DENIED: { kind: 'UNKNOWN', verified: false },
  NONE: { kind: 'UNKNOWN', verified: false },
};

export function classifyOutcome(code: string | null): { kind: OutcomeKind; verified: boolean } {
  return (code && OUTCOMES[code]) || { kind: 'UNKNOWN', verified: false };
}

/** TDD: retained when the case is seller-favourable or cancelled by the buyer, and no refund for this capture exists. */
export function shouldRetain(kind: OutcomeKind, refundExists: boolean): boolean {
  return (kind === 'WON' || kind === 'CANCELLED') && !refundExists;
}

const CALC = 'outcome-v1';
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(obj) : []);

/** The seller's debits from a resolved dispute, as ledger lines. Unknown reasons are left out, not guessed. */
function sellerDebits(d: Record<string, unknown>): { type: 'REFUND' | 'DISPUTE_FEE'; minor: number; currency: string; at: Date }[] {
  const money = list(d.money_movements);
  const lines = money.length
    ? money.filter((m) => m.affected_party === 'SELLER')
    : list(d.fund_movements).filter((m) => m.party === 'SELLER');
  const out: { type: 'REFUND' | 'DISPUTE_FEE'; minor: number; currency: string; at: Date }[] = [];
  for (const m of lines) {
    if (m.type !== 'DEBIT') continue;
    const type = m.reason === 'DISPUTE_SETTLEMENT' ? 'REFUND' : m.reason === 'DISPUTE_SETTLEMENT_FEE' ? 'DISPUTE_FEE' : null;
    const amount = obj(m.amount);
    if (!type || typeof amount.value !== 'string' || typeof amount.currency_code !== 'string') continue;
    const at = new Date(String(m.initiated_time));
    if (Number.isNaN(at.getTime())) continue;
    out.push({ type, minor: -toMinor(amount.value, amount.currency_code), currency: amount.currency_code, at });
  }
  return out;
}

/**
 * Called by syncDispute with the raw details. Writes nothing unless the dispute is resolved, linked to an order,
 * and has no outcome lines yet. Returns how many entries were added.
 */
export async function recordOutcome(db: Db, disputeId: string, body: unknown): Promise<number> {
  const d = obj(body);
  if (d.status !== 'RESOLVED') return 0;
  const c = await db.disputeCase.findUnique({ where: { paypalDisputeId: disputeId } });
  if (!c?.orderId) return 0;
  if (await db.ledgerEntry.findFirst({ where: { sourceRef: disputeId, calcVersion: CALC } })) return 0;

  const { kind } = classifyOutcome(c.outcomeCode);
  const base = { orderId: c.orderId, sourceType: 'PAYPAL_VERIFIED' as const, sourceRef: disputeId, calcVersion: CALC };
  const entries: LedgerEntryInput[] = sellerDebits(d).map((x) => ({
    ...base,
    type: x.type,
    amountMinor: x.minor,
    currency: x.currency,
    occurredAt: x.at,
  }));

  const refundInDetails = list(obj(d.refund_details).transactions).length > 0;
  const refundInLedger = !!(await db.ledgerEntry.findFirst({ where: { orderId: c.orderId, type: 'REFUND' } }));
  if (shouldRetain(kind, refundInDetails || refundInLedger || entries.some((e) => e.type === 'REFUND'))) {
    const when = new Date(String(d.update_time));
    entries.push({
      ...base,
      type: 'RETAINED',
      amountMinor: c.amountMinor,
      currency: c.currency,
      occurredAt: Number.isNaN(when.getTime()) ? new Date() : when,
    });
  }
  if (entries.length === 0) return 0;
  return appendLedgerEntries(db, entries);
}
