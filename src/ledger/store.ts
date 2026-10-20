import { z } from 'zod';
import type { Db } from '../lib/db';

// The only way code writes to the ledger. There is no update and no delete: a mistake is fixed by
// appending a correcting entry (correctsEntryId). The database refuses UPDATE and DELETE as well.

export const LEDGER_TYPES = [
  'GROSS',
  'PAYPAL_FEE',
  'FX',
  'DUTY',
  'SHIPPING',
  'RETURN_POSTAGE',
  'REFUND',
  'DISPUTE_FEE',
  'RETAINED',
] as const;

export const SOURCE_TYPES = [
  'PAYPAL_VERIFIED',
  'REFERENCE_RATE_ESTIMATE',
  'SELLER_ENTERED',
  'DEMO_SEEDED',
  'HYPOTHETICAL_SCENARIO',
] as const;

const LedgerEntryInput = z.object({
  orderId: z.string().min(1),
  type: z.enum(LEDGER_TYPES),
  amountMinor: z.int(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  inrMinor: z.int().optional(),
  sourceType: z.enum(SOURCE_TYPES),
  sourceRef: z.string().optional(),
  rate: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
  rateDate: z.date().optional(),
  calcVersion: z.string().min(1),
  correctsEntryId: z.string().optional(),
  occurredAt: z.date(),
});

export type LedgerEntryInput = z.input<typeof LedgerEntryInput>;

export async function appendLedgerEntry(db: Db, entry: LedgerEntryInput) {
  return db.ledgerEntry.create({ data: LedgerEntryInput.parse(entry) });
}

/** Bulk form of appendLedgerEntry for the demo seed. Every entry is validated first; nothing is written if one is bad. */
export async function appendLedgerEntries(db: Db, entries: LedgerEntryInput[]) {
  const data = entries.map((e) => LedgerEntryInput.parse(e));
  for (let i = 0; i < data.length; i += 200) await db.ledgerEntry.createMany({ data: data.slice(i, i + 200) });
  return data.length;
}

export async function listLedgerEntries(db: Db, orderId: string) {
  return db.ledgerEntry.findMany({
    where: { orderId },
    orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
}
