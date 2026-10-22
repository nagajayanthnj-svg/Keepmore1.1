// The default AG Studio report for the Overview (T-405). Rules (DECISIONS, T-113):
// - every KPI shows one truth state and one currency, and names the truth state in its title;
// - a chart that adds money splits its series by kind AND truth state, and is never stacked, so no bar or total
//   adds amounts with different labels;
// - the Community table under Studio carries every number too, so Studio is a visual layer.
import type { AgReportState } from 'ag-studio';
import { LEDGER_KIND_NAME } from '../ledger/labels';
import type { TruthState } from '../lib/truth-state';

type Page = AgReportState['pages'][number];
type Widgets = NonNullable<Page['widgets']>;
type Layout = NonNullable<Page['widgetLayout']>;
type WidgetFilters = NonNullable<NonNullable<Page['filter']>['widget']>;
type FilterList = WidgetFilters[string];

const title = (text: string) => ({ title: { enabled: true, text } });
const titled = (text: string, sub: string) => ({ title: { enabled: true, text }, subtitle: { enabled: true, text: sub } });
const eq = (id: string, value: string) => ({ field: { id }, model: { operator: 'equals' as const, value } });
const isIn = (id: string, value: string[]) => ({ field: { id }, model: { operator: 'isIn' as const, value } });
const sum = (id: string) => ({ id, aggregation: 'sum' as const });
const count = (id: string) => ({ id, aggregation: 'count' as const });

const KPI_KINDS = ['GROSS', 'PAYPAL_FEE', 'FX', 'RETAINED'] as const;
const SHORT: Record<string, string> = { GROSS: 'Sales', PAYPAL_FEE: 'PayPal fees', FX: 'FX cost', RETAINED: 'Retained' };
const LEAKAGE = ['PAYPAL_FEE', 'FX', 'DUTY', 'SHIPPING', 'RETURN_POSTAGE', 'DISPUTE_FEE'];

export interface ReportInput {
  mainTruthState: Partial<Record<string, TruthState>>;
  mainCurrency: Partial<Record<string, string>>;
  disputeTruthState: TruthState;
}

function moneyPage(input: ReportInput): Page {
  const widgets: Widgets = {
    'filter-country': { type: 'list-filter', dataMapping: { value: [{ id: 'orders.country' }] }, format: title('Destination') },
    'filter-month': { type: 'list-filter', dataMapping: { value: [{ id: 'ledger.month' }] }, format: title('Month') },
  };
  const layout: Layout = {
    'filter-country': { xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 5 },
    'filter-month': { xTrack: 12, yTrack: 0, xSpan: 12, ySpan: 5 },
  };
  const filters: WidgetFilters = {};
  const FIELD: Record<string, string> = { USD: 'ledger.usdMinor', INR: 'ledger.inrMinor' };
  const kinds = KPI_KINDS.filter((k) => input.mainTruthState[k] && FIELD[input.mainCurrency[k] ?? '']);
  const span = kinds.length ? Math.floor(24 / kinds.length) : 24;
  kinds.forEach((k, i) => {
    const ts = input.mainTruthState[k]!;
    const cur = input.mainCurrency[k]!;
    const id = `kpi-money-${k.toLowerCase()}`;
    widgets[id] = {
      type: 'value',
      dataMapping: { value: [sum(FIELD[cur]!)], sparklineX: [{ id: 'ledger.month' }] },
      format: { title: { enabled: true, text: SHORT[k] ?? LEDGER_KIND_NAME[k] }, subtitle: { enabled: true, text: `${ts} · ${cur}` } },
    };
    layout[id] = { xTrack: i * span, yTrack: 5, xSpan: span, ySpan: 6 };
    filters[id] = [eq('ledger.type', k), eq('ledger.truthState', ts), eq('ledger.currency', cur)] as FilterList;
  });
  widgets['chart-month'] = {
    type: 'column-chart-grouped',
    dataMapping: { categoryKey: [{ id: 'ledger.month' }], valueKey: [sum('ledger.usd')], legendKey: [{ id: 'ledger.series' }] },
    format: title('Fees by month (USD)'),
  };
  widgets['chart-fx'] = {
    type: 'column-chart-grouped',
    dataMapping: { categoryKey: [{ id: 'ledger.month' }], valueKey: [sum('ledger.inr')], legendKey: [{ id: 'ledger.series' }] },
    format: title('FX cost by month (INR)'),
  };
  widgets['chart-country'] = {
    type: 'bar-chart-grouped',
    dataMapping: { categoryKey: [{ id: 'orders.country' }], valueKey: [sum('ledger.usd')], legendKey: [{ id: 'ledger.series' }] },
    format: title('Fees by country (USD)'),
  };
  filters['chart-month'] = [isIn('ledger.type', LEAKAGE), eq('ledger.currency', 'USD')] as FilterList;
  filters['chart-fx'] = [eq('ledger.type', 'FX'), eq('ledger.currency', 'INR')] as FilterList;
  filters['chart-country'] = [isIn('ledger.type', LEAKAGE), eq('ledger.currency', 'USD')] as FilterList;
  layout['chart-month'] = { xTrack: 0, yTrack: 11, xSpan: 8, ySpan: 13 };
  layout['chart-fx'] = { xTrack: 8, yTrack: 11, xSpan: 8, ySpan: 13 };
  layout['chart-country'] = { xTrack: 16, yTrack: 11, xSpan: 8, ySpan: 13 };
  widgets['grid-totals'] = {
    type: 'grid',
    dataMapping: {
      cols: [
        { id: 'ledger.kind' },
        { id: 'ledger.truthState' },
        { id: 'ledger.currency' },
        count('ledger.id'),
        sum('ledger.usdMinor'),
        sum('ledger.inrMinor'),
      ],
    },
    format: { ...title('Totals by kind, source label and currency'), style: { grandTotalRow: { enabled: false }, columnAutoSize: true } },
  };
  layout['grid-totals'] = { xTrack: 0, yTrack: 24, xSpan: 24, ySpan: 11 };
  return { id: 'money', widgets, widgetLayout: layout, filter: { widget: filters } };
}

function disputesPage(input: ReportInput): Page {
  const ts = input.disputeTruthState;
  const only = [eq('disputes.truthState', ts)];
  const widgets: Widgets = {
    'kpi-disputes-all': { type: 'value', dataMapping: { value: [count('disputes.id')] }, format: titled('Disputes', ts) },
    'kpi-disputes-won': { type: 'value', dataMapping: { value: [count('disputes.id')] }, format: titled('Won', ts) },
    'kpi-disputes-lost': { type: 'value', dataMapping: { value: [count('disputes.id')] }, format: titled('Lost', ts) },
    'chart-outcome': {
      type: 'donut-chart',
      dataMapping: { categoryKey: [{ id: 'disputes.outcome' }], valueKey: [count('disputes.id')] },
      format: titled('By outcome', ts),
    },
    'chart-dispute-country': {
      type: 'bar-chart-grouped',
      dataMapping: { categoryKey: [{ id: 'orders.country' }], valueKey: [count('disputes.id')] },
      format: titled('By country', ts),
    },
    'grid-disputes': {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'disputes.disputeId' },
          { id: 'disputes.stage' },
          { id: 'disputes.status' },
          { id: 'disputes.outcome' },
          { id: 'disputes.usdMinor' },
          { id: 'disputes.truthState' },
        ],
      },
      format: { ...title('Every dispute'), style: { grandTotalRow: { enabled: false }, columnAutoSize: true } },
    },
  };
  const filters: WidgetFilters = {
    'kpi-disputes-all': only as FilterList,
    'kpi-disputes-won': [...only, eq('disputes.outcome', 'Won')] as FilterList,
    'kpi-disputes-lost': [...only, eq('disputes.outcome', 'Lost')] as FilterList,
    'chart-outcome': only as FilterList,
    'chart-dispute-country': only as FilterList,
  };
  const layout: Layout = {
    'kpi-disputes-all': { xTrack: 0, yTrack: 0, xSpan: 8, ySpan: 6 },
    'kpi-disputes-won': { xTrack: 8, yTrack: 0, xSpan: 8, ySpan: 6 },
    'kpi-disputes-lost': { xTrack: 16, yTrack: 0, xSpan: 8, ySpan: 6 },
    'chart-outcome': { xTrack: 0, yTrack: 6, xSpan: 10, ySpan: 14 },
    'chart-dispute-country': { xTrack: 10, yTrack: 6, xSpan: 14, ySpan: 14 },
    'grid-disputes': { xTrack: 0, yTrack: 20, xSpan: 24, ySpan: 12 },
  };
  return { id: 'disputes', widgets, widgetLayout: layout, filter: { widget: filters } };
}

export function overviewReport(input: ReportInput): AgReportState {
  return { pages: [moneyPage(input), disputesPage(input)], selectedPageId: 'money', panels: { filters: { collapsed: true } } };
}
