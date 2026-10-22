// SANDBOX ONLY (T-402, owner decision 4 of 22 Oct): the seller approves a "Sandbox-simulated adjudication", which
// stands in for PayPal staff deciding the case. Approving here writes nothing; the write is submitSandboxSettle in
// actions.ts, like every other dispute write. Both refuse unless DEMO_MODE is on. The client is sandbox-only already
// (paypalBaseUrl refuses any other host). Body values are the ones PayPal accepted in T-009.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../lib/db';
import { systemClock, type Clock } from '../lib/clock';
import type { PayPalClient } from '../paypal/client';
import { getAllowedActions } from './allowed-actions';
import { canonicalPayload, payloadHash } from './approval-payload';
import { DEMO_DISPUTE_PREFIX } from '../demo/disputes';
import { isStale } from './poller';

export const SETTLE_ACTION = 'SANDBOX_ADJUDICATE';
export const SETTLE_LABEL = 'Sandbox-simulated adjudication';
/** SELLER_FAVOR was accepted by PayPal in T-009. BUYER_FAVOR is in PayPal's docs but UNVERIFIED here. */
export const SETTLE_OUTCOMES = ['SELLER_FAVOR', 'BUYER_FAVOR'] as const;

export interface SettleDeps {
  db: Db;
  paypal: PayPalClient;
  clock?: Clock;
  demoMode: boolean;
}

export type SettleApproveResult =
  | { ok: true; approval: { id: string; idempotencyKey: string; payloadHash: string } }
  | {
      ok: false;
      code: 'DEMO_MODE_OFF' | 'CASE_NOT_FOUND' | 'DEMO_CASE' | 'STALE' | 'CASE_CHANGED' | 'NOT_OFFERED' | 'INVALID_PAYLOAD';
    };

const Payload = z.strictObject({ adjudicationOutcome: z.enum(SETTLE_OUTCOMES) });

export async function approveSandboxSettle(
  deps: SettleDeps,
  input: { caseId: string; outcome: string; expectedRawHash: string; approvedBy: string },
): Promise<SettleApproveResult> {
  if (!deps.demoMode) return { ok: false, code: 'DEMO_MODE_OFF' };
  const now = (deps.clock ?? systemClock)();
  const parsed = Payload.safeParse({ adjudicationOutcome: input.outcome });
  if (!parsed.success) return { ok: false, code: 'INVALID_PAYLOAD' };
  const c = await deps.db.disputeCase.findUnique({ where: { id: input.caseId } });
  if (!c) return { ok: false, code: 'CASE_NOT_FOUND' };
  if (c.paypalDisputeId.startsWith(DEMO_DISPUTE_PREFIX)) return { ok: false, code: 'DEMO_CASE' };
  if (isStale(c.lastSyncedAt, now)) return { ok: false, code: 'STALE' };
  const fresh = await getAllowedActions(deps, c.paypalDisputeId);
  if (fresh.rawHash !== input.expectedRawHash || fresh.rawHash !== c.rawHash) return { ok: false, code: 'CASE_CHANGED' };
  // PayPal shows the link 25–30 min after review starts (F-39); until then there is nothing to approve.
  if (!fresh.sandboxAdjudicatePath) return { ok: false, code: 'NOT_OFFERED' };

  const hash = payloadHash(SETTLE_ACTION as never, parsed.data);
  const row = await deps.db.caseAction.create({
    data: {
      caseId: c.id,
      action: SETTLE_ACTION,
      payloadJson: canonicalPayload(parsed.data),
      payloadHash: hash,
      approvedBy: input.approvedBy,
      approvedAt: now,
      stateHashAtApproval: fresh.rawHash,
      idempotencyKey: randomUUID(),
    },
  });
  await deps.db.auditEvent.create({
    data: {
      entity: 'CaseAction',
      entityId: row.id,
      kind: 'APPROVED',
      detailJson: JSON.stringify({ action: SETTLE_ACTION, payloadHash: hash, stateHashAtApproval: fresh.rawHash, label: SETTLE_LABEL }),
    },
  });
  return { ok: true, approval: { id: row.id, idempotencyKey: row.idempotencyKey, payloadHash: hash } };
}
