import { TruthStateBadge } from '../../../components/truth-state-badge';
import { TRUTH_STATES, TRUTH_STATE_MEANING } from '../../../lib/truth-state';

export const metadata = { title: 'Overview · KeepMore' };

export default function OverviewPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      <p className="mt-2 text-neutral-700">
        Fees, exchange-rate cost and disputes across your orders. The totals arrive in a later step; nothing here is
        guessed.
      </p>
      <section aria-labelledby="labels" className="mt-8">
        <h2 id="labels" className="text-lg font-medium">
          What the labels mean
        </h2>
        <p className="mt-1 text-sm text-neutral-700">
          Every number or fact on these screens carries exactly one of these labels.
        </p>
        <dl className="mt-3 divide-y divide-neutral-200 rounded border border-neutral-200">
          {TRUTH_STATES.map((s) => (
            <div key={s} className="flex flex-wrap items-center gap-3 p-3">
              <dt>
                <TruthStateBadge state={s} />
              </dt>
              <dd className="text-sm text-neutral-800">{TRUTH_STATE_MEANING[s]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
