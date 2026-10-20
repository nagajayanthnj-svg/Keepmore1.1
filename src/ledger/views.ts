// Ledger views (T-405 groundwork). Totals are SQL aggregates over the ledger, one row per type, source and
// currency. They are never added across sources or currencies: the split is the point.
import type { Db } from '../lib/db';
import { LEDGER_TYPES, SOURCE_TYPES } from './store';

export interface TotalRow {
  type: string;
  sourceType: string;
  currency: string;
  totalMinor: number;
  entries: number;
}

export type Overview = { ready: false } | { ready: true; orders: { demo: number; other: number }; rows: TotalRow[] };

const rank = (list: readonly string[], v: string) => {
  const i = list.indexOf(v);
  return i === -1 ? list.length : i;
};

/** Everything the Overview needs. If the database has no tables yet, answers { ready: false } instead of throwing. */
export async function loadOverview(db: Db): Promise<Overview> {
  try {
    const demo = await db.order.count({ where: { paypalOrderId: { startsWith: 'DEMO-' } } });
    const total = await db.order.count();
    const groups = await db.ledgerEntry.groupBy({
      by: ['type', 'sourceType', 'currency'],
      _sum: { amountMinor: true },
      _count: { _all: true },
    });
    const rows = groups
      .map((g) => ({
        type: g.type,
        sourceType: g.sourceType,
        currency: g.currency,
        totalMinor: g._sum.amountMinor ?? 0,
        entries: g._count._all,
      }))
      // Types in ledger order; within a type, PayPal-verified first (SOURCE_TYPES order), then by currency.
      .sort(
        (a, b) =>
          rank(LEDGER_TYPES, a.type) - rank(LEDGER_TYPES, b.type) ||
          rank(SOURCE_TYPES, a.sourceType) - rank(SOURCE_TYPES, b.sourceType) ||
          a.currency.localeCompare(b.currency),
      );
    return { ready: true, orders: { demo, other: total - demo }, rows };
  } catch {
    return { ready: false };
  }
}
