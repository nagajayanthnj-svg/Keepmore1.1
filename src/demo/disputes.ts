// Three invented dispute cases for the demo (T-208), linked to demo orders. Labelled Simulated demo in the inbox.
// They are never sent to PayPal: the ids start PP-DEMO-, which the poller and the sync button refuse.
import type { Db } from '../lib/db';
import { DEMO_ANCHOR } from './seed';
import { appendLedgerEntries } from '../ledger/store';

export const DEMO_DISPUTE_PREFIX = 'PP-DEMO-';
const DAY_MS = 86_400_000;

/** Invented buyer words for the demo cases: no real person, and the only kind of text the AI provider ever sees. */
const demoMessages = (now: Date, texts: string[]) =>
  JSON.stringify(
    texts.map((text, i) => ({
      postedBy: 'BUYER',
      at: new Date(now.getTime() - (texts.length - i + 1) * DAY_MS).toISOString(),
      text,
    })),
  );

export async function seedDemoDisputes(db: Db, now: Date): Promise<{ cases: number }> {
  if ((await db.disputeCase.count({ where: { paypalDisputeId: { startsWith: DEMO_DISPUTE_PREFIX } } })) > 0) {
    return { cases: 0 };
  }
  // Orders old enough for each story: about five weeks for the chargeback, three for the inquiry, ten for the
  // resolved one. The demo orders end at DEMO_ANCHOR (19 Oct 2026).
  const anchor = DEMO_ANCHOR.getTime();
  const orderBefore = (days: number) =>
    db.order.findFirst({
      where: { paypalOrderId: { startsWith: 'DEMO-ORD-' }, createdAt: { lte: new Date(anchor - days * DAY_MS) } },
      orderBy: { createdAt: 'desc' },
    });
  const orders = (await Promise.all([orderBefore(35), orderBefore(21), orderBefore(70)])).filter((o) => o !== null);
  if (orders.length < 3) return { cases: 0 };
  const base = {
    reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    allowedActionsJson: JSON.stringify({ actions: [], acceptClaimTypes: [] }),
    requestedEvidence: '[]',
    rawHash: 'demo',
  };
  // What PayPal offers on a real case at this stage (Phase 0), so the workbench has something to show.
  // Nothing is ever sent for a demo case: the approve and sync routes refuse PP-DEMO- ids.
  const offered = (id: string, actions: [string, string][], acceptClaimTypes: string[]) =>
    JSON.stringify({
      actions: actions.map(([action, slug]) => ({ action, rel: slug.replace(/-/g, '_'), method: 'POST', path: `/v1/customer/disputes/${id}/${slug}` })),
      acceptClaimTypes,
    });
  const [a, b, c] = orders as [(typeof orders)[number], (typeof orders)[number], (typeof orders)[number]];
  await db.disputeCase.createMany({
    data: [
      {
        ...base,
        paypalDisputeId: 'PP-DEMO-0001',
        orderId: a.id,
        allowedActionsJson: offered('PP-DEMO-0001', [['ACCEPT_CLAIM', 'accept-claim'], ['PROVIDE_EVIDENCE', 'provide-evidence']], ['REFUND']),
        requestedEvidence: JSON.stringify(['PROOF_OF_FULFILLMENT', 'PROOF_OF_DELIVERY_SIGNATURE']),
        stage: 'CHARGEBACK',
        status: 'WAITING_FOR_SELLER_RESPONSE',
        amountMinor: a.grossMinor,
        currency: a.currency,
        sellerDeadline: new Date(now.getTime() + 2 * DAY_MS),
        lastSyncedAt: new Date(now.getTime() - 30_000),
        messagesJson: demoMessages(now, ['My parcel has not arrived and the tracking has not moved for two weeks.']),
      },
      {
        ...base,
        paypalDisputeId: 'PP-DEMO-0002',
        orderId: b.id,
        allowedActionsJson: offered(
          'PP-DEMO-0002',
          [['ACCEPT_CLAIM', 'accept-claim'], ['SEND_MESSAGE', 'send-message'], ['ESCALATE', 'escalate']],
          ['REFUND'],
        ),
        stage: 'INQUIRY',
        status: 'WAITING_FOR_BUYER_RESPONSE',
        amountMinor: b.grossMinor,
        currency: b.currency,
        lastSyncedAt: new Date(now.getTime() - 40 * 60_000),
        messagesJson: demoMessages(now, ['Where is my order? It was meant to arrive last week.']),
      },
      {
        ...base,
        paypalDisputeId: 'PP-DEMO-0003',
        orderId: c.id,
        stage: 'CHARGEBACK',
        status: 'RESOLVED',
        amountMinor: c.grossMinor,
        currency: c.currency,
        outcomeCode: 'RESOLVED_SELLER_FAVOUR',
        lastSyncedAt: new Date(now.getTime() - 3 * DAY_MS),
        messagesJson: demoMessages(now, ['Nothing came. Please refund me.', 'Update: it arrived, sorry.']),
      },
    ],
  });
  // Invented shipments (the tracking numbers start DEMO, so they can never be a real parcel), events labelled DEMO.
  // The resolved demo case was won with no refund, so the seller kept the money: one RETAINED line, as T-403 writes
  // for a real win, but DEMO_SEEDED (Simulated demo) so the demo reset can remove it.
  await appendLedgerEntries(db, [
    {
      orderId: c.id,
      type: 'RETAINED',
      amountMinor: c.grossMinor,
      currency: c.currency,
      sourceType: 'DEMO_SEEDED',
      sourceRef: 'PP-DEMO-0003',
      calcVersion: 'demo-outcome-v1',
      occurredAt: new Date(now.getTime() - 3 * DAY_MS),
    },
  ]);

  // Dated from each order: shipped the next day, then the tracking events.
  const after = (o: { createdAt: Date }, days: number) => new Date(o.createdAt.getTime() + days * DAY_MS);
  for (const [order, no, events] of [
    [a, 'DEMO0000001IN', [[3, 'IN_TRANSIT'], [11, 'DELIVERED']]],
    [b, 'DEMO0000002IN', [[4, 'IN_TRANSIT']]],
  ] as const) {
    if (await db.shipment.findUnique({ where: { orderId: order.id } })) continue;
    await db.shipment.create({
      data: {
        orderId: order.id,
        carrier: 'INDIA_POST',
        trackingNo: no,
        pushStatus: 'PUSHED',
        pushedToPaypalAt: after(order, 1),
        eventsJson: JSON.stringify(events.map(([d, status]) => ({ at: after(order, d).toISOString(), status, source: 'DEMO' }))),
      },
    });
  }
  return { cases: 3 };
}
