// Approval service (T-209): the seller approves one exact payload for one dispute action.
// It stores the payload, its hash and the dispute's state hash, and writes nothing to PayPal.
// The action service (T-210) calls verifyApproval before any write. Approval is not permission to write:
// that is the action gate, read fresh from PayPal.
import { randomUUID } from 'node:crypto';
import type { Db } from '../lib/db';
import { systemClock, type Clock } from '../lib/clock';
import type { PayPalClient } from '../paypal/client';
import { getAllowedActions, hasAction, type ActionCode } from './allowed-actions';
import { canonicalPayload, parseApprovalPayload, payloadHash } from './approval-payload';
import { isStale } from './poller';

export interface ApprovalDeps {
  db: Db;
  paypal: PayPalClient;
  clock?: Clock;
}

export interface ApproveInput {
  caseId: string;
  action: ActionCode;
  payload: unknown;
  /** The case's `rawHash` as the seller saw it on screen. */
  expectedRawHash: string;
  approvedBy: string;
}

export type ApprovalFailure =
  | 'CASE_NOT_FOUND'
  | 'INVALID_APPROVER'
  | 'STALE'
  | 'ACTION_NOT_ALLOWED'
  | 'INVALID_PAYLOAD'
  | 'TYPE_NOT_OFFERED'
  | 'CASE_CHANGED';

export type ApproveResult =
  | {
      ok: true;
      /** False when an identical approval was already waiting and is returned unchanged. */
      created: boolean;
      approval: {
        id: string;
        idempotencyKey: string;
        payloadHash: string;
        stateHashAtApproval: string;
        approvedAt: Date;
      };
    }
  | { ok: false; code: ApprovalFailure; issues?: string[] };

const APPROVER = /^[A-Za-z0-9_.-]{1,64}$/;

export async function approveAction(deps: ApprovalDeps, input: ApproveInput): Promise<ApproveResult> {
  const now = (deps.clock ?? systemClock)();
  if (!APPROVER.test(input.approvedBy)) return { ok: false, code: 'INVALID_APPROVER' };
  const c = await deps.db.disputeCase.findUnique({ where: { id: input.caseId } });
  if (!c) return { ok: false, code: 'CASE_NOT_FOUND' };
  // A stale case blocks approval (T-205), before PayPal is asked anything.
  if (isStale(c.lastSyncedAt, now)) return { ok: false, code: 'STALE' };

  const parsed = parseApprovalPayload(input.action, input.payload, c.amountMinor);
  if (!parsed.ok) return { ok: false, code: 'INVALID_PAYLOAD', issues: parsed.issues };

  // The gate is a fresh GET, never the stored copy (T-204).
  const fresh = await getAllowedActions(deps, c.paypalDisputeId);
  if (fresh.rawHash !== input.expectedRawHash || fresh.rawHash !== c.rawHash)
    return { ok: false, code: 'CASE_CHANGED' };
  if (!hasAction(fresh.allowed, input.action)) return { ok: false, code: 'ACTION_NOT_ALLOWED' };
  const type = (parsed.payload as { acceptClaimType?: string }).acceptClaimType;
  if (input.action === 'ACCEPT_CLAIM' && (!type || !fresh.allowed.acceptClaimTypes.includes(type))) {
    return { ok: false, code: 'TYPE_NOT_OFFERED' };
  }

  const hash = payloadHash(input.action, parsed.payload);
  const same = await deps.db.caseAction.findFirst({
    where: {
      caseId: c.id,
      action: input.action,
      payloadHash: hash,
      stateHashAtApproval: fresh.rawHash,
      submittedAt: null,
    },
  });
  const view = (r: NonNullable<typeof same>) => ({
    id: r.id,
    idempotencyKey: r.idempotencyKey,
    payloadHash: r.payloadHash,
    stateHashAtApproval: r.stateHashAtApproval,
    approvedAt: r.approvedAt,
  });
  if (same) return { ok: true, created: false, approval: view(same) };

  const row = await deps.db.caseAction.create({
    data: {
      caseId: c.id,
      action: input.action,
      payloadJson: canonicalPayload(parsed.payload),
      payloadHash: hash,
      approvedBy: input.approvedBy,
      approvedAt: now,
      stateHashAtApproval: fresh.rawHash,
      idempotencyKey: randomUUID(),
    },
  });
  // Hashes and codes only: the payload holds the seller's words about a buyer.
  await deps.db.auditEvent.create({
    data: {
      entity: 'CaseAction',
      entityId: row.id,
      kind: 'APPROVED',
      detailJson: JSON.stringify({
        action: input.action,
        payloadHash: hash,
        stateHashAtApproval: fresh.rawHash,
        approvedBy: input.approvedBy,
      }),
    },
  });
  return { ok: true, created: true, approval: view(row) };
}

export type VerifyFailure = 'NOT_FOUND' | 'ALREADY_SUBMITTED' | 'PAYLOAD_MISMATCH' | 'STATE_CHANGED';

export type VerifyResult =
  | { ok: true; action: ActionCode; payload: Record<string, unknown>; idempotencyKey: string; caseId: string }
  | { ok: false; code: VerifyFailure };

/**
 * Runs before a write. The stored payload must still hash to the approved hash (so an edit after approval
 * fails), a payload offered by the caller must be the approved one, the dispute must still be in the
 * state that was approved, and the approval must not have been used. The idempotency key comes back so
 * a retry reuses it.
 */
export async function verifyApproval(
  db: Db,
  approvalId: string,
  check: { currentRawHash: string; payload?: unknown },
): Promise<VerifyResult> {
  const row = await db.caseAction.findUnique({ where: { id: approvalId } });
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  if (row.submittedAt) return { ok: false, code: 'ALREADY_SUBMITTED' };
  const action = row.action as ActionCode;
  let stored: Record<string, unknown>;
  try {
    stored = JSON.parse(row.payloadJson) as Record<string, unknown>;
  } catch {
    return { ok: false, code: 'PAYLOAD_MISMATCH' };
  }
  if (payloadHash(action, stored) !== row.payloadHash) return { ok: false, code: 'PAYLOAD_MISMATCH' };
  if (check.payload !== undefined && payloadHash(action, check.payload) !== row.payloadHash) {
    return { ok: false, code: 'PAYLOAD_MISMATCH' };
  }
  if (check.currentRawHash !== row.stateHashAtApproval) return { ok: false, code: 'STATE_CHANGED' };
  return { ok: true, action, payload: stored, idempotencyKey: row.idempotencyKey, caseId: row.caseId };
}
