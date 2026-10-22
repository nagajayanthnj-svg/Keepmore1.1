// The action service (T-210): the only code that writes to a PayPal dispute endpoint (CLAUDE.md).
// A write needs an approval (T-209) whose payload and dispute state are unchanged, a case read from PayPal
// in the last five minutes, and an action that is in the links of a fresh GET right now.
// The request body is built by `deps.build` (T-211); this file decides whether a write may happen, not what it says.
import type { Db } from '../lib/db';
import { systemClock, type Clock } from '../lib/clock';
import { PayPalChangeNotSeenError, PayPalError, rereadUntil, type PayPalClient } from '../paypal/client';
import { getAllowedActions, hasAction, type ActionCode } from './allowed-actions';
import { verifyApproval } from './approval';
import { buildDisputeBody, type BodyContext } from './bodies';
import { DisputeParseError } from './parse';
import { isStale } from './poller';
import { SETTLE_ACTION } from './sandbox-settle';
import { syncDispute } from './sync';

export interface ActionDeps {
  db: Db;
  paypal: PayPalClient;
  clock?: Clock;
  /** Waits between re-reads. Tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for a change to show after a write (Phase 0: up to about 28 s). */
  reread?: { attempts: number; delayMs: number };
  /** Turns an approved payload into the request body. Defaults to buildDisputeBody (T-211). */
  build?: (action: ActionCode, payload: Record<string, unknown>, ctx: BodyContext) => unknown;
}

export type SubmitFailure =
  | 'NO_APPROVAL'
  | 'CASE_NOT_FOUND'
  | 'STALE'
  | 'ALREADY_SUBMITTED'
  | 'PAYLOAD_MISMATCH'
  | 'STATE_CHANGED'
  | 'ACTION_NOT_ALLOWED'
  | 'TYPE_NOT_OFFERED'
  | 'UNUSABLE_DISPUTE'
  | 'INVALID_BODY'
  | 'PAYPAL_UNAVAILABLE'
  | 'PAYPAL_REJECTED';

export type SubmitResult =
  | {
      ok: true;
      /** APPLIED: a re-read showed the dispute changed. PENDING: PayPal accepted the write but the change has not shown yet. */
      outcome: 'APPLIED' | 'PENDING';
      httpStatus: number;
      /** False when the re-sync after the write failed; the poller will catch up. */
      synced: boolean;
    }
  | {
      ok: false;
      code: SubmitFailure;
      /** True when nothing final happened and the same approval can be submitted again (same idempotency key). */
      retryable?: boolean;
      httpStatus?: number;
      paypalCode?: string;
      debugId?: string;
    };

const DEFAULT_REREAD = { attempts: 12, delayMs: 5000 };
const MAX_STORED = 4000;

/** Only codes and ids from a PayPal error: its message and details can echo what was sent. */
const errorRecord = (e: PayPalError) =>
  JSON.stringify({ name: e.code ?? null, issues: e.issues, debug_id: e.debugId ?? null, status: e.status });

export async function submitApprovedAction(deps: ActionDeps, approvalId: string): Promise<SubmitResult> {
  const now = (deps.clock ?? systemClock)();
  const approval = await deps.db.caseAction.findUnique({ where: { id: approvalId } });
  if (!approval) return { ok: false, code: 'NO_APPROVAL' };
  const c = await deps.db.disputeCase.findUnique({ where: { id: approval.caseId } });
  if (!c) return { ok: false, code: 'CASE_NOT_FOUND' };
  if (approval.submittedAt) return { ok: false, code: 'ALREADY_SUBMITTED' };
  if (isStale(c.lastSyncedAt, now)) return { ok: false, code: 'STALE' };

  // The state of the dispute right now, and the links PayPal offers right now.
  let fresh;
  try {
    fresh = await getAllowedActions(deps, c.paypalDisputeId);
  } catch (e) {
    if (e instanceof DisputeParseError) return { ok: false, code: 'UNUSABLE_DISPUTE' };
    if (e instanceof PayPalError) return { ok: false, code: 'PAYPAL_UNAVAILABLE', retryable: true };
    throw e;
  }

  const verified = await verifyApproval(deps.db, approvalId, { currentRawHash: fresh.rawHash });
  if (!verified.ok) return { ok: false, code: verified.code === 'NOT_FOUND' ? 'NO_APPROVAL' : verified.code };

  const link = fresh.allowed.actions.find((a) => a.action === verified.action);
  if (!link || !hasAction(fresh.allowed, verified.action)) return { ok: false, code: 'ACTION_NOT_ALLOWED' };
  const type = (verified.payload as { acceptClaimType?: string }).acceptClaimType;
  if (verified.action === 'ACCEPT_CLAIM' && (!type || !fresh.allowed.acceptClaimTypes.includes(type))) {
    return { ok: false, code: 'TYPE_NOT_OFFERED' };
  }

  // The body, built before anything is sent. A body that cannot be built leaves the approval unused.
  let body: unknown;
  try {
    body = (deps.build ?? buildDisputeBody)(verified.action, verified.payload, {
      currency: c.currency,
      amountMinor: c.amountMinor,
    });
  } catch {
    return { ok: false, code: 'INVALID_BODY' };
  }

  return writeAndConfirm(deps, {
    approvalId,
    action: verified.action,
    path: link.path,
    body,
    idempotencyKey: verified.idempotencyKey,
    payloadHash: approval.payloadHash,
    freshRawHash: fresh.rawHash,
    disputeId: c.paypalDisputeId,
    now,
  });
}

export type SettleSubmitFailure = SubmitFailure | 'DEMO_MODE_OFF' | 'NOT_A_SETTLE_APPROVAL' | 'NOT_OFFERED';

/**
 * SANDBOX ONLY (T-402): sends an approved "Sandbox-simulated adjudication". Same checks as a seller write: an unused
 * approval for this exact payload and dispute state, a case read in the last five minutes, and the adjudicate link
 * on a fresh GET. Refused unless DEMO_MODE is on. The outcome is recorded by the sync that follows (T-403).
 */
export async function submitSandboxSettle(
  deps: ActionDeps & { demoMode: boolean },
  approvalId: string,
): Promise<SubmitResult | { ok: false; code: SettleSubmitFailure }> {
  if (!deps.demoMode) return { ok: false, code: 'DEMO_MODE_OFF' };
  const now = (deps.clock ?? systemClock)();
  const approval = await deps.db.caseAction.findUnique({ where: { id: approvalId } });
  if (!approval) return { ok: false, code: 'NO_APPROVAL' };
  if (approval.action !== SETTLE_ACTION) return { ok: false, code: 'NOT_A_SETTLE_APPROVAL' };
  const c = await deps.db.disputeCase.findUnique({ where: { id: approval.caseId } });
  if (!c) return { ok: false, code: 'CASE_NOT_FOUND' };
  if (approval.submittedAt) return { ok: false, code: 'ALREADY_SUBMITTED' };
  if (isStale(c.lastSyncedAt, now)) return { ok: false, code: 'STALE' };
  let fresh;
  try {
    fresh = await getAllowedActions(deps, c.paypalDisputeId);
  } catch (e) {
    if (e instanceof DisputeParseError) return { ok: false, code: 'UNUSABLE_DISPUTE' };
    if (e instanceof PayPalError) return { ok: false, code: 'PAYPAL_UNAVAILABLE', retryable: true };
    throw e;
  }
  const verified = await verifyApproval(deps.db, approvalId, { currentRawHash: fresh.rawHash });
  if (!verified.ok) return { ok: false, code: verified.code === 'NOT_FOUND' ? 'NO_APPROVAL' : verified.code };
  if (!fresh.sandboxAdjudicatePath) return { ok: false, code: 'NOT_OFFERED' };
  return writeAndConfirm(deps, {
    approvalId,
    action: SETTLE_ACTION,
    path: fresh.sandboxAdjudicatePath,
    body: { adjudication_outcome: (verified.payload as { adjudicationOutcome: string }).adjudicationOutcome },
    idempotencyKey: verified.idempotencyKey,
    payloadHash: approval.payloadHash,
    freshRawHash: fresh.rawHash,
    disputeId: c.paypalDisputeId,
    now,
  });
}

interface WriteArgs {
  approvalId: string;
  action: string;
  path: string;
  body: unknown;
  idempotencyKey: string;
  payloadHash: string;
  freshRawHash: string;
  disputeId: string;
  now: Date;
}

/** The write itself, shared by the seller path and the sandbox settle step: post once, store, audit, re-read, sync. */
async function writeAndConfirm(deps: ActionDeps, w: WriteArgs): Promise<SubmitResult> {
  const { approvalId, now } = w;
  // The write. The approval's key is the PayPal-Request-Id, so a retry of an unfinished call cannot do it twice.
  let status: number;
  let responseJson: string;
  try {
    const res = await deps.paypal.post(w.path, w.body, {
      requestId: w.idempotencyKey,
    });
    status = res.status;
    responseJson = JSON.stringify(res.body ?? null).slice(0, MAX_STORED);
  } catch (e) {
    if (e instanceof PayPalError && e.status < 500 && e.status !== 429) {
      // A definite refusal: final for this approval. The seller reviews and approves again if they want.
      await deps.db.caseAction.update({
        where: { id: approvalId },
        data: { submittedAt: now, httpStatus: e.status, responseJson: errorRecord(e) },
      });
      await audit(deps.db, approvalId, 'REJECTED', {
        action: w.action,
        httpStatus: e.status,
        code: e.code ?? null,
        debugId: e.debugId ?? null,
      });
      return {
        ok: false,
        code: 'PAYPAL_REJECTED',
        httpStatus: e.status,
        ...(e.code && { paypalCode: e.code }),
        ...(e.debugId && { debugId: e.debugId }),
      };
    }
    // 5xx, 429 or no answer at all: it may or may not have happened. Same key on the retry.
    await audit(deps.db, approvalId, 'WRITE_UNCERTAIN', {
      action: w.action,
      httpStatus: e instanceof PayPalError ? e.status : null,
    });
    return {
      ok: false,
      code: 'PAYPAL_UNAVAILABLE',
      retryable: true,
      ...(e instanceof PayPalError && { httpStatus: e.status }),
    };
  }

  // Store what PayPal said before anything else can fail. Write responses carry no state.
  await deps.db.caseAction.update({
    where: { id: approvalId },
    data: { submittedAt: now, httpStatus: status, responseJson },
  });
  await audit(deps.db, approvalId, 'SUBMITTED', {
    action: w.action,
    httpStatus: status,
    payloadHash: w.payloadHash,
  });

  // Re-read until the change shows, then sync it into our case.
  let outcome: 'APPLIED' | 'PENDING' = 'APPLIED';
  try {
    await rereadUntil(
      () => getAllowedActions(deps, w.disputeId),
      (v) => v.rawHash !== w.freshRawHash,
      {
        ...(deps.reread ?? DEFAULT_REREAD),
        ...(deps.sleep && { sleep: deps.sleep }),
      },
    );
  } catch (e) {
    if (!(e instanceof PayPalChangeNotSeenError || e instanceof PayPalError || e instanceof DisputeParseError)) throw e;
    outcome = 'PENDING';
  }
  let synced = true;
  try {
    await syncDispute(deps, w.disputeId);
  } catch {
    synced = false;
  }
  return { ok: true, outcome, httpStatus: status, synced };
}

const audit = (db: Db, entityId: string, kind: string, detail: Record<string, unknown>) =>
  db.auditEvent.create({ data: { entity: 'CaseAction', entityId, kind, detailJson: JSON.stringify(detail) } });
