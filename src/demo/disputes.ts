// Three invented dispute cases for the demo (T-208), linked to demo orders. Labelled Simulated demo in the inbox.
// They are never sent to PayPal: the ids start PP-DEMO-, which the poller and the sync button refuse.
import type { Db } from '../lib/db';

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
  const orders = await db.order.findMany({
    where: { paypalOrderId: { in: ['DEMO-ORD-0001', 'DEMO-ORD-0002', 'DEMO-ORD-0003'] } },
    orderBy: { paypalOrderId: 'asc' },
  });
  if (orders.length < 3) return { cases: 0 };
  const base = {
    reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    allowedActionsJson: JSON.stringify({ actions: [], acceptClaimTypes: [] }),
    requestedEvidence: '[]',
    rawHash: 'demo',
  };
  const [a, b, c] = orders as [(typeof orders)[number], (typeof orders)[number], (typeof orders)[number]];
  await db.disputeCase.createMany({
    data: [
      {
        ...base,
        paypalDisputeId: 'PP-DEMO-0001',
        orderId: a.id,
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
  return { cases: 3 };
}
