// syncDispute (T-203): one fresh GET of a dispute, stored as a case. Called by the webhook receiver
// now, and by the poller and the sync button (T-205). It only reads from PayPal and never writes to it.
import type { Db } from '../lib/db';
import { systemClock, type Clock } from '../lib/clock';
import type { PayPalClient } from '../paypal/client';
import { buyerHash } from '../orders/buyer-hash';
import { allowedActions } from './allowed-actions';
import { recordOutcome } from './outcome';
import { DISPUTE_ID, DisputeParseError, parseDispute } from './parse';

export interface SyncDeps {
  db: Db;
  paypal: PayPalClient;
  clock?: Clock;
  /** Keys the buyer hash. Without a usable secret (32+ characters) no buyer hash is set. */
  hmacSecret?: string;
}

export interface SyncResult {
  disputeId: string;
  /** This call made the row. */
  created: boolean;
  /** The payload differs from the one stored before (always true on create). */
  changed: boolean;
  rawHash: string;
}

export async function syncDispute(deps: SyncDeps, disputeId: string): Promise<SyncResult> {
  if (!DISPUTE_ID.test(disputeId)) throw new Error('Not a dispute id');
  const res = await deps.paypal.get<unknown>(`/v1/customer/disputes/${encodeURIComponent(disputeId)}`);
  const d = parseDispute(res.body);
  if (d.paypalDisputeId !== disputeId) throw new DisputeParseError('PayPal returned a different dispute');

  const lastSyncedAt = (deps.clock ?? systemClock)();
  // A copy of the allowed actions, for display only. The gate is getAllowedActions (T-204), a fresh GET, never this.
  const allowedActionsJson = JSON.stringify(allowedActions(res.body));
  const fields = {
    reason: d.reason,
    stage: d.stage,
    status: d.status,
    amountMinor: d.amountMinor,
    currency: d.currency,
    sellerDeadline: d.sellerDeadline,
    requestedEvidence: JSON.stringify(d.requestedEvidence),
    outcomeCode: d.outcomeCode,
    lastSyncedAt,
    rawHash: d.rawHash,
    messagesJson: JSON.stringify(
      d.messages.map((m) => ({ postedBy: m.postedBy, at: m.at.toISOString(), text: m.text })),
    ),
  };
  // Link to the order that holds this capture, and hash the buyer. Only the hash is kept: no email, name or payer id.
  const secret = deps.hmacSecret;
  const hash = d.buyerPayerId && secret && secret.length >= 32 ? buyerHash(secret, d.buyerPayerId) : null;
  const order = d.sellerTransactionId
    ? await deps.db.order.findUnique({ where: { captureId: d.sellerTransactionId }, select: { id: true } })
    : null;

  let existing = await deps.db.disputeCase.findUnique({ where: { paypalDisputeId: disputeId } });
  if (!existing) {
    try {
      await deps.db.disputeCase.create({
        data: {
          paypalDisputeId: disputeId,
          allowedActionsJson,
          ...fields,
          orderId: order?.id ?? null,
          buyerHash: hash,
        },
      });
      await recordOutcome(deps.db, disputeId, res.body);
      return { disputeId, created: true, changed: true, rawHash: d.rawHash };
    } catch (e) {
      // A concurrent sync made the row first: carry on as an update.
      existing = await deps.db.disputeCase.findUnique({ where: { paypalDisputeId: disputeId } });
      if (!existing) throw e;
    }
  }
  const changed = existing.rawHash !== d.rawHash;
  // A link already made is never moved or cleared; a missing one is filled in even when nothing else changed.
  const links = {
    ...(existing.orderId === null && order ? { orderId: order.id } : {}),
    ...(hash && existing.buyerHash !== hash ? { buyerHash: hash } : {}),
  };
  await deps.db.disputeCase.update({
    where: { paypalDisputeId: disputeId },
    data: { ...(changed ? { ...fields, allowedActionsJson } : { lastSyncedAt, allowedActionsJson }), ...links },
  });
  await recordOutcome(deps.db, disputeId, res.body);
  return { disputeId, created: false, changed, rawHash: d.rawHash };
}
