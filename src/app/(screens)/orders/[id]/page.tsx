import { ShipmentBadge } from '../../../../components/shipment-badge';
import { TruthStateBadge } from '../../../../components/truth-state-badge';
import { getDb } from '../../../../lib/server-deps';
import { PAYPAL_ORDER_ID } from '../../../../orders/schema';
import { fromMinor } from '../../../../normalise/money';
import { truthStateForSource } from '../../../../lib/truth-state';

export const metadata = { title: 'Order · KeepMore' };
export const dynamic = 'force-dynamic';

async function loadShipment(paypalOrderId: string) {
  if (!PAYPAL_ORDER_ID.test(paypalOrderId)) return null; // a hostile id in the URL never reaches the database
  try {
    return await getDb().shipment.findFirst({ where: { order: { paypalOrderId } } });
  } catch {
    return null; // database not set up yet: the page still renders
  }
}

/** The order's ledger lines, oldest first, so a dispute outcome shows up here too (T-404). The full timeline is T-406. */
async function loadLines(paypalOrderId: string) {
  if (!PAYPAL_ORDER_ID.test(paypalOrderId)) return [];
  try {
    return await getDb().ledgerEntry.findMany({
      where: { order: { paypalOrderId } },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    });
  } catch {
    return [];
  }
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shipment = await loadShipment(id);
  const lines = await loadLines(id);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Order {id}</h1>
      <p className="mt-2 text-neutral-700">
        The order timeline: what was sold, what PayPal charged, and where each number comes from. Arrives in a later
        step.
      </p>
      {shipment && (
        <section aria-labelledby="shipment" className="mt-6" data-testid="shipment">
          <h2 id="shipment" className="text-lg font-medium">
            Shipment
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <ShipmentBadge pushStatus={shipment.pushStatus} />
            <span>
              Carrier <strong>{shipment.carrier}</strong>, tracking <strong>{shipment.trackingNo}</strong>
            </span>
            <TruthStateBadge state="Seller entered" />
          </div>
          {shipment.pushStatus !== 'PUSHED' && (
            <p className="mt-2 text-sm text-neutral-700">
              PayPal has not received this tracking number, so it does not count as proof of shipping there yet.
            </p>
          )}
        </section>
      )}
      {lines.length > 0 && (
        <section aria-labelledby="money" className="mt-6" data-testid="order-lines">
          <h2 id="money" className="text-lg font-medium">
            Money lines
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {lines.map((l) => (
              <li key={l.id} data-type={l.type} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{l.type.charAt(0) + l.type.slice(1).toLowerCase().replace(/_/g, ' ')}</span>
                <span>
                  {l.amountMinor < 0 ? '−' : ''}
                  {fromMinor(Math.abs(l.amountMinor), l.currency)} {l.currency}
                </span>
                <TruthStateBadge state={truthStateForSource(l.sourceType)} />
                <span className="text-neutral-600">{l.occurredAt.toISOString().slice(0, 10)}</span>
                {l.sourceRef && <code className="text-xs text-neutral-600">{l.sourceRef}</code>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
