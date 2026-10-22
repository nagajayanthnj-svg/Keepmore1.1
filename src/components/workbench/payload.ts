// The payload the seller approves on the workbench (T-401), built and edited in the browser. Pure.
// The server checks it again (approval-payload.ts); this only makes a sensible starting point.
// Never a refund by default (R9/R11): accepting starts with an empty note the seller must write.

export type WritableAction = 'ACCEPT_CLAIM' | 'PROVIDE_EVIDENCE' | 'PROVIDE_SUPPORTING_INFO' | 'SEND_MESSAGE' | 'ESCALATE';
export type Payload = Record<string, unknown>;

export interface PayloadContext {
  /** The shown draft message, if any. */
  draft: string | null;
  /** Requested evidence types the records support (rules checklist). Missing ones are never added. */
  supportable: string[];
  /** Plain words for the shipment, used as the evidence note. */
  evidenceNote: string;
}

export function defaultPayload(action: WritableAction, ctx: PayloadContext): Payload {
  switch (action) {
    case 'SEND_MESSAGE':
      return { message: ctx.draft ?? '' };
    case 'PROVIDE_SUPPORTING_INFO':
      return { notes: ctx.draft ?? '' };
    case 'PROVIDE_EVIDENCE':
      return { evidences: ctx.supportable.map((evidenceType) => ({ evidenceType, notes: ctx.evidenceNote })) };
    case 'ACCEPT_CLAIM':
      return { note: '', acceptClaimType: 'REFUND' };
    case 'ESCALATE':
      return { note: '' };
  }
}

const FIELD: Record<Exclude<WritableAction, 'PROVIDE_EVIDENCE'>, string> = {
  SEND_MESSAGE: 'message',
  PROVIDE_SUPPORTING_INFO: 'notes',
  ACCEPT_CLAIM: 'note',
  ESCALATE: 'note',
};

/** The text the seller edits. For evidence, one note for every supportable type. */
export function mainText(action: WritableAction, p: Payload): string {
  if (action === 'PROVIDE_EVIDENCE') return String((p.evidences as { notes: string }[] | undefined)?.[0]?.notes ?? '');
  return String(p[FIELD[action]] ?? '');
}

export function editPayload(action: WritableAction, p: Payload, text: string): Payload {
  if (action === 'PROVIDE_EVIDENCE')
    return { evidences: (p.evidences as { evidenceType: string }[]).map((e) => ({ ...e, notes: text })) };
  return { ...p, [FIELD[action]]: text };
}

function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, sorted(x)]),
    );
  return v;
}
/** Keys sorted as the server stores and hashes them; indented for reading. */
export const canonicalText = (p: Payload) => JSON.stringify(sorted(p), null, 2);

export interface Outcome {
  tone: 'ok' | 'warn' | 'error';
  text: string;
}

/** What the seller is told after pressing Send. Never "sent" unless PayPal said so. */
export function sendOutcome(status: number, body: Record<string, unknown>): Outcome {
  if (status === 200 && body.outcome === 'APPLIED') return { tone: 'ok', text: 'Sent. PayPal shows the change.' };
  if (status === 200 && body.outcome === 'PENDING')
    return { tone: 'warn', text: 'PayPal accepted it, but the change has not shown yet. Sync in a minute to check.' };
  switch (body.error) {
    case 'PAYPAL_UNAVAILABLE':
      return {
        tone: 'warn',
        text: 'No answer from PayPal. This may have been sent. Sync and check the dispute thread before approving again.',
      };
    case 'ALREADY_SUBMITTED':
      return { tone: 'warn', text: 'This approval was already sent. Nothing new was sent.' };
    case 'STALE':
    case 'STATE_CHANGED':
    case 'PAYLOAD_MISMATCH':
      return { tone: 'error', text: 'The dispute changed since you approved. Nothing was sent. Sync and approve again.' };
    case 'ACTION_NOT_ALLOWED':
    case 'TYPE_NOT_OFFERED':
      return { tone: 'error', text: 'PayPal no longer offers this action. Nothing was sent.' };
    case 'PAYPAL_REJECTED':
      return {
        tone: 'error',
        text: `PayPal refused it (${String(body.paypalCode ?? 'no code')}, debug id ${String(body.debugId ?? 'none')}). Nothing changed.`,
      };
    default:
      return { tone: 'error', text: `Not sent (${String(body.error ?? status)}).` };
  }
}

/** What the seller is told after pressing Approve. Approving never sends anything. */
export function approveOutcome(status: number, body: Record<string, unknown>): Outcome {
  if (status === 201)
    return { tone: 'ok', text: `Approved. Payload hash ${String(body.payloadHash).slice(0, 12)}…. Nothing is sent until you press Send.` };
  switch (body.error) {
    case 'DEMO_CASE':
      return { tone: 'warn', text: 'Simulated demo: approving and sending are switched off. Nothing is sent to PayPal.' };
    case 'STALE':
      return { tone: 'error', text: 'This case was last read from PayPal over five minutes ago. Sync, then approve.' };
    case 'CASE_CHANGED':
      return { tone: 'error', text: 'The dispute changed on PayPal since this page loaded. Reload the page and check again.' };
    case 'ACTION_NOT_ALLOWED':
    case 'TYPE_NOT_OFFERED':
      return { tone: 'error', text: 'PayPal no longer offers this action. Reload the page.' };
    case 'INVALID_PAYLOAD':
      return { tone: 'error', text: `Fill in: ${((body.issues as string[] | undefined) ?? []).join(', ') || 'the text'}.` };
    case 'PAYPAL_UNAVAILABLE':
      return { tone: 'error', text: 'PayPal could not be reached to check the action. Nothing was approved.' };
    default:
      return { tone: 'error', text: `Not approved (${String(body.error ?? status)}).` };
  }
}
