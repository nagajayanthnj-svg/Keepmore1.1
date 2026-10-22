import Link from 'next/link';
import { TruthStateBadge } from '../../../../components/truth-state-badge';
import { humanise } from '../../../../components/workbench/labels';
import { loadOutcome, type Bucket } from '../../../../disputes/outcome-view';
import { getDb } from '../../../../lib/server-deps';
import { fromMinor } from '../../../../normalise/money';

export const metadata = { title: 'Outcome · KeepMore' };
export const dynamic = 'force-dynamic';

const KIND_TEXT = { WON: 'Won: decided in your favour', LOST: 'Lost: decided in the buyer’s favour', CANCELLED: 'Cancelled by the buyer', UNKNOWN: 'Outcome not recognised' };
const money = (minor: number, currency: string) => `${minor < 0 ? '−' : ''}${fromMinor(Math.abs(minor), currency)} ${currency}`;

function Tile({ title, help, bucket, testId }: { title: string; help: string; bucket: Bucket; testId: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4" data-testid={testId}>
      <h2 className="text-sm font-semibold text-neutral-700">{title}</h2>
      {bucket.truthState ? (
        <>
          <p className="mt-1 text-2xl font-semibold" data-testid={`${testId}-amount`}>
            {money(bucket.minor, bucket.currency)}
          </p>
          <p className="mt-1">
            <TruthStateBadge state={bucket.truthState} />
          </p>
        </>
      ) : (
        <p className="mt-1 text-2xl font-semibold text-neutral-500" data-testid={`${testId}-amount`}>
          None
        </p>
      )}
      <p className="mt-2 text-xs text-neutral-600">{help}</p>
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
        <h1 className="text-2xl font-semibold tracking-tight">Outcome not found</h1>
        <p className="mt-2 text-neutral-700">
          No dispute with that id is stored here. <Link className="text-sky-800 underline" href="/disputes">Back to the inbox</Link>.
        </p>
      </>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Outcome for {v.disputeId}</h1>
      {!v.decided ? (
        <p className="mt-2 text-neutral-700" data-testid="outcome-open">
          Not decided yet. PayPal shows the status as {humanise(v.status).toLowerCase()}.{' '}
          <Link className="text-sky-800 underline" href={`/disputes/${encodeURIComponent(v.caseId)}`}>
            Open the dispute
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="mt-2 text-lg" data-testid="outcome-kind" data-kind={v.kind}>
            {KIND_TEXT[v.kind]} <span className="text-sm text-neutral-600">(PayPal code {v.outcomeCode ?? 'none'})</span>
          </p>
          {!v.verified && (
            <p className="mt-1 rounded border border-amber-700 bg-amber-50 p-2 text-sm text-amber-900">
              We have not seen this outcome code in the sandbox, so its meaning here is our reading of PayPal’s documentation.
            </p>
          )}
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Tile title="Refunded to the buyer" help="PayPal’s settlement debit." bucket={v.buckets.refunded} testId="outcome-refunded" />
            <Tile title="Dispute fees" help="PayPal’s settlement fee debit." bucket={v.buckets.fees} testId="outcome-fees" />
            <Tile title="Retained" help="Won or cancelled with no refund: the disputed amount stays with you." bucket={v.buckets.retained} testId="outcome-retained" />
          </div>
          <p className="mt-3 text-sm text-neutral-700">
            Each amount is shown as PayPal recorded it. No net cost is worked out: whether PayPal also keeps the original
            sale fee on a lost dispute has not been checked yet.
          </p>
          <section aria-labelledby="lines" className="mt-6">
            <h2 id="lines" className="text-lg font-medium">
              Money lines
            </h2>
            {v.lines.length === 0 ? (
              <p className="mt-1 text-neutral-600">{v.orderRef ? 'No money lines for this dispute.' : 'This dispute is not linked to an order, so no money lines are kept.'}</p>
            ) : (
              <table className="mt-2 w-full text-left text-sm" data-testid="outcome-lines">
                <thead>
                  <tr className="border-b border-neutral-300">
                    <th className="py-1 pr-2">What</th>
                    <th className="py-1 pr-2">Amount</th>
                    <th className="py-1 pr-2">When (UTC)</th>
                    <th className="py-1">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {v.lines.map((l, i) => (
                    <tr key={i} className="border-b border-neutral-100">
                      <td className="py-1 pr-2">{humanise(l.type)}</td>
                      <td className="py-1 pr-2">{money(l.minor, l.currency)}</td>
                      <td className="py-1 pr-2">{l.occurredAt.slice(0, 16).replace('T', ' ')}</td>
                      <td className="py-1">
                        <TruthStateBadge state={l.truthState} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
      {v.orderRef && (
        <p className="mt-6">
          <Link className="text-sky-800 underline" data-testid="outcome-order-link" href={`/orders/${encodeURIComponent(v.orderRef)}?case=${encodeURIComponent(v.caseId)}`}>
            See this in the order’s money lines
          </Link>
        </p>
      )}
    </>
  );
}
