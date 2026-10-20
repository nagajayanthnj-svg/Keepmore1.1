import { DataGrid } from '../../../components/data-grid';
import type { GridColumn } from '../../../components/grid-columns';
import { TruthStateBadge } from '../../../components/truth-state-badge';
import { loadOverview } from '../../../ledger/views';
import { getDb } from '../../../lib/server-deps';
import { TRUTH_STATES, TRUTH_STATE_MEANING, truthStateForSource } from '../../../lib/truth-state';

export const metadata = { title: 'Overview · KeepMore' };
export const dynamic = 'force-dynamic';

const TYPE_NAME: Record<string, string> = {
  GROSS: 'Sales (gross)',
  PAYPAL_FEE: 'PayPal fees',
  FX: 'Exchange-rate cost',
  DUTY: 'Duty',
  SHIPPING: 'Shipping',
  RETURN_POSTAGE: 'Return postage',
  REFUND: 'Refunds',
  DISPUTE_FEE: 'Dispute fees',
  RETAINED: 'Retained',
};
const TOTAL_COLUMNS: GridColumn[] = [
  { kind: 'text', field: 'type', header: 'Kind' },
  { kind: 'truth', field: 'truthState', header: 'Source' },
  { kind: 'money', field: 'totalMinor', currencyField: 'currency', header: 'Total' },
  { kind: 'integer', field: 'entries', header: 'Entries' },
];

export default async function OverviewPage() {
  const view = await loadOverview(getDb());
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      <p className="mt-2 text-neutral-700">
        Totals from the ledger, one row per kind and source. Rows with different sources or currencies are never added
        together.
      </p>

      <section aria-labelledby="totals" className="mt-6">
        <h2 id="totals" className="text-lg font-medium">
          Ledger totals
        </h2>
        {!view.ready ? (
          <p role="status" className="mt-2 rounded border border-neutral-300 p-3 text-sm">
            The database is not set up yet. Run <code>npm run db:migrate</code> and then <code>npm run db:seed</code>.
          </p>
        ) : (
          <>
            <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div className="flex items-center gap-2">
                <dt>Demo orders</dt>
                <dd data-testid="orders-demo" className="font-semibold">
                  {view.orders.demo}
                </dd>
                <TruthStateBadge state="Simulated demo" />
              </div>
              <div className="flex items-center gap-2">
                <dt>Sandbox orders</dt>
                <dd data-testid="orders-other" className="font-semibold">
                  {view.orders.other}
                </dd>
                <TruthStateBadge state="Calculated" />
              </div>
            </dl>
            {view.rows.length === 0 ? (
              <p role="status" className="mt-3 text-sm text-neutral-700">
                No ledger entries yet. Seed the demo shop or make a sandbox purchase.
              </p>
            ) : (
              <div className="mt-3">
                <DataGrid
                  testId="totals"
                  label="Ledger totals by kind, source and currency"
                  columns={TOTAL_COLUMNS}
                  rows={view.rows.map((r) => ({
                    id: `${r.type}|${r.sourceType}|${r.currency}`,
                    type: TYPE_NAME[r.type] ?? r.type,
                    truthState: truthStateForSource(r.sourceType),
                    totalMinor: r.totalMinor,
                    currency: r.currency,
                    entries: r.entries,
                  }))}
                />
              </div>
            )}
          </>
        )}
      </section>

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
