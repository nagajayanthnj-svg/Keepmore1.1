// The rows AG Studio gets for the Overview (T-405). Server side, from our database; nothing from the buyer:
// no buyer hash, capture id, email or message text. Money stays in integer minor units; Studio formats it with
// fromMinor (studio-fields.ts) and never does more than add whole numbers.
import { classifyOutcome } from '../disputes/outcome';
import { LEDGER_KIND_NAME } from '../ledger/labels';
import type { Db } from '../lib/db';
import { truthStateForSource, type TruthState } from '../lib/truth-state';
import { fromMinor } from '../normalise/money';

export interface StudioLedgerRow {
  id: string;
  orderId: string;
  type: string;
  kind: string;
  amountMinor: number;
  currency: string;
  /** The same amount in a field per currency, null otherwise, so a tile or table never adds two currencies. */
  usdMinor: number | null;
  inrMinor: number | null;
  /** Display copies in major units, for chart axes only (Studio cannot format an axis): never used for a total we state. */
  usd: number | null;
  inr: number | null;
  truthState: TruthState;
  /** Kind and label together: a chart series never mixes truth states. */
  series: string;
  month: string;
  date: Date;
}
export interface StudioOrderRow {
  id: string;
  orderRef: string;
  country: string;
  month: string;
  grossMinor: number;
  currency: string;
  truthState: TruthState;
  disputed: boolean;
}
export interface StudioDisputeRow {
  id: string;
  disputeId: string;
  orderId: string | null;
  stage: string;
  status: string;
  outcome: string;
  amountMinor: number;
  currency: string;
  usdMinor: number | null;
  truthState: TruthState;
}
export interface StudioData {
  ledger: StudioLedgerRow[];
  orders: StudioOrderRow[];
  disputes: StudioDisputeRow[];
  /** For each ledger kind, the truth state most of its entries carry: the KPI shows that one, named in its title. */
  mainTruthState: Partial<Record<string, TruthState>>;
  /** For each ledger kind, the currency most of its entries are in. */
  mainCurrency: Partial<Record<string, string>>;
  disputeTruthState: TruthState;
}

const OUTCOME_NAME = { WON: 'Won', LOST: 'Lost', CANCELLED: 'Cancelled by buyer', UNKNOWN: 'Unknown outcome' } as const;
const month = (d: Date) => d.toISOString().slice(0, 7);
function most<T extends string>(values: T[], fallback: T): T {
  const n = new Map<T, number>();
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
}

/** `demoOnly`: only the seeded demo shop, for the AI assistant (only synthetic demo data may reach the model). */
export async function loadStudioData(db: Db, opts: { demoOnly?: boolean } = {}): Promise<StudioData> {
  const demoOrders = opts.demoOnly ? { paypalOrderId: { startsWith: 'DEMO-' } } : {};
  const [entries, orders, cases] = await Promise.all([
    db.ledgerEntry.findMany({ where: opts.demoOnly ? { order: demoOrders } : {}, orderBy: { occurredAt: 'asc' } }),
    db.order.findMany({ where: demoOrders, select: { id: true, paypalOrderId: true, country: true, grossMinor: true, currency: true, createdAt: true } }),
    db.disputeCase.findMany({ where: opts.demoOnly ? { paypalDisputeId: { startsWith: 'PP-DEMO-' } } : {} }),
  ]);
  const disputedOrders = new Set(cases.map((c) => c.orderId).filter((x): x is string => x !== null));
  const ledger = entries.map((e): StudioLedgerRow => {
    const truthState = truthStateForSource(e.sourceType);
    const kind = LEDGER_KIND_NAME[e.type] ?? e.type;
    return {
      id: e.id,
      orderId: e.orderId,
      type: e.type,
      kind,
      amountMinor: e.amountMinor,
      currency: e.currency,
      usdMinor: e.currency === 'USD' ? e.amountMinor : null,
      inrMinor: e.currency === 'INR' ? e.amountMinor : null,
      usd: e.currency === 'USD' ? Number(fromMinor(e.amountMinor, 'USD')) : null,
      inr: e.currency === 'INR' ? Number(fromMinor(e.amountMinor, 'INR')) : null,
      truthState,
      series: `${kind} · ${truthState}`,
      month: month(e.occurredAt),
      date: e.occurredAt,
    };
  });
  const demoOrder = (ref: string) => ref.startsWith('DEMO-');
  const disputes = cases.map((c): StudioDisputeRow => {
    const demo = c.paypalDisputeId.startsWith('PP-DEMO-');
    return {
      id: c.id,
      disputeId: c.paypalDisputeId,
      orderId: c.orderId,
      stage: c.stage,
      status: c.status,
      outcome: c.status === 'RESOLVED' ? OUTCOME_NAME[classifyOutcome(c.outcomeCode).kind] : 'Open',
      amountMinor: c.amountMinor,
      currency: c.currency,
      usdMinor: c.currency === 'USD' ? c.amountMinor : null,
      truthState: demo ? 'Simulated demo' : 'Verified by PayPal',
    };
  });
  const byType = new Map<string, TruthState[]>();
  const curByType = new Map<string, string[]>();
  for (const r of ledger) {
    byType.set(r.type, [...(byType.get(r.type) ?? []), r.truthState]);
    curByType.set(r.type, [...(curByType.get(r.type) ?? []), r.currency]);
  }
  return {
    ledger,
    orders: orders.map((o) => ({
      id: o.id,
      orderRef: o.paypalOrderId,
      country: o.country,
      month: month(o.createdAt),
      grossMinor: o.grossMinor,
      currency: o.currency,
      truthState: demoOrder(o.paypalOrderId) ? 'Simulated demo' : 'Verified by PayPal',
      disputed: disputedOrders.has(o.id),
    })),
    disputes,
    mainTruthState: Object.fromEntries([...byType].map(([t, v]) => [t, most(v, 'Unknown')])),
    mainCurrency: Object.fromEntries([...curByType].map(([t, v]) => [t, most(v, 'USD')])),
    disputeTruthState: most(disputes.map((d) => d.truthState), 'Simulated demo'),
  };
}
