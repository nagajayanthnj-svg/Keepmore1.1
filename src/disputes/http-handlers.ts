// HTTP handlers for the two seller steps on the workbench (T-401): approve one exact payload, then send it.
// Approving writes nothing to PayPal. Sending goes through the action service, the only place a dispute write
// happens (CLAUDE.md). Both re-check everything against a fresh GET; these handlers only translate to HTTP.
import { z } from 'zod';
import { PayPalError } from '../paypal/client';
import { DEMO_DISPUTE_PREFIX } from '../demo/disputes';
import { submitApprovedAction, type ActionDeps, type SubmitFailure } from './actions';
import { approveAction, type ApprovalDeps, type ApprovalFailure } from './approval';
import { DISPUTE_ID, DisputeParseError } from './parse';

const ApproveBody = z.object({
  action: z.enum(['ACCEPT_CLAIM', 'PROVIDE_EVIDENCE', 'PROVIDE_SUPPORTING_INFO', 'SEND_MESSAGE', 'ESCALATE']),
  payload: z.record(z.string(), z.unknown()),
  expectedRawHash: z.string().regex(/^[0-9a-f]{64}$/),
});
const APPROVAL_ID = /^[a-z0-9]{20,40}$/i;
/** One seller per installation; the approver name is fixed. */
const APPROVER = 'seller';

const APPROVE_STATUS: Record<ApprovalFailure, number> = {
  CASE_NOT_FOUND: 404,
  INVALID_APPROVER: 500,
  STALE: 409,
  CASE_CHANGED: 409,
  ACTION_NOT_ALLOWED: 403,
  TYPE_NOT_OFFERED: 403,
  INVALID_PAYLOAD: 422,
};
const SUBMIT_STATUS: Record<SubmitFailure, number> = {
  NO_APPROVAL: 404,
  CASE_NOT_FOUND: 404,
  STALE: 409,
  ALREADY_SUBMITTED: 409,
  PAYLOAD_MISMATCH: 409,
  STATE_CHANGED: 409,
  ACTION_NOT_ALLOWED: 403,
  TYPE_NOT_OFFERED: 403,
  INVALID_BODY: 422,
  UNUSABLE_DISPUTE: 502,
  PAYPAL_UNAVAILABLE: 502,
  PAYPAL_REJECTED: 422,
};

const unreachable = (e: unknown) =>
  e instanceof PayPalError || e instanceof DisputeParseError
    ? Response.json({ error: 'PAYPAL_UNAVAILABLE', retryable: true }, { status: 502 })
    : null;

export async function handleApprove(deps: ApprovalDeps | null, disputeId: string, body: unknown): Promise<Response> {
  if (!DISPUTE_ID.test(disputeId)) return Response.json({ error: 'BAD_DISPUTE_ID' }, { status: 400 });
  if (disputeId.startsWith(DEMO_DISPUTE_PREFIX)) return Response.json({ error: 'DEMO_CASE' }, { status: 409 });
  const parsed = ApproveBody.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'BAD_REQUEST' }, { status: 400 });
  if (!deps) return Response.json({ error: 'SERVER_MISCONFIGURED' }, { status: 500 });
  const c = await deps.db.disputeCase.findUnique({ where: { paypalDisputeId: disputeId } });
  if (!c) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    const r = await approveAction(deps, { caseId: c.id, ...parsed.data, approvedBy: APPROVER });
    if (!r.ok) return Response.json({ error: r.code, issues: r.issues }, { status: APPROVE_STATUS[r.code] });
    return Response.json(
      {
        approvalId: r.approval.id,
        created: r.created,
        payloadHash: r.approval.payloadHash,
        approvedAt: r.approval.approvedAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (e) {
    const res = unreachable(e);
    if (res) return res;
    throw e;
  }
}

export async function handleSubmit(deps: ActionDeps | null, approvalId: string): Promise<Response> {
  if (!APPROVAL_ID.test(approvalId)) return Response.json({ error: 'BAD_APPROVAL_ID' }, { status: 400 });
  if (!deps) return Response.json({ error: 'SERVER_MISCONFIGURED' }, { status: 500 });
  try {
    const r = await submitApprovedAction(deps, approvalId);
    if (r.ok) return Response.json({ outcome: r.outcome, synced: r.synced, httpStatus: r.httpStatus });
    return Response.json(
      { error: r.code, retryable: r.retryable ?? false, paypalCode: r.paypalCode, debugId: r.debugId },
      { status: SUBMIT_STATUS[r.code] },
    );
  } catch (e) {
    const res = unreachable(e);
    if (res) return res;
    throw e;
  }
}
