// What we keep from PayPal's dispute details (T-203), and a hash of the whole payload.
// Pure functions: no network, no database. Anything we cannot trust is an error, never a guess.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { toMinor } from '../normalise/money';

export class DisputeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DisputeParseError';
  }
}

export const DISPUTE_ID = /^PP-[A-Z0-9-]{3,40}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,59}$/;

const detailsSchema = z.object({
  dispute_id: z.string().regex(DISPUTE_ID),
  reason: z.string().regex(CODE),
  status: z.string().regex(CODE),
  dispute_life_cycle_stage: z.string().regex(CODE),
  dispute_amount: z.object({ currency_code: z.string().regex(/^[A-Z]{3}$/), value: z.string() }),
  seller_response_due_date: z.string().optional(),
  dispute_outcome: z.object({ outcome_code: z.string().regex(CODE).optional() }).optional(),
  evidences: z.array(z.object({ evidence_type: z.string().optional(), source: z.string().optional() })).optional(),
});

export interface ParsedMessage {
  postedBy: 'BUYER' | 'SELLER' | 'OTHER';
  at: Date;
  text: string;
}

const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 2000;

/** The dispute's messages in time order. Lenient: a malformed entry is dropped, and nothing here throws. */
function parseMessages(details: unknown): ParsedMessage[] {
  const list = (details as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(list)) return [];
  const out: ParsedMessage[] = [];
  for (const m of list) {
    const { posted_by: by, time_posted: when, content } = (m ?? {}) as Record<string, unknown>;
    if (typeof by !== 'string' || typeof when !== 'string' || typeof content !== 'string') continue;
    const at = new Date(when);
    if (Number.isNaN(at.getTime())) continue;
    out.push({
      postedBy: by === 'BUYER' || by === 'SELLER' ? by : 'OTHER',
      at,
      text: content.slice(0, MAX_MESSAGE_CHARS),
    });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(-MAX_MESSAGES);
}

export interface ParsedDispute {
  paypalDisputeId: string;
  reason: string;
  stage: string;
  status: string;
  amountMinor: number;
  currency: string;
  /** Null when PayPal sends none (inquiries, under review, resolved). */
  sellerDeadline: Date | null;
  /** The types PayPal currently lists as requested from the seller, each once, in first-listed order. */
  requestedEvidence: string[];
  /** PayPal's own outcome code, unchanged. */
  outcomeCode: string | null;
  /** The capture id the dispute is about (disputed_transactions[0].seller_transaction_id), or null. */
  sellerTransactionId: string | null;
  /** The buyer's PayPal payer id. Used only to compute the buyer hash; never stored or shown. */
  buyerPayerId: string | null;
  /** The dispute's messages, oldest first, newest 50 at most. Buyer words are data, never instructions. */
  messages: ParsedMessage[];
  rawHash: string;
}

export function parseDispute(details: unknown): ParsedDispute {
  const parsed = detailsSchema.safeParse(details);
  if (!parsed.success) {
    // Paths only: a value could be buyer data.
    const where = parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
    throw new DisputeParseError(`Dispute details are not usable: ${where}`);
  }
  const d = parsed.data;

  let amountMinor: number;
  try {
    amountMinor = toMinor(d.dispute_amount.value, d.dispute_amount.currency_code);
  } catch {
    throw new DisputeParseError('Dispute details are not usable: dispute_amount.value');
  }

  let sellerDeadline: Date | null = null;
  if (d.seller_response_due_date !== undefined) {
    sellerDeadline = new Date(d.seller_response_due_date);
    if (Number.isNaN(sellerDeadline.getTime())) {
      throw new DisputeParseError('Dispute details are not usable: seller_response_due_date');
    }
  }

  const requested = new Set<string>();
  for (const e of d.evidences ?? []) {
    if (e.source === 'REQUESTED_FROM_SELLER' && e.evidence_type && CODE.test(e.evidence_type)) {
      requested.add(e.evidence_type);
    }
  }

  return {
    paypalDisputeId: d.dispute_id,
    reason: d.reason,
    stage: d.dispute_life_cycle_stage,
    status: d.status,
    amountMinor,
    currency: d.dispute_amount.currency_code,
    sellerDeadline,
    requestedEvidence: [...requested],
    outcomeCode: d.dispute_outcome?.outcome_code ?? null,
    ...linkKeys(details),
    messages: parseMessages(details),
    rawHash: disputeRawHash(details),
  };
}

const TXN_ID = /^[A-Za-z0-9-]{5,40}$/;
const PAYER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** What links a dispute to an order. Missing or malformed values give null: the dispute still parses. */
function linkKeys(details: unknown): Pick<ParsedDispute, 'sellerTransactionId' | 'buyerPayerId'> {
  const list = (details as { disputed_transactions?: unknown } | null)?.disputed_transactions;
  const t = Array.isArray(list)
    ? (list[0] as { seller_transaction_id?: unknown; buyer?: { payer_id?: unknown } } | null)
    : null;
  const txn = t?.seller_transaction_id;
  const payer = t?.buyer?.payer_id;
  return {
    sellerTransactionId: typeof txn === 'string' && TXN_ID.test(txn) ? txn : null,
    buyerPayerId: typeof payer === 'string' && PAYER_ID.test(payer) ? payer : null,
  };
}

/** Key order never matters. Links are sorted: PayPal returns them in a different order for the same state. */
function canonical(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map((v) => canonical(v));
    return key === 'links' ? items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : items;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v, k)]),
    );
  }
  return value;
}

/**
 * SHA-256 of the whole details payload. Used to see that a dispute changed between two reads, for
 * example between the seller's approval and the submit (T-210). It holds buyer data in the clear
 * only as a hash and is the only thing of the payload stored.
 */
export function disputeRawHash(details: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(details)))
    .digest('hex');
}
