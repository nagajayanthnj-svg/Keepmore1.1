// Ship an order (T-201): save the shipment locally first, then try to tell PayPal.
// A PayPal refusal never loses the seller's tracking: it is stored and the answer is still a success,
// with outcome LOCAL_ONLY. Only a seller's own ship action calls this; there is no automatic push.
import { z } from 'zod';
import type { Db } from '../lib/db';
import { systemClock, type Clock } from '../lib/clock';
import { normaliseCarrier, normaliseTracking, type Carrier } from '../normalise/tracking';
import { PAYPAL_ORDER_ID } from '../orders/schema';
import { PayPalError, type PayPalClient } from '../paypal/client';

export interface ShipDeps {
  db: Db;
  /** Null when PayPal credentials are missing: the shipment is still saved. */
  paypal: PayPalClient | null;
  clock?: Clock;
}

export const shipSchema = z.object({
  carrier: z.string().trim().min(1).max(60),
  trackingNo: z.string().trim().min(1).max(60),
});
/** After normalising: letters and digits only, 4 to 40 of them. Anything else is refused, not repaired. */
const TRACKING = /^[A-Z0-9]{4,40}$/;

/** Carriers PayPal accepts as a plain code. OTHER needs `carrier_name_other` and has no real request on file yet. */
const PUSHABLE: ReadonlySet<Carrier> = new Set(['INDIA_POST', 'DHL', 'FEDEX']);

export type PushStatus = 'NOT_ATTEMPTED' | 'PUSHED' | 'REJECTED';
export type ShipResult =
  | { kind: 'NOT_FOUND' }
  | { kind: 'INVALID' }
  | {
      kind: 'OK';
      shipmentId: string;
      outcome: 'PUSHED' | 'LOCAL_ONLY';
      pushStatus: PushStatus;
      /** Why nothing was sent, when it was not even tried. */
      reason?: string;
    };

interface TrackerResponse {
  purchase_units?: { shipping?: { trackers?: { id?: string }[] } }[];
}

const clip = (s: string) => s.slice(0, 500);
const describeError = (e: unknown) =>
  e instanceof PayPalError
    ? clip(`${e.status} ${e.code ?? '-'} issues=[${e.issues.join(',')}] debug=${e.debugId ?? '-'}: ${e.message}`)
    : clip(`NETWORK: ${e instanceof Error ? e.message : 'request failed'}`);

export async function shipOrder(
  deps: ShipDeps,
  input: { paypalOrderId: string; carrier: string; trackingNo: string },
): Promise<ShipResult> {
  const trackingNo = normaliseTracking(input.trackingNo);
  if (!PAYPAL_ORDER_ID.test(input.paypalOrderId) || !TRACKING.test(trackingNo) || !input.carrier.trim()) {
    return { kind: 'INVALID' };
  }
  const order = await deps.db.order.findUnique({ where: { paypalOrderId: input.paypalOrderId } });
  if (!order) return { kind: 'NOT_FOUND' };

  const carrier = normaliseCarrier(input.carrier);
  const clock = deps.clock ?? systemClock;

  // 1. Save locally first. A new or changed shipment starts with no events and nothing pushed.
  const saved = await deps.db.shipment.upsert({
    where: { orderId: order.id },
    create: { orderId: order.id, carrier, trackingNo, pushStatus: 'NOT_ATTEMPTED', eventsJson: '[]' },
    update: { carrier, trackingNo, pushStatus: 'NOT_ATTEMPTED', pushedToPaypalAt: null, pushError: null },
  });
  const done = (pushStatus: PushStatus, reason?: string): ShipResult => ({
    kind: 'OK',
    shipmentId: saved.id,
    outcome: pushStatus === 'PUSHED' ? 'PUSHED' : 'LOCAL_ONLY',
    pushStatus,
    ...(reason && { reason }),
  });

  // 2. Cases where PayPal cannot or should not be asked.
  // The reason about this order or carrier comes first: it is true even when credentials are also missing.
  const skip = order.paypalOrderId.startsWith('DEMO-')
    ? 'DEMO_ORDER'
    : !order.captureId
      ? 'NO_CAPTURE'
      : !PUSHABLE.has(carrier)
        ? 'CARRIER_NOT_PUSHABLE'
        : !deps.paypal
          ? 'PAYPAL_NOT_CONFIGURED'
          : null;
  if (skip || !deps.paypal || !order.captureId) return done('NOT_ATTEMPTED', skip ?? undefined);

  // 3. Ask PayPal. Whatever happens is stored; nothing here throws to the seller.
  const trackerId = `${order.captureId}-${trackingNo}`;
  try {
    const res = await deps.paypal.post<TrackerResponse>(
      `/v2/checkout/orders/${encodeURIComponent(order.paypalOrderId)}/track`,
      { capture_id: order.captureId, tracking_number: trackingNo, notify_payer: false, carrier },
      { requestId: `track-${trackerId}` },
    );
    const seen = res.body?.purchase_units?.some((u) => u.shipping?.trackers?.some((t) => t.id === trackerId));
    if (!seen) {
      await deps.db.shipment.update({
        where: { id: saved.id },
        data: { pushStatus: 'REJECTED', pushError: 'TRACKER_NOT_CONFIRMED' },
      });
      return done('REJECTED');
    }
    await deps.db.shipment.update({
      where: { id: saved.id },
      data: { pushStatus: 'PUSHED', pushedToPaypalAt: clock(), pushError: null },
    });
    return done('PUSHED');
  } catch (e) {
    await deps.db.shipment.update({
      where: { id: saved.id },
      data: { pushStatus: 'REJECTED', pushError: describeError(e) },
    });
    return done('REJECTED');
  }
}

const json = (body: unknown, status: number) => Response.json(body, { status });

export async function handleShip(req: Request, paypalOrderId: string, deps: ShipDeps): Promise<Response> {
  const parsed = shipSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'INVALID_SHIPMENT' }, 400);
  const r = await shipOrder(deps, { paypalOrderId, ...parsed.data });
  if (r.kind === 'INVALID') return json({ error: 'INVALID_SHIPMENT' }, 400);
  if (r.kind === 'NOT_FOUND') return json({ error: 'ORDER_NOT_FOUND' }, 404);
  return json(
    { shipmentId: r.shipmentId, outcome: r.outcome, pushStatus: r.pushStatus, ...(r.reason && { reason: r.reason }) },
    200,
  );
}
