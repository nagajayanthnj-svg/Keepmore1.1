// The order's financial truth timeline (T-406): every event and money line of one order, oldest first, each with
// its truth-state label, its time, how the number was made (read from PayPal, a formula with its inputs, or what
// the seller typed) and a reference. Leakage is listed line by line and never added into one total across
// currencies or labels. Read from our database only; nothing from the buyer is shown.
import { DEMO_DISPUTE_PREFIX } from '../demo/disputes';
import { demoFee } from '../demo/seed';
import { classifyOutcome } from '../disputes/outcome';
import { estimateFx } from '../ledger/fx';
import { LEDGER_KIND_NAME } from '../ledger/labels';
import type { Db } from '../lib/db';
import { truthStateForSource, type TruthState } from '../lib/truth-state';
import { fromMinor } from '../normalise/money';
import { PAYPAL_ORDER_ID } from './schema';

const ORDER_ID = /^[A-Za-z0-9]{1,40}$/; // our ids: cuid, or demoordNNNN for the demo shop
const LEAKAGE = ['PAYPAL_FEE', 'FX', 'DUTY', 'SHIPPING', 'RETURN_POSTAGE', 'DISPUTE_FEE'];
const DEMO_SPREAD = '0.03';

export interface TimelineLine {
  kind: 'ORDER' | 'MONEY' | 'SHIPMENT' | 'TRACKING' | 'DISPUTE';
  /** Ledger type for MONEY lines. */
  type?: string;
  title: string;
  at: string | null;
  amount: { minor: number; currency: string } | null;
  truthState: TruthState;
  /** How the number or fact was made: read from PayPal, a formula with its inputs, or what the seller typed. */
  formula: string;
  ref: string;
  href?: string;
}
export interface LeakageRow {
  type: string;
  kind: string;
  minor: number;
  currency: string;
  truthState: TruthState;
}
export interface OrderTimeline {
  orderRef: string;
  country: string;
  demo: boolean;
  lines: TimelineLine[];
  /** One row per kind, label and currency. Never summed across them. */
  leakage: LeakageRow[];
}

const words = (code: string) => code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ');
const money = (minor: number, cur: string) => `${fromMinor(minor, cur)} ${cur}`;

export async function loadOrderTimeline(db: Db, id: string): Promise<OrderTimeline | null> {
  // The PayPal order id first, then our own id (the inbox links carry ours). A hostile id never reaches a query.
  const include = { shipment: true, ledger: { orderBy: [{ occurredAt: 'asc' as const }, { createdAt: 'asc' as const }] }, disputes: true };
  const o =
    (PAYPAL_ORDER_ID.test(id) ? await db.order.findUnique({ where: { paypalOrderId: id }, include }) : null) ??
    (ORDER_ID.test(id) ? await db.order.findUnique({ where: { id }, include }) : null);
  if (!o) return null;
  const demo = o.paypalOrderId.startsWith('DEMO-');
  const lines: TimelineLine[] = [];

  let items: { sku?: string; qty?: number }[] = [];
  try {
    items = JSON.parse(o.itemsJson) as typeof items;
  } catch {
    items = [];
  }
  const gross = o.ledger.find((l) => l.type === 'GROSS' && !l.correctsEntryId);
  const fee = o.ledger.find((l) => l.type === 'PAYPAL_FEE' && !l.correctsEntryId);
  lines.push({
    kind: 'ORDER',
    title: `Order placed: ${items.length} item line${items.length === 1 ? '' : 's'} to ${o.country}`,
    at: o.createdAt.toISOString(),
    amount: { minor: o.grossMinor, currency: o.currency },
    truthState: demo ? 'Simulated demo' : gross ? truthStateForSource(gross.sourceType) : 'Unknown',
    formula: `Total of the item lines: ${items.map((i) => `${i.qty ?? 1} × ${i.sku ?? '?'}`).join(', ') || 'no items recorded'}`,
    ref: o.paypalOrderId,
  });

  for (const l of o.ledger) {
    const real = l.sourceType === 'PAYPAL_VERIFIED';
    let formula: string;
    let href: string | undefined;
    const dispute = o.disputes.find((d) => d.paypalDisputeId === l.sourceRef);
    if (dispute) href = `/outcome/${encodeURIComponent(dispute.id)}`;
    if (l.correctsEntryId) formula = 'Reversal of an earlier line written with the wrong sign (the ledger is never edited)';
    else if (l.type === 'GROSS')
      formula = real ? "Read from PayPal's capture: seller_receivable_breakdown.gross_amount" : 'Seeded: the total of the item lines';
    else if (l.type === 'PAYPAL_FEE')
      formula = real
        ? "Read from PayPal's capture: seller_receivable_breakdown.paypal_fee; never recalculated"
        : `Seeded with the sandbox fee pattern: 4.6% of the gross + 0.36, rounded (${gross && demoFee(gross.amountMinor) === l.amountMinor ? 'checks out' : 'does not match the pattern'})`;
    else if (l.type === 'FX') {
      const rate = l.rate?.toString();
      if (gross && fee && rate) {
        const net = gross.amountMinor - fee.amountMinor;
        const spreadKnown = estimateFx(net, rate, DEMO_SPREAD) === l.amountMinor;
        formula =
          `(${fromMinor(gross.amountMinor, gross.currency)} − ${fromMinor(fee.amountMinor, fee.currency)}) ${gross.currency} × ${rate} INR/USD` +
          `${l.rateDate ? ` (rate of ${l.rateDate.toISOString().slice(0, 10)})` : ''} × ${spreadKnown ? '3% spread' : 'a spread not recorded'} = ${money(l.amountMinor, l.currency)}`;
      } else formula = `Estimate at ${rate ?? 'an unrecorded'} INR/USD; inputs not all recorded`;
    } else if (l.type === 'REFUND') formula = "PayPal's money lines: seller DEBIT, DISPUTE_SETTLEMENT";
    else if (l.type === 'DISPUTE_FEE') formula = "PayPal's money lines: seller DEBIT, DISPUTE_SETTLEMENT_FEE";
    else if (l.type === 'RETAINED') formula = 'Retained rule: dispute won or cancelled, and no refund for this capture';
    else formula = `${l.calcVersion}`;
    lines.push({
      kind: 'MONEY',
      type: l.type,
      title: `${LEDGER_KIND_NAME[l.type] ?? l.type}${l.correctsEntryId ? ' (correction)' : ''}`,
      at: l.occurredAt.toISOString(),
      amount: { minor: l.amountMinor, currency: l.currency },
      truthState: truthStateForSource(l.sourceType),
      formula,
      ref: l.sourceRef ?? l.calcVersion,
      ...(href && { href }),
    });
  }
  if (gross && !o.ledger.some((l) => l.type === 'FX')) {
    lines.push({
      kind: 'MONEY',
      type: 'FX',
      title: LEDGER_KIND_NAME.FX!,
      at: null,
      amount: null,
      truthState: 'Unknown',
      formula: 'No exchange rate is recorded for this order, so the exchange-rate cost is not known. Nothing is guessed.',
      ref: 'no rate recorded',
    });
  }

  const s = o.shipment;
  if (s) {
    lines.push({
      kind: 'SHIPMENT',
      title: `Shipped with ${s.carrier.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')}`,
      at: s.pushedToPaypalAt?.toISOString() ?? null,
      amount: null,
      // Invented demo shipments carry DEMO tracking numbers; anything else was typed by the seller (even on a demo order).
      truthState: s.trackingNo.startsWith('DEMO') ? 'Simulated demo' : 'Seller entered',
      formula:
        s.pushStatus === 'PUSHED'
          ? 'Tracking typed by the seller and sent to PayPal'
          : s.pushStatus === 'REJECTED'
            ? 'Tracking typed by the seller; PayPal refused it'
            : 'Tracking typed by the seller; kept here only, not sent to PayPal',
      ref: s.trackingNo,
    });
    let events: { at?: string; status?: string; source?: string }[] = [];
    try {
      events = JSON.parse(s.eventsJson) as typeof events;
    } catch {
      events = [];
    }
    for (const e of events) {
      if (!e.at || !e.status) continue;
      lines.push({
        kind: 'TRACKING',
        title: `Tracking: ${words(e.status).toLowerCase()}`,
        at: new Date(e.at).toISOString(),
        amount: null,
        truthState: e.source === 'SELLER' ? 'Seller entered' : e.source === 'DEMO' ? 'Simulated demo' : 'Unknown',
        formula: e.source === 'SELLER' ? 'Status entered by the seller' : e.source === 'DEMO' ? 'Invented for the demo' : 'Carrier status, source not checked',
        ref: s.trackingNo,
      });
    }
  }

  for (const d of o.disputes) {
    const demoCase = d.paypalDisputeId.startsWith(DEMO_DISPUTE_PREFIX);
    const outcome = d.status === 'RESOLVED' ? `; outcome ${words(classifyOutcome(d.outcomeCode).kind).toLowerCase()} (${d.outcomeCode ?? 'no code'})` : '';
    lines.push({
      kind: 'DISPUTE',
      title: `Dispute: ${words(d.stage).toLowerCase()}, ${words(d.status).toLowerCase()}`,
      at: d.lastSyncedAt.toISOString(),
      amount: { minor: d.amountMinor, currency: d.currency },
      truthState: demoCase ? 'Simulated demo' : 'Verified by PayPal',
      formula: `State as last read from PayPal at this time${outcome}`,
      ref: d.paypalDisputeId,
      href: `/disputes/${encodeURIComponent(d.id)}`,
    });
  }

  const timed = lines.filter((l) => l.at).sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!));
  const leakage = new Map<string, LeakageRow>();
  for (const l of o.ledger) {
    if (!LEAKAGE.includes(l.type)) continue;
    const ts = truthStateForSource(l.sourceType);
    const key = `${l.type}|${ts}|${l.currency}`;
    const row = leakage.get(key) ?? { type: l.type, kind: LEDGER_KIND_NAME[l.type] ?? l.type, minor: 0, currency: l.currency, truthState: ts };
    row.minor += l.amountMinor;
    leakage.set(key, row);
  }
  return {
    orderRef: o.paypalOrderId,
    country: o.country,
    demo,
    lines: [...timed, ...lines.filter((l) => !l.at)],
    leakage: [...leakage.values()],
  };
}
