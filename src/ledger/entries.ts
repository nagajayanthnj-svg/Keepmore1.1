// Ledger entries from a PayPal capture (T-108). Amounts are read from seller_receivable_breakdown;
// a fee PayPal returned is never recalculated. Both amounts are positive: the entry type gives the direction.
import { z } from 'zod';
import type { Db } from '../lib/db';
import { toMinor } from '../normalise/money';
import { appendLedgerEntry, type LedgerEntryInput } from './store';

export class CaptureBreakdownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureBreakdownError';
  }
}

const money = z.object({
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  value: z.string().regex(/^\d+(\.\d+)?$/),
});

const captureSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  create_time: z.string(),
  seller_receivable_breakdown: z.object({ gross_amount: money, paypal_fee: money }).loose(),
});

export type PayPalCapture = Record<string, unknown>;

/** The first capture of the first purchase unit in an order response (create-order result or capture result). */
export function captureFromOrder(order: unknown): PayPalCapture {
  const units = (order as { purchase_units?: { payments?: { captures?: unknown[] } }[] } | null)?.purchase_units;
  const capture = units?.[0]?.payments?.captures?.[0];
  if (!capture || typeof capture !== 'object') throw new CaptureBreakdownError('The order response holds no capture');
  return capture as PayPalCapture;
}

export function entriesFromCapture(
  capture: PayPalCapture,
  ctx: { orderId: string; calcVersion: string },
): LedgerEntryInput[] {
  const parsed = captureSchema.safeParse(capture);
  if (!parsed.success)
    throw new CaptureBreakdownError('Capture has no usable seller_receivable_breakdown (gross_amount, paypal_fee)');
  const { id, status, create_time, seller_receivable_breakdown: b } = parsed.data;
  if (status !== 'COMPLETED') throw new CaptureBreakdownError(`Capture ${id} is ${status}, not COMPLETED`);
  if (b.gross_amount.currency_code !== b.paypal_fee.currency_code) {
    throw new CaptureBreakdownError(`Capture ${id}: gross and fee are in different currencies`);
  }
  const occurredAt = new Date(create_time);
  if (Number.isNaN(occurredAt.getTime())) throw new CaptureBreakdownError(`Capture ${id}: create_time is not a date`);
  const currency = b.gross_amount.currency_code;
  const base = {
    orderId: ctx.orderId,
    currency,
    sourceType: 'PAYPAL_VERIFIED',
    sourceRef: id,
    calcVersion: ctx.calcVersion,
    occurredAt,
  } as const;
  return [
    { ...base, type: 'GROSS', amountMinor: toMinor(b.gross_amount.value, currency) },
    { ...base, type: 'PAYPAL_FEE', amountMinor: toMinor(b.paypal_fee.value, currency) },
  ];
}

export const CAPTURE_CALC_VERSION = 'ledger-v1';

/** Appends the capture's entries once. Returns how many were added; a repeat adds none. */
export async function recordCapture(db: Db, orderId: string, capture: PayPalCapture): Promise<number> {
  const entries = entriesFromCapture(capture, { orderId, calcVersion: CAPTURE_CALC_VERSION });
  return db.$transaction(async (tx) => {
    const sourceRef = entries[0]!.sourceRef;
    const have = await tx.ledgerEntry.findMany({
      where: { orderId, sourceRef, sourceType: 'PAYPAL_VERIFIED' },
      select: { type: true },
    });
    const seen = new Set(have.map((h) => h.type));
    const todo = entries.filter((e) => !seen.has(e.type));
    for (const e of todo) await appendLedgerEntry(tx as unknown as Db, e);
    return todo.length;
  });
}
