import { DataGrid } from '../../../components/data-grid';
import type { GridColumn } from '../../../components/grid-columns';
import { TruthStateBadge } from '../../../components/truth-state-badge';
import { loadOverview } from '../../../ledger/views';
import { LEDGER_KIND_NAME } from '../../../ledger/labels';
import { OverviewStudioLazy } from '../../../components/overview-studio-lazy';
import { loadStudioData } from '../../../overview/studio-data';
import { overviewReport } from '../../../overview/studio-report';
import { getDb, getStudioAi } from '../../../lib/server-deps';
import { TRUTH_STATES, TRUTH_STATE_MEANING, truthStateForSource } from '../../../lib/truth-state';

export const metadata = { title: 'Overview · KeepMore' };
export const dynamic = 'force-dynamic';

const TOTAL_COLUMNS: GridColumn[] = [
  { kind: 'text', field: 'type', header: 'Kind' },
  { kind: 'truth', field: 'truthState', header: 'Source' },
  { kind: 'money', field: 'totalMinor', currencyField: 'currency', header: 'Total' },
  { kind: 'integer', field: 'entries', header: 'Entries' },
];

export default async function OverviewPage() {
  const view = await loadOverview(getDb());
  const studio = view.ready ? await loadStudioData(getDb()).catch(() => null) : null;
  // The AI assistant gets the demo shop only (owner decision 22 Oct; CLAUDE.md: synthetic demo data only).
  const demo = studio && getStudioAi() ? await loadStudioData(getDb(), { demoOnly: true }).catch(() => null) : null;
  const ai = demo && demo.ledger.length > 0 ? { data: demo, report: overviewReport(demo) } : null;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      <p className="mt-2 text-neutral-700">
        Totals from the ledger, one row per kind and source. Rows with different sources or currencies are never added
        together.
      </p>

      {studio && studio.ledger.length > 0 && (
        <section aria-labelledby="dashboard" className="mt-6">
          <h2 id="dashboard" className="text-lg font-medium">
            Dashboard
          </h2>
          <p className="mt-1 mb-3 text-sm text-neutral-700">
            Built with AG Studio from the same ledger as the table below. Each tile names its source label.
          </p>
          <OverviewStudioLazy data={studio} report={overviewReport(studio)} ai={ai} />
        </section>
      )}

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
                    type: LEDGER_KIND_NAME[r.type] ?? r.type,
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
