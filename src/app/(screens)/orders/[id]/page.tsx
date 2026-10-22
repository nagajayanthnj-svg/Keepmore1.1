import Link from 'next/link';
import { ShipmentBadge } from '../../../../components/shipment-badge';
import { TruthStateBadge } from '../../../../components/truth-state-badge';
import { getDb } from '../../../../lib/server-deps';
import { fromMinor } from '../../../../normalise/money';
import { loadOrderTimeline, type OrderTimeline } from '../../../../orders/timeline';

export const metadata = { title: 'Order · KeepMore' };
export const dynamic = 'force-dynamic';

const time = (iso: string | null) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : 'Time not recorded');

async function load(id: string): Promise<{ t: OrderTimeline | null; shipment: Awaited<ReturnType<ReturnType<typeof getDb>['shipment']['findFirst']>> }> {
  try {
    const t = await loadOrderTimeline(getDb(), id);
    const shipment = t ? await getDb().shipment.findFirst({ where: { order: { paypalOrderId: t.orderRef } } }) : null;
    return { t, shipment };
  } catch {
    return { t: null, shipment: null }; // database not set up yet: the page still renders
  }
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, shipment } = await load(id);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Order {t?.orderRef ?? id}</h1>
      <p className="mt-2 text-neutral-700">
        {t
          ? 'Everything that happened to this order and its money, oldest first. Each line says where its number comes from.'
          : 'No order with that id is stored here.'}
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
            <TruthStateBadge state={shipment.trackingNo.startsWith('DEMO') ? 'Simulated demo' : 'Seller entered'} />
          </div>
          {shipment.pushStatus !== 'PUSHED' && (
            <p className="mt-2 text-sm text-neutral-700">
              PayPal has not received this tracking number, so it does not count as proof of shipping there yet.
            </p>
          )}
        </section>
      )}
      {t && (
        <>
          <section aria-labelledby="leakage" className="mt-6" data-testid="order-leakage">
            <h2 id="leakage" className="text-lg font-medium">
              Where money leaked on this order
            </h2>
            <p className="mt-1 text-sm text-neutral-700">
              Listed one by one with their source labels. They are not added into one total: they differ in currency or
              label.
            </p>
            {t.leakage.length === 0 ? (
              <p className="mt-1 text-sm text-neutral-600">No fees or costs recorded.</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-3 text-sm">
                {t.leakage.map((l) => (
                  <li key={`${l.type}|${l.truthState}|${l.currency}`} data-type={l.type} className="rounded border border-neutral-200 px-3 py-2">
                    <span className="block text-neutral-700">{l.kind}</span>
                    <strong className="block text-lg">
                      {fromMinor(l.minor, l.currency)} {l.currency}
                    </strong>
                    <TruthStateBadge state={l.truthState} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="timeline" className="mt-6">
            <h2 id="timeline" className="text-lg font-medium">
              Timeline
            </h2>
            <ol className="mt-2 space-y-2" data-testid="order-lines">
              {t.lines.map((l, i) => (
                <li
                  key={i}
                  data-kind={l.kind}
                  data-type={l.type}
                  className="rounded border border-neutral-200 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{l.title}</span>
                    {l.amount && (
                      <span>
                        {fromMinor(l.amount.minor, l.amount.currency)} {l.amount.currency}
                      </span>
                    )}
                    <TruthStateBadge state={l.truthState} />
                    <span className="text-neutral-600" data-time>
                      {time(l.at)}
                    </span>
                  </div>
                  <p className="mt-1 text-neutral-700" data-formula>
                    {l.formula}
                  </p>
                  <p className="mt-1 text-xs text-neutral-600">
                    Reference:{' '}
                    {l.href ? (
                      <Link className="text-sky-800 underline" href={l.href} data-ref>
                        {l.ref}
                      </Link>
                    ) : (
                      <code data-ref>{l.ref}</code>
                    )}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </>
  );
}
