// Storefront checkout (T-111). The browser sends SKUs and quantities; the server prices the cart,
// creates the PayPal order, and on capture writes the order, the buyer hash and the ledger entries.
import { CATALOGUE } from '../demo/catalogue';
import { captureFromOrder, entriesFromCapture, recordCapture, CaptureBreakdownError } from '../ledger/entries';
import type { Db } from '../lib/db';
import { fromMinor } from '../normalise/money';
import { PayPalError, type PayPalClient } from '../paypal/client';
import { buyerHash } from './buyer-hash';
import { cartSchema, PAYPAL_ORDER_ID } from './schema';

export interface CheckoutDeps {
  db: Db;
  paypal: PayPalClient;
  hmacSecret: string | undefined;
}

const CURRENCY = 'USD';
const json = (body: unknown, status: number) => Response.json(body, { status });
/** The browser gets a code and a debug id. The reason goes to the server log: PayPal's own error name, issues and message, never credentials. */
const paypalFailure = (e: PayPalError) => {
  console.error(
    `PayPal error ${e.status} ${e.code ?? '-'} issues=[${e.issues.join(',')}] debug=${e.debugId ?? '-'}: ${e.message}`,
  );
  return json({ error: 'PAYPAL_ERROR', debugId: e.debugId }, 502);
};

export async function handleCreate(req: Request, deps: CheckoutDeps): Promise<Response> {
  const parsed = cartSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'INVALID_CART' }, 400);

  const lines = new Map<string, number>();
  for (const { sku, qty } of parsed.data.items) lines.set(sku, (lines.get(sku) ?? 0) + qty);
  const items = [];
  for (const [sku, qty] of lines) {
    const product = CATALOGUE.find((p) => p.sku === sku);
    if (!product || qty > 10) return json({ error: 'INVALID_CART' }, 400);
    items.push({ product, qty });
  }
  const totalMinor = items.reduce((s, i) => s + i.qty * i.product.unitMinor, 0);
  const total = fromMinor(totalMinor, CURRENCY);

  try {
    const res = await deps.paypal.post<{ id: string }>('/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: CURRENCY,
            value: total,
            breakdown: { item_total: { currency_code: CURRENCY, value: total } },
          },
          items: items.map(({ product, qty }) => ({
            name: product.name,
            sku: product.sku,
            quantity: String(qty),
            category: 'PHYSICAL_GOODS',
            unit_amount: { currency_code: CURRENCY, value: fromMinor(product.unitMinor, CURRENCY) },
          })),
        },
      ],
    });
    await deps.db.order.create({
      data: {
        paypalOrderId: res.body.id,
        itemsJson: JSON.stringify(
          items.map(({ product, qty }) => ({ sku: product.sku, qty, unitMinor: product.unitMinor })),
        ),
        country: 'ZZ', // unknown until the buyer pays
        grossMinor: totalMinor,
        currency: CURRENCY,
      },
    });
    return json({ id: res.body.id }, 201);
  } catch (e) {
    if (e instanceof PayPalError) return paypalFailure(e);
    throw e;
  }
}

type Capture = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function handleCapture(paypalOrderId: string, deps: CheckoutDeps): Promise<Response> {
  if (!deps.hmacSecret || deps.hmacSecret.length < 32) return json({ error: 'SERVER_MISCONFIGURED' }, 500);
  if (!PAYPAL_ORDER_ID.test(paypalOrderId)) return json({ error: 'NOT_FOUND' }, 404);
  const order = await deps.db.order.findUnique({ where: { paypalOrderId } });
  if (!order) return json({ error: 'NOT_FOUND' }, 404);

  const summary = (captureId: string) => ({
    orderId: order.paypalOrderId,
    captureId,
    status: 'COMPLETED',
    grossMinor: order.grossMinor,
    currency: order.currency,
  });
  if (order.captureId) return json(summary(order.captureId), 200);

  let response: Capture;
  try {
    // One request id per order: a retried capture is the same capture at PayPal.
    response = (
      await deps.paypal.post<Capture>(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, undefined, {
        requestId: `capture-${paypalOrderId}`,
      })
    ).body;
  } catch (e) {
    if (e instanceof PayPalError) return paypalFailure(e);
    throw e;
  }

  try {
    const capture = captureFromOrder(response);
    const gross = entriesFromCapture(capture, { orderId: order.id, calcVersion: 'probe' }).find(
      (e) => e.type === 'GROSS',
    )!;
    if (gross.amountMinor !== order.grossMinor || gross.currency !== order.currency) {
      // Cannot happen through handleCreate. Money has moved at PayPal, so this needs a person; we write nothing.
      return json({ error: 'AMOUNT_MISMATCH' }, 409);
    }
    await recordCapture(deps.db, order.id, capture);
    const payerId = typeof response.payer?.payer_id === 'string' ? response.payer.payer_id : undefined;
    const country = [
      response.purchase_units?.[0]?.shipping?.address?.country_code,
      response.payer?.address?.country_code,
    ].find((c): c is string => typeof c === 'string' && /^[A-Z]{2}$/.test(c));
    const protection = (capture as Capture).seller_protection?.status;
    await deps.db.order.update({
      where: { id: order.id },
      data: {
        captureId: capture.id as string,
        country: country ?? 'ZZ',
        buyerHash: payerId ? buyerHash(deps.hmacSecret, payerId) : null,
        sellerProtection: typeof protection === 'string' ? protection : null,
      },
    });
    return json(summary(capture.id as string), 200);
  } catch (e) {
    if (e instanceof CaptureBreakdownError) return json({ error: 'CAPTURE_UNUSABLE' }, 502);
    throw e;
  }
}
