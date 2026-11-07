import Link from 'next/link';
import { TruthStateBadge } from '../../../../components/truth-state-badge';
import { humanise } from '../../../../components/workbench/labels';
import { loadOutcome, type Bucket } from '../../../../disputes/outcome-view';
import { getDb } from '../../../../lib/server-deps';
import { fromMinor } from '../../../../normalise/money';

export const metadata = { title: 'Outcome · KeepMore' };
export const dynamic = 'force-dynamic';

const KIND_TEXT = { WON: 'Won: decided in your favour', LOST: 'Lost: decided in the buyer’s favour', CANCELLED: 'Cancelled by the buyer', UNKNOWN: 'Outcome not recognised' };
const KIND_RAIL = {
  WON: 'border-emerald-600 text-emerald-950',
  LOST: 'border-red-600 text-red-950',
  CANCELLED: 'border-slate-400 text-ink',
  UNKNOWN: 'border-amber-500 text-ink',
};
const money = (minor: number, currency: string) => `${minor < 0 ? '−' : ''}${fromMinor(Math.abs(minor), currency)} ${currency}`;

function Tile({ title, help, bucket, testId }: { title: string; help: string; bucket: Bucket; testId: string }) {
  return (
    <div className="km-panel" data-testid={testId}>
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      {bucket.truthState ? (
        <>
          <p className="mt-2 text-[1.7rem] leading-tight font-semibold text-navy-900" data-testid={`${testId}-amount`}>
            {money(bucket.minor, bucket.currency)}
          </p>
          <p className="mt-1">
            <TruthStateBadge state={bucket.truthState} />
          </p>
        </>
      ) : (
        <p className="mt-2 text-[1.7rem] leading-tight font-semibold text-slate-400" data-testid={`${testId}-amount`}>
          None
        </p>
      )}
      <p className="mt-3 border-t border-line pt-3 text-xs text-muted">{help}</p>
    </div>
  );
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let v = null;
  try {
    v = await loadOutcome(getDb(), id);
  } catch {
    v = null;
  }
  if (!v) {
    return (
      <>
        <h1 className="km-title">Outcome not found</h1>
        <p className="km-lede">
          No dispute with that id is stored here. <Link className="km-link" href="/disputes">Back to the inbox</Link>.
        </p>
      </>
    );
  }
  return (
    <>
      <h1 className="km-title">Outcome for {v.disputeId}</h1>
      {!v.decided ? (
        <p className="km-lede" data-testid="outcome-open">
          Not decided yet. PayPal shows the status as {humanise(v.status).toLowerCase()}.{' '}
          <Link className="km-link" href={`/disputes/${encodeURIComponent(v.caseId)}`}>
            Open the dispute
          </Link>
          .
        </p>
      ) : (
        <>
          <p className={`mt-3 inline-flex flex-wrap items-baseline gap-2 rounded-lg border-l-4 bg-white px-4 py-2.5 text-lg font-medium ${KIND_RAIL[v.kind]}`} data-testid="outcome-kind" data-kind={v.kind}>
            {KIND_TEXT[v.kind]} <span className="text-sm text-muted">(PayPal code {v.outcomeCode ?? 'none'})</span>
          </p>
          {!v.verified && (
            <p className="km-callout-warn mt-3">
              We have not seen this outcome code in the sandbox, so its meaning here is our reading of PayPal’s documentation.
            </p>
          )}
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Tile title="Refunded to the buyer" help="PayPal’s settlement debit." bucket={v.buckets.refunded} testId="outcome-refunded" />
            <Tile title="Dispute fees" help="PayPal’s settlement fee debit." bucket={v.buckets.fees} testId="outcome-fees" />
            <Tile title="Retained" help="Won or cancelled with no refund: the disputed amount stays with you." bucket={v.buckets.retained} testId="outcome-retained" />
          </div>
          <p className="mt-4 max-w-[80ch] text-sm text-muted">
            Each amount is shown as PayPal recorded it. No net cost is worked out: whether PayPal also keeps the original
            sale fee on a lost dispute has not been checked yet.
          </p>
          <section aria-labelledby="lines" className="mt-10">
            <h2 id="lines" className="km-h2">
              Money lines
            </h2>
            {v.lines.length === 0 ? (
              <p className="mt-1 text-muted">{v.orderRef ? 'No money lines for this dispute.' : 'This dispute is not linked to an order, so no money lines are kept.'}</p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-white">
              <table className="w-full text-left text-sm" data-testid="outcome-lines">
                <thead>
                  <tr className="border-b border-line bg-[#f7f9fc] text-muted">
                    <th className="px-4 py-2.5">What</th>
                    <th className="px-4 py-2.5">Amount</th>
                    <th className="px-4 py-2.5">When (UTC)</th>
                    <th className="px-4 py-2.5">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {v.lines.map((l, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5">
                        {humanise(l.type)}
                        {l.correction && <span className="text-muted"> (correction of an earlier line)</span>}
                      </td>
                      <td className="px-4 py-2.5">{money(l.minor, l.currency)}</td>
                      <td className="px-4 py-2.5">{l.occurredAt.slice(0, 16).replace('T', ' ')}</td>
                      <td className="px-4 py-2.5">
                        <TruthStateBadge state={l.truthState} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </section>
        </>
      )}
      {v.orderRef && (
        <p className="mt-8">
          <Link className="km-link" data-testid="outcome-order-link" href={`/orders/${encodeURIComponent(v.orderRef)}?case=${encodeURIComponent(v.caseId)}`}>
            See this in the order’s money lines
          </Link>
        </p>
      )}
    </>
  );
}
