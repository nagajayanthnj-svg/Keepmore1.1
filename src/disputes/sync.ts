// syncDispute (T-203): one fresh GET of a dispute, stored as a case. Called by the webhook receiver
// now, and by the poller and the sync button (T-205). It only reads from PayPal and never writes to it.
import type { Db } from '../lib/db';
import { systemClock, type Clock } from '../lib/clock';
import type { PayPalClient } from '../paypal/client';
import { allowedActions } from './allowed-actions';
import { DISPUTE_ID, DisputeParseError, parseDispute } from './parse';

export interface SyncDeps {
  db: Db;
  paypal: PayPalClient;
  clock?: Clock;
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
  };

  let existing = await deps.db.disputeCase.findUnique({ where: { paypalDisputeId: disputeId } });
  if (!existing) {
    try {
      await deps.db.disputeCase.create({ data: { paypalDisputeId: disputeId, allowedActionsJson, ...fields } });
      return { disputeId, created: true, changed: true, rawHash: d.rawHash };
    } catch (e) {
      // A concurrent sync made the row first: carry on as an update.
      existing = await deps.db.disputeCase.findUnique({ where: { paypalDisputeId: disputeId } });
      if (!existing) throw e;
    }
  }
  const changed = existing.rawHash !== d.rawHash;
  await deps.db.disputeCase.update({
    where: { paypalDisputeId: disputeId },
    data: changed ? { ...fields, allowedActionsJson } : { lastSyncedAt, allowedActionsJson },
  });
  return { disputeId, created: false, changed, rawHash: d.rawHash };
}
