// The exact payload a seller approves for a dispute action (T-209), and its hash.
// Pure: no network, no database. These are our own field names; T-211 maps them to PayPal's bodies.
// Text is kept exactly as written (the hash covers what the seller saw), but never echoed into an error.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ActionCode } from './allowed-actions';

const MAX_NOTE = 2000;
const text = z
  .string()
  .max(MAX_NOTE)
  .refine((s) => s.trim().length > 0);
const CODE = /^[A-Z][A-Z0-9_]{0,59}$/;

const acceptClaim = z.union([
  z.strictObject({ note: text, acceptClaimType: z.literal('REFUND') }),
  z.strictObject({
    note: text,
    acceptClaimType: z.literal('PARTIAL_REFUND'),
    refundAmountMinor: z.number().int().safe().positive(),
  }),
]);

const SHAPES = {
  ACCEPT_CLAIM: acceptClaim,
  PROVIDE_EVIDENCE: z.strictObject({
    evidences: z
      .array(z.strictObject({ evidenceType: z.string().regex(CODE), notes: text }))
      .min(1)
      .max(10),
  }),
  PROVIDE_SUPPORTING_INFO: z.strictObject({ notes: text }),
  SEND_MESSAGE: z.strictObject({ message: text }),
  ESCALATE: z.strictObject({ note: text }),
} satisfies Record<ActionCode, z.ZodType>;

export type ApprovalPayload = Record<string, unknown>;

export type PayloadResult = { ok: true; payload: ApprovalPayload } | { ok: false; issues: string[] };

/**
 * Checks a payload against the one shape its action allows. `disputeAmountMinor` caps a partial refund.
 * Issues are field names only: a value can be buyer data.
 */
export function parseApprovalPayload(action: ActionCode, payload: unknown, disputeAmountMinor: number): PayloadResult {
  const r = SHAPES[action].safeParse(payload);
  if (!r.success) {
    const issues = r.error.issues.map((i) => i.path.join('.') || '(root)');
    // A union reports at the root; say which field is the problem for accept claim.
    if (action === 'ACCEPT_CLAIM' && payload && typeof payload === 'object') {
      const p = payload as Record<string, unknown>;
      const named = new Set<string>();
      if (typeof p.note !== 'string' || p.note.trim() === '' || p.note.length > MAX_NOTE) named.add('note');
      if (p.acceptClaimType !== 'REFUND' && p.acceptClaimType !== 'PARTIAL_REFUND') named.add('acceptClaimType');
      if (p.acceptClaimType === 'PARTIAL_REFUND') named.add('refundAmountMinor');
      if (p.acceptClaimType === 'REFUND' && 'refundAmountMinor' in p) named.add('refundAmountMinor');
      if (named.size > 0) return { ok: false, issues: [...named] };
    }
    return { ok: false, issues: [...new Set(issues)] };
  }
  const data = r.data as ApprovalPayload;
  if (
    action === 'ACCEPT_CLAIM' &&
    typeof data.refundAmountMinor === 'number' &&
    data.refundAmountMinor > disputeAmountMinor
  ) {
    return { ok: false, issues: ['refundAmountMinor'] };
  }
  return { ok: true, payload: data };
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canonical(x)]),
    );
  }
  return v;
}

/** The payload as stored and shown: keys sorted, no insignificant whitespace. */
export const canonicalPayload = (payload: unknown): string => JSON.stringify(canonical(payload));

/** SHA-256 of the action and its canonical payload, so the same words under another action hash differently. */
export const payloadHash = (action: ActionCode, payload: unknown): string =>
  createHash('sha256')
    .update(`${action}\n${canonicalPayload(payload)}`)
    .digest('hex');
