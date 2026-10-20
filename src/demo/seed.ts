// Demo seed and reset (T-110). Everything here is invented and labelled DEMO_SEEDED / DEMO_SEED.
// Deterministic: the same code gives the same rows, so the content hash is stable.
import { createHash } from 'node:crypto';
import { estimateFx } from '../ledger/fx';
import { appendLedgerEntries, type LedgerEntryInput } from '../ledger/store';
import type { Db } from '../lib/db';
import { CATALOGUE, DEMO_COUNTRIES } from './catalogue';

/** The demo's "now". Fixed so the seed does not change from day to day. */
export const DEMO_ANCHOR = new Date('2026-10-19T18:30:00Z');
const ORDERS = 400;
const WINDOW_DAYS = 183;
const DAY_MS = 86_400_000;
const CALC_VERSION = 'demo-seed-v1';
const SPREAD = '0.03';

/** Illustrative: 4.6% + $0.36 in integers, half up. Fits the sandbox captures on 120, 50 and 25 USD (off by 1 cent on 30). */
export const demoFee = (grossMinor: number) => Math.floor((grossMinor * 46 + 500) / 1000) + 36;

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T extends { weight: number }>(items: readonly T[], r: number): T => {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let x = r * total;
  for (const i of items) {
    x -= i.weight;
    if (x < 0) return i;
  }
  return items[items.length - 1]!;
};

const fmt4 = (n: number) => `${Math.trunc(n / 10000)}.${String(n % 10000).padStart(4, '0')}`;
const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

function buildRates() {
  const rand = prng(20261019);
  const rates: { date: Date; pair: string; rate: string; source: string }[] = [];
  let r = 830000; // ten-thousandths of a rupee
  const first = dayStart(new Date(DEMO_ANCHOR.getTime() - (WINDOW_DAYS + 7) * DAY_MS));
  for (let t = first.getTime(); t <= DEMO_ANCHOR.getTime(); t += DAY_MS) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue; // published on business days only
    r = Math.min(850000, Math.max(820000, r + Math.round((rand() - 0.45) * 2000)));
    rates.push({ date: d, pair: 'USD/INR', rate: fmt4(r), source: 'DEMO_SEED' });
  }
  return rates;
}

function buildOrders(rates: ReturnType<typeof buildRates>) {
  const rand = prng(1042);
  const start = DEMO_ANCHOR.getTime() - WINDOW_DAYS * DAY_MS;
  const times = Array.from({ length: ORDERS }, () => start + Math.floor(rand() * (DEMO_ANCHOR.getTime() - start))).sort(
    (a, b) => a - b,
  );
  return times.map((t, i) => {
    const n = String(i + 1).padStart(4, '0');
    const lines = new Map<string, number>();
    const count = 1 + Math.floor(rand() * 2.4); // 1 to 3 lines
    for (let k = 0; k < count; k++) {
      const p = pick(CATALOGUE, rand());
      lines.set(p.sku, (lines.get(p.sku) ?? 0) + 1 + (rand() < 0.15 ? 1 : 0));
    }
    const items = [...lines].map(([sku, qty]) => ({
      sku,
      qty,
      unitMinor: CATALOGUE.find((p) => p.sku === sku)!.unitMinor,
    }));
    const gross = items.reduce((s, i) => s + i.qty * i.unitMinor, 0);
    const at = new Date(t);
    const rate = [...rates].reverse().find((x) => x.date.getTime() <= t)!;
    return {
      id: `demoord${n}`,
      paypalOrderId: `DEMO-ORD-${n}`,
      captureId: `DEMO-CAP-${n}`,
      itemsJson: JSON.stringify(items),
      country: pick(DEMO_COUNTRIES, rand()).code,
      grossMinor: gross,
      currency: 'USD',
      buyerHash: createHash('sha256')
        .update(`demo-buyer-${Math.floor(rand() * 150)}`)
        .digest('hex'),
      createdAt: at,
      rate,
    };
  });
}

/** Seeds the demo shop once. Returns how many orders were added: a second call adds none. */
export async function seedDemo(db: Db): Promise<{ orders: number }> {
  if ((await db.order.count({ where: { paypalOrderId: { startsWith: 'DEMO-' } } })) > 0) return { orders: 0 };
  const rates = buildRates();
  const orders = buildOrders(rates);
  const ledger: LedgerEntryInput[] = [];
  for (const o of orders) {
    const fee = demoFee(o.grossMinor);
    const base = {
      orderId: o.id,
      sourceType: 'DEMO_SEEDED',
      sourceRef: o.captureId,
      calcVersion: CALC_VERSION,
      occurredAt: o.createdAt,
    } as const;
    ledger.push({ ...base, type: 'GROSS', amountMinor: o.grossMinor, currency: 'USD' });
    ledger.push({ ...base, type: 'PAYPAL_FEE', amountMinor: fee, currency: 'USD' });
    const paise = estimateFx(o.grossMinor - fee, o.rate.rate, SPREAD);
    ledger.push({
      ...base,
      type: 'FX',
      amountMinor: paise,
      currency: 'INR',
      inrMinor: paise,
      rate: o.rate.rate,
      rateDate: o.rate.date,
    });
  }
  await db.$transaction(async (tx) => {
    await tx.fxRate.createMany({ data: rates });
    await tx.order.createMany({
      data: orders.map((o) => ({
        id: o.id,
        paypalOrderId: o.paypalOrderId,
        captureId: o.captureId,
        itemsJson: o.itemsJson,
        country: o.country,
        grossMinor: o.grossMinor,
        currency: o.currency,
        buyerHash: o.buyerHash,
        createdAt: o.createdAt,
      })),
    });
    await appendLedgerEntries(tx as unknown as Db, ledger);
  });
  return { orders: orders.length };
}

/** Removes demo rows only. The database lets DEMO_SEEDED ledger rows go and refuses every other source. */
export async function resetDemo(db: Db, opts: { demoMode: boolean }): Promise<void> {
  if (!opts.demoMode) throw new Error('Demo reset needs DEMO_MODE=true');
  await db.$transaction(async (tx) => {
    const demo = { paypalOrderId: { startsWith: 'DEMO-' } };
    const ids = (await tx.order.findMany({ where: demo, select: { id: true } })).map((o) => o.id);
    for (let i = 0; i < ids.length; i += 200) {
      await tx.ledgerEntry.deleteMany({ where: { orderId: { in: ids.slice(i, i + 200) }, sourceType: 'DEMO_SEEDED' } });
    }
    for (let i = 0; i < ids.length; i += 200) {
      await tx.shipment.deleteMany({ where: { orderId: { in: ids.slice(i, i + 200) } } });
    }
    await tx.order.deleteMany({ where: demo });
    await tx.fxRate.deleteMany({ where: { source: 'DEMO_SEED' } });
  });
}

/** A hash of the demo content, ignoring generated IDs, so two seeds can be compared. */
export async function demoContentHash(db: Db): Promise<string> {
  const orders = await db.order.findMany({
    where: { paypalOrderId: { startsWith: 'DEMO-' } },
    include: { ledger: true },
    orderBy: { paypalOrderId: 'asc' },
  });
  const rates = await db.fxRate.findMany({
    where: { source: 'DEMO_SEED' },
    orderBy: [{ date: 'asc' }, { pair: 'asc' }],
  });
  const canon = {
    orders: orders.map((o) => ({
      p: o.paypalOrderId,
      c: o.captureId,
      i: o.itemsJson,
      k: o.country,
      g: o.grossMinor,
      u: o.currency,
      b: o.buyerHash,
      t: o.createdAt.toISOString(),
      l: [...o.ledger]
        .sort((a, b) => a.type.localeCompare(b.type))
        .map((l) => [
          l.type,
          l.amountMinor,
          l.currency,
          l.inrMinor,
          l.sourceType,
          l.sourceRef,
          l.rate?.toString() ?? null,
          l.rateDate?.toISOString() ?? null,
          l.calcVersion,
          l.occurredAt.toISOString(),
        ]),
    })),
    rates: rates.map((r) => [r.date.toISOString(), r.pair, r.rate.toString(), r.source]),
  };
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}
