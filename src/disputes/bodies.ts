// Request bodies for the dispute write endpoints (T-211). Pure: builds a body, sends nothing.
// The JSON bodies equal requests PayPal accepted in Phase 0 (tests compare with the saved requests).
// The payload is checked again here with the same rules as approval, so a body that was never approved,
// or was edited, cannot be built. Errors name fields and never repeat text (a note can hold buyer data).
import { fromMinor } from '../normalise/money';
import type { ActionCode } from './allowed-actions';
import { parseApprovalPayload } from './approval-payload';

export class DisputeBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DisputeBodyError';
  }
}

export interface BodyContext {
  /** The dispute's currency and amount, to price a partial refund. */
  currency: string;
  amountMinor: number;
}

type Evidence = { evidenceType: string; notes: string };
const evidenceJson = (list: Evidence[]) => ({
  evidences: list.map((e) => ({ evidence_type: e.evidenceType, notes: e.notes })),
});

export function buildDisputeBody(action: ActionCode, payload: unknown, ctx: BodyContext): Record<string, unknown> {
  const known: ActionCode[] = [
    'ACCEPT_CLAIM',
    'PROVIDE_EVIDENCE',
    'PROVIDE_SUPPORTING_INFO',
    'SEND_MESSAGE',
    'ESCALATE',
  ];
  if (!known.includes(action)) throw new DisputeBodyError('No request body for this action');
  const parsed = parseApprovalPayload(action, payload, ctx.amountMinor);
  if (!parsed.ok) throw new DisputeBodyError(`Payload is not valid: ${parsed.issues.join(', ')}`);
  const p = parsed.payload as Record<string, unknown>;
  switch (action) {
    case 'SEND_MESSAGE':
      return { message: p.message };
    case 'ESCALATE':
      return { note: p.note };
    case 'PROVIDE_SUPPORTING_INFO':
      return { notes: p.notes };
    case 'PROVIDE_EVIDENCE':
      return evidenceJson(p.evidences as Evidence[]);
    case 'ACCEPT_CLAIM':
      // A full refund is the note alone, as in the request PayPal accepted. The partial form is UNVERIFIED.
      if (p.acceptClaimType === 'REFUND') return { note: p.note };
      return {
        note: p.note,
        accept_claim_type: 'PARTIAL_REFUND',
        refund_amount: { currency_code: ctx.currency, value: fromMinor(p.refundAmountMinor as number, ctx.currency) },
      };
  }
}

export const MAX_EVIDENCE_FILE_BYTES = 10 * 1024 * 1024;
const FILE_TYPES = new Set(['image/jpeg', 'image/gif', 'image/png', 'application/pdf']);

export interface EvidenceFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

/** A plain file name: no directory, no control characters or quotes, at most 100 characters. */
function safeName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f\u007f"]/g, '').slice(0, 100);
  return clean === '' ? 'evidence' : clean;
}

/**
 * Evidence with a file: JPG, GIF, PNG or PDF, up to 10 MB. Parts `input` (the JSON body) and `evidence_file`.
 * UNVERIFIED at PayPal: Phase 0's multipart attempts were refused for the evidence type, not the format,
 * and the file part's name comes from PayPal's documentation, not from a request that succeeded.
 */
export function buildEvidenceForm(payload: { evidences: Evidence[] }, file: EvidenceFile): FormData {
  const parsed = parseApprovalPayload('PROVIDE_EVIDENCE', payload, 0);
  if (!parsed.ok) throw new DisputeBodyError(`Payload is not valid: ${parsed.issues.join(', ')}`);
  if (!FILE_TYPES.has(file.type)) throw new DisputeBodyError('File type is not allowed');
  if (file.bytes.byteLength === 0 || file.bytes.byteLength > MAX_EVIDENCE_FILE_BYTES) {
    throw new DisputeBodyError('File is empty or over 10 MB');
  }
  const form = new FormData();
  const body = evidenceJson((parsed.payload as { evidences: Evidence[] }).evidences);
  form.set('input', new Blob([JSON.stringify(body)], { type: 'application/json' }), 'input.json');
  form.set('evidence_file', new Blob([file.bytes as BlobPart], { type: file.type }), safeName(file.name));
  return form;
}
