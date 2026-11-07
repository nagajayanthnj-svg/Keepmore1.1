import { DataGrid } from '../../../components/data-grid';
import type { GridColumn } from '../../../components/grid-columns';
import { TruthStateBadge } from '../../../components/truth-state-badge';
import { loadOverview } from '../../../ledger/views';
import { LEDGER_KIND_NAME } from '../../../ledger/labels';
import { OverviewStudioLazy } from '../../../components/overview-studio-lazy';
import { loadStudioData } from '../../../overview/studio-data';
import { overviewReport } from '../../../overview/studio-report';
import { assistantStatus } from '../../../overview/assistant-status';
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
  const model = getStudioAi();
  const demo = studio ? await loadStudioData(getDb(), { demoOnly: true }).catch(() => null) : null;
  const status = assistantStatus({ ai: model?.kind ?? null, demoLines: demo?.ledger.length ?? 0 });
  const ai = status.ready && demo ? { data: demo, report: overviewReport(demo) } : null;
  return (
    <>
      <h1 className="km-title">Overview</h1>
      <p className="km-lede">
        Totals from the ledger, one row per kind and source. Rows with different sources or currencies are never added
        together.
      </p>

      {studio && studio.ledger.length > 0 && (
        <section aria-labelledby="dashboard" className="mt-8">
          <h2 id="dashboard" className="km-h2">
            Dashboard
          </h2>
          <p className="mt-1 mb-4 km-help">
            Built with AG Studio from the same ledger as the table below. Each tile names its source label.
          </p>
          <OverviewStudioLazy data={studio} report={overviewReport(studio)} ai={ai} aiOff={status.ready ? null : status.reason} />
        </section>
      )}

      <section aria-labelledby="totals" className="mt-10">
        <h2 id="totals" className="km-h2">
          Ledger totals
        </h2>
        {!view.ready ? (
          <p role="status" className="mt-3 km-panel text-sm">
            The database is not set up yet. Run <code>npm run db:migrate</code> and then <code>npm run db:seed</code>.
          </p>
        ) : (
          <>
            <dl className="mt-3 flex flex-wrap gap-3 text-sm">
              <div className="km-panel flex items-center gap-3 px-4 py-3">
                <dt className="text-muted">Demo orders</dt>
                <dd data-testid="orders-demo" className="text-lg font-semibold text-navy-900">
                  {view.orders.demo}
                </dd>
                <TruthStateBadge state="Simulated demo" />
              </div>
              <div className="km-panel flex items-center gap-3 px-4 py-3">
                <dt className="text-muted">Sandbox orders</dt>
                <dd data-testid="orders-other" className="text-lg font-semibold text-navy-900">
                  {view.orders.other}
                </dd>
                <TruthStateBadge state="Calculated" />
              </div>
            </dl>
            {view.rows.length === 0 ? (
              <p role="status" className="mt-3 text-sm text-muted">
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

      <section aria-labelledby="labels" className="mt-10">
        <h2 id="labels" className="km-h2">
          What the labels mean
        </h2>
        <p className="mt-1 km-help">
          Every number or fact on these screens carries exactly one of these labels.
        </p>
        <dl className="mt-4 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 sm:[&>div:last-child:nth-child(odd)]:col-span-2">
          {TRUTH_STATES.map((s) => (
            <div key={s} className="flex flex-wrap items-center gap-3 bg-white p-4">
              <dt>
                <TruthStateBadge state={s} />
              </dt>
              <dd className="text-sm text-ink">{TRUTH_STATE_MEANING[s]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
