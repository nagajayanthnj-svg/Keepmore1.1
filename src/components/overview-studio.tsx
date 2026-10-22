'use client';
// AG Studio on the Overview (T-405, option a). View mode by default; "Customise" switches to edit mode so the seller
// can build their own charts from the same three sources. A customised layout is kept in this browser only.
import { AgStudioAiModule, createAiHarness, createFormats, type AgAiHarnessSetupParams, type AgDataSourcesDefinition, type AgReportState, type AgStudioApi } from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import { useRef, useState } from 'react';
import { fromMinor } from '../normalise/money';
import type { StudioData } from '../overview/studio-data';
import { keepMoreAdapter } from './studio-ai-adapter';

const SAVED = 'keepmore.overview.studio.v1';

/**
 * Money is integer minor units, shown through fromMinor (CLAUDE.md). Registered as Studio formats (not per-field
 * formatters, which Studio ignores in edit mode), and only aggregations that keep whole numbers are allowed: no average.
 */
const minorFormat = (cur: string) => ({
  dataType: 'number' as const,
  supportedRoles: ['numeric' as const],
  supportedAggregations: ['sum' as const, 'min' as const, 'max' as const],
  serializer: (v: unknown) => v,
  deserializer: (v: unknown) => v,
  blankValue: '',
  createValueFormatter: () => (v: number | null | undefined) =>
    v == null ? '' : Number.isInteger(v) ? `${fromMinor(v, cur)} ${cur}` : `${fromMinor(Math.round(v), cur)} ${cur} (rounded)`,
});
const MONEY_FORMATS = createFormats({ additionalTypes: { usdMinor: minorFormat('USD'), inrMinor: minorFormat('INR') } } as never);
const moneyField = (id: string, name: string, cur: 'USD' | 'INR') => ({ id, name, format: (cur === 'USD' ? 'usdMinor' : 'inrMinor') as never });
/** Chart-axis copy in major units (display only; tiles and tables use the exact minor-unit fields). */
const axisField = (id: string, name: string, cur: string) => ({
  id,
  name,
  format: 'currencyFormat' as const,
  formatOptions: { format: new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }) },
});
const text = (id: string, name: string, hide = false) => ({ id, name, format: 'textFormat' as const, hide });

function sources(d: StudioData): AgDataSourcesDefinition {
  return {
    description: 'KeepMore ledger, orders and disputes. Amounts in minor units, shown in their currency.',
    formats: MONEY_FORMATS as never,
    sources: [
      {
        id: 'ledger',
        name: 'Ledger',
        description: 'One line per money movement on an order, with its source label.',
        data: d.ledger,
        fields: [
          text('id', 'Entry', true),
          text('orderId', 'Order', true),
          text('type', 'Kind code', true),
          text('kind', 'Kind'),
          { id: 'amountMinor', name: 'Amount (minor units, any currency)', format: 'integerFormat' as const, hide: true },
          text('currency', 'Currency'),
          moneyField('usdMinor', 'Amount USD', 'USD'),
          moneyField('inrMinor', 'Amount INR', 'INR'),
          axisField('usd', 'Amount USD (chart)', 'USD'),
          axisField('inr', 'Amount INR (chart)', 'INR'),
          text('truthState', 'Source label'),
          text('series', 'Kind and label'),
          text('month', 'Month'),
          { id: 'date', name: 'Date', format: 'dateFormat' },
        ],
      },
      {
        id: 'orders',
        name: 'Orders',
        data: d.orders,
        fields: [
          text('id', 'Order id', true),
          text('orderRef', 'Order'),
          text('country', 'Destination'),
          text('month', 'Order month'),
          { id: 'grossMinor', name: 'Order total (minor units)', format: 'integerFormat' as const, hide: true },
          text('currency', 'Order currency'),
          text('truthState', 'Order source label'),
          { id: 'disputed', name: 'Disputed', format: 'booleanFormat' },
        ],
      },
      {
        id: 'disputes',
        name: 'Disputes',
        data: d.disputes,
        fields: [
          text('id', 'Case', true),
          text('disputeId', 'Dispute'),
          text('orderId', 'Order id', true),
          text('stage', 'Stage'),
          text('status', 'Status'),
          text('outcome', 'Outcome'),
          { id: 'amountMinor', name: 'Disputed amount (minor units)', format: 'integerFormat' as const, hide: true },
          moneyField('usdMinor', 'Disputed amount USD', 'USD'),
          text('currency', 'Dispute currency'),
          text('truthState', 'Dispute source label'),
        ],
      },
    ],
    relationships: [
      { id: 'ledger-order', source: { tableId: 'ledger', fieldId: 'orderId' }, target: { tableId: 'orders', fieldId: 'id' }, type: 'many-to-one' },
      { id: 'dispute-order', source: { tableId: 'disputes', fieldId: 'orderId' }, target: { tableId: 'orders', fieldId: 'id' }, type: 'many-to-one' },
    ],
  };
}

function savedState(): AgReportState | undefined {
  try {
    const s = window.localStorage.getItem(SAVED);
    return s ? (JSON.parse(s) as AgReportState) : undefined;
  } catch {
    return undefined;
  }
}

const STARTERS = [
  { label: 'Fees by country', prompt: 'Add a bar chart of PayPal fees in USD by destination country.' },
  { label: 'Worst month for FX', prompt: 'Which month had the highest exchange-rate cost in INR? Add a chart that shows it.' },
  { label: 'Disputes by outcome', prompt: 'Add a table of disputes with their outcome and disputed amount.' },
];

/** AG Studio's assistant, wired to our server route (the key stays there) and Studio's built-in agents. */
const aiSetup = (params: AgAiHarnessSetupParams) =>
  createAiHarness(params.api, { adapter: keepMoreAdapter(), primary: 'lead', promptStarters: STARTERS });

export interface StudioAiProps {
  data: StudioData;
  report: AgReportState;
}

export function OverviewStudio({
  data,
  report,
  ai,
  aiOff,
}: {
  data: StudioData;
  report: AgReportState;
  ai?: StudioAiProps | null;
  /** Why the assistant cannot be used here; the button shows greyed out with this reason. */
  aiOff?: string | null;
}) {
  const [aiOn, setAiOn] = useState(false);
  const api = useRef<AgStudioApi | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const modeRef = useRef<'view' | 'edit'>('view');
  const [initial] = useState(() => savedState() ?? report);
  const [custom, setCustom] = useState(() => savedState() !== undefined);
  const [failed, setFailed] = useState<string | null>(null);
  const [page, setPage] = useState(initial.selectedPageId);
  const show = (id: string) => {
    const st = api.current?.getState();
    if (st) api.current?.setState({ ...st, selectedPageId: id });
    setPage(id);
  };

  const toggle = () => {
    const next = mode === 'view' ? 'edit' : 'view';
    api.current?.setProperty('mode', next);
    modeRef.current = next;
    setMode(next);
  };
  const reset = () => {
    try {
      window.localStorage.removeItem(SAVED);
    } catch {
      // storage blocked: nothing to remove
    }
    api.current?.setState(report);
    setCustom(false);
  };

  return (
    <div data-testid="overview-studio">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        {!aiOn && (
          <button type="button" onClick={toggle} data-testid="studio-mode" className="rounded border border-neutral-500 px-3 py-1.5">
            {mode === 'view' ? 'Customise this dashboard' : 'Done customising'}
          </button>
        )}
        {!ai && aiOff && (
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" disabled data-testid="studio-ai" className="rounded border border-neutral-300 px-3 py-1.5 text-neutral-400">
              Ask the AI assistant (demo data only)
            </button>
            <span className="text-neutral-600" data-testid="studio-ai-off">
              {aiOff}
            </span>
          </span>
        )}
        {ai && (
          <button
            type="button"
            data-testid="studio-ai"
            aria-pressed={aiOn}
            onClick={() => setAiOn(!aiOn)}
            className={`rounded border px-3 py-1.5 ${aiOn ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-500'}`}
          >
            {aiOn ? 'Close the AI assistant' : 'Ask the AI assistant (demo data only)'}
          </button>
        )}
        {custom && (
          <button type="button" onClick={reset} className="rounded border border-neutral-300 px-3 py-1.5" data-testid="studio-reset">
            Back to the default layout
          </button>
        )}
        <span className="text-neutral-600">
          {mode === 'edit' ? 'Drag fields onto the canvas to build your own charts. Kept in this browser only.' : 'Click a bar or a filter to narrow every chart.'}
        </span>
      </div>
      <div role="tablist" aria-label="Dashboard pages" className={`mb-2 flex gap-1 text-sm ${aiOn ? 'hidden' : ''}`}>
        {(
          [
            ['money', 'Money'],
            ['disputes', 'Disputes'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={page === id}
            data-testid={`studio-page-${id}`}
            onClick={() => show(id)}
            className={`rounded-t border-b-2 px-3 py-1.5 ${page === id ? 'border-neutral-900 font-semibold' : 'border-transparent text-neutral-600'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {aiOn && (
        <p className="mb-2 rounded border-2 border-dotted border-orange-700 bg-orange-50 p-2 text-sm text-orange-900" data-testid="studio-ai-note">
          The assistant sees the demo shop only (Simulated demo). Real sandbox orders are hidden while it is open, and the
          server refuses any request that contains one. Ask in plain words, for example “fees by country”. Charts it builds
          are not saved.
        </p>
      )}
      {failed && (
        <p role="alert" className="mb-2 rounded border-2 border-red-700 bg-red-50 p-2 text-sm text-red-900">
          The dashboard could not load ({failed}). The table below has the same totals.
        </p>
      )}
      <div style={{ height: aiOn ? 760 : 680 }} className="overflow-hidden rounded-lg border border-neutral-200">
        <AgStudioProvider licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY || undefined} modules={[AgStudioAiModule]}>
          {aiOn && ai ? (
            <AgStudio
              key="ai"
              style={{ height: '100%', width: '100%' }}
              mode="edit"
              initialState={{ ...ai.report, panels: { ...ai.report.panels, ai: { collapsed: false } } }}
              data={sources(ai.data)}
              ai={aiSetup}
            />
          ) : (
            <AgStudio
              key="plain"
              style={{ height: '100%', width: '100%' }}
              mode="view"
              initialState={initial}
              data={sources(data)}
              onApiReady={(e) => {
                api.current = e.api as AgStudioApi;
              }}
              onStateUpdated={(e) => {
                if (modeRef.current !== 'edit') return; // only what the seller built is kept, not view-mode clicks
                try {
                  window.localStorage.setItem(SAVED, JSON.stringify(e.state ?? api.current?.getState()));
                  setCustom(true);
                } catch {
                  // storage blocked: the change lasts until the page is left
                }
              }}
              onErrorRaised={(e) => {
                if ((e as { fatal?: boolean }).fatal) setFailed(String((e as { errorType?: string }).errorType ?? 'error'));
              }}
            />
          )}
        </AgStudioProvider>
      </div>
    </div>
  );
}
