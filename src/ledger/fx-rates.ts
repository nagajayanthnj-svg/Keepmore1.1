// FxRate table (T-109): a small CSV loader and a lookup. Rates are strings; nothing is fetched from the network.
// CSV format (ours, not FBIL's own layout): header `date,pair,rate`, one row per day, e.g. 2026-10-19,USD/INR,84.1234.
import type { Db } from '../lib/db';

export interface FxRow {
  date: Date;
  pair: string;
  rate: string;
}

const DAY_MS = 86_400_000;

export function parseFxCsv(text: string): FxRow[] {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== 'date,pair,rate') throw new Error('FX CSV: header must be exactly "date,pair,rate"');
  const rows: FxRow[] = [];
  lines.slice(1).forEach((raw, i) => {
    const line = i + 2;
    if (raw.trim() === '') return;
    const cells = raw.split(',').map((c) => c.trim());
    if (cells.length !== 3) throw new Error(`FX CSV line ${line}: expected 3 columns`);
    const [d, pair, rate] = cells as [string, string, string];
    const date = new Date(`${d}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== d) {
      throw new Error(`FX CSV line ${line}: date must be a real YYYY-MM-DD, got "${d}"`);
    }
    if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(pair)) throw new Error(`FX CSV line ${line}: pair must look like USD/INR`);
    if (!/^\d+(\.\d+)?$/.test(rate) || /^0+(\.0+)?$/.test(rate))
      throw new Error(`FX CSV line ${line}: rate must be a decimal above zero`);
    rows.push({ date, pair, rate });
  });
  if (rows.length === 0) throw new Error('FX CSV: no rows');
  return rows;
}

const trimZeros = (v: string) => (v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v);
const same = (a: string, b: string) => trimZeros(a) === trimZeros(b);

/** Inserts rates not yet stored. Returns how many were added. A stored rate is never changed: a different value throws. */
export async function loadFxRates(db: Db, rows: FxRow[], source: 'FBIL' | 'PAYPAL' | 'DEMO_SEED'): Promise<number> {
  return db.$transaction(async (tx) => {
    let added = 0;
    for (const r of rows) {
      const existing = await tx.fxRate.findUnique({
        where: { date_pair_source: { date: r.date, pair: r.pair, source } },
      });
      if (!existing) {
        await tx.fxRate.create({ data: { ...r, source } });
        added += 1;
      } else if (!same(existing.rate.toString(), r.rate)) {
        throw new Error(
          `FX rate ${r.pair} ${r.date.toISOString().slice(0, 10)} (${source}) differs from the stored value`,
        );
      }
    }
    return added;
  });
}

/** The latest stored rate on or before `at`. Undefined when none exists or the latest is older than maxAgeDays. */
export async function rateOnOrBefore(
  db: Db,
  pair: string,
  at: Date,
  opts: { source: 'FBIL' | 'PAYPAL' | 'DEMO_SEED'; maxAgeDays?: number },
): Promise<{ rate: string; date: Date } | undefined> {
  const row = await db.fxRate.findFirst({
    where: { pair, source: opts.source, date: { lte: at } },
    orderBy: { date: 'desc' },
  });
  if (!row) return undefined;
  if (opts.maxAgeDays !== undefined && at.getTime() - row.date.getTime() > opts.maxAgeDays * DAY_MS) return undefined;
  return { rate: row.rate.toString(), date: row.date };
}
