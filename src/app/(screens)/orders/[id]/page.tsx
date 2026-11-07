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
      <h1 className="km-title">Order {t?.orderRef ?? id}</h1>
      <p className="km-lede">
        {t
          ? 'Everything that happened to this order and its money, oldest first. Each line says where its number comes from.'
          : 'No order with that id is stored here.'}
      </p>
      {shipment && (
        <section aria-labelledby="shipment" className="km-panel mt-7" data-testid="shipment">
          <h2 id="shipment" className="km-h2 text-base">
            Shipment
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <ShipmentBadge pushStatus={shipment.pushStatus} />
            <span>
              Carrier <strong>{shipment.carrier}</strong>, tracking <strong>{shipment.trackingNo}</strong>
            </span>
            <TruthStateBadge state={shipment.trackingNo.startsWith('DEMO') ? 'Simulated demo' : 'Seller entered'} />
          </div>
          {shipment.pushStatus !== 'PUSHED' && (
            <p className="mt-2 text-sm text-muted">
              PayPal has not received this tracking number, so it does not count as proof of shipping there yet.
            </p>
          )}
        </section>
      )}
      {t && (
        <>
          <section aria-labelledby="leakage" className="mt-8" data-testid="order-leakage">
            <h2 id="leakage" className="km-h2">
              Where money leaked on this order
            </h2>
            <p className="mt-1 km-help">
              Listed one by one with their source labels. They are not added into one total: they differ in currency or
              label.
            </p>
            {t.leakage.length === 0 ? (
              <p className="mt-1 text-sm text-muted">No fees or costs recorded.</p>
            ) : (
              <ul className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                {t.leakage.map((l) => (
                  <li key={`${l.type}|${l.truthState}|${l.currency}`} data-type={l.type} className="km-panel border-t-4 border-t-amber-500 p-4">
                    <span className="block font-medium text-muted">{l.kind}</span>
                    <strong className="my-1.5 block text-xl font-semibold text-navy-900">
                      {fromMinor(l.minor, l.currency)} {l.currency}
                    </strong>
                    <TruthStateBadge state={l.truthState} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="timeline" className="mt-10">
            <h2 id="timeline" className="km-h2">
              Timeline
            </h2>
            <ol className="relative mt-4 space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[0.4375rem] before:w-px before:bg-line" data-testid="order-lines">
              {t.lines.map((l, i) => (
                <li
                  key={i}
                  data-kind={l.kind}
                  data-type={l.type}
                  className="relative pl-7 text-sm before:absolute before:top-4 before:left-0 before:h-3.5 before:w-3.5 before:rounded-full before:border-2 before:border-brand-600 before:bg-white"
                >
                  <div className="km-panel p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-navy-900">{l.title}</span>
                      {l.amount && (
                        <span className="font-medium">
                          {fromMinor(l.amount.minor, l.amount.currency)} {l.amount.currency}
                        </span>
                      )}
                      <TruthStateBadge state={l.truthState} />
                      <span className="ml-auto text-xs text-muted" data-time>
                        {time(l.at)}
                      </span>
                    </div>
                    <p className="mt-1 text-muted" data-formula>
                      {l.formula}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Reference:{' '}
                      {l.href ? (
                        <Link className="km-link" href={l.href} data-ref>
                          {l.ref}
                        </Link>
                      ) : (
                        <code data-ref>{l.ref}</code>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </>
  );
}
