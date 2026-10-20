import { ShipmentBadge } from '../../../../components/shipment-badge';
import { TruthStateBadge } from '../../../../components/truth-state-badge';
import { getDb } from '../../../../lib/server-deps';
import { PAYPAL_ORDER_ID } from '../../../../orders/schema';

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

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shipment = await loadShipment(id);
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
    </>
  );
}
