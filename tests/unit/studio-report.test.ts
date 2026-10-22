import { describe, expect, it } from 'vitest';
import { overviewReport } from '../../src/overview/studio-report';

const main = { GROSS: 'Simulated demo', PAYPAL_FEE: 'Simulated demo', FX: 'Estimated', REFUND: 'Verified by PayPal', DISPUTE_FEE: 'Verified by PayPal', RETAINED: 'Simulated demo' } as const;
const currency = { GROSS: 'USD', PAYPAL_FEE: 'USD', FX: 'INR', REFUND: 'USD', DISPUTE_FEE: 'USD', RETAINED: 'USD' } as const;
const report = overviewReport({ mainTruthState: main, mainCurrency: currency, disputeTruthState: 'Simulated demo' });
type Filter = { field: { id: string }; model?: { operator: string; value?: unknown } };

describe('the default AG Studio report (T-405)', () => {
  it('starts with the filters panel collapsed', () => expect(report.panels?.filters?.collapsed).toBe(true));
  it('has a money page and a disputes page', () => {
    expect(report.pages.map((p) => p.id)).toEqual(['money', 'disputes']);
    expect(report.selectedPageId).toBe('money');
  });
  it('every KPI is filtered to exactly one truth state and one currency, and names both on the tile', () => {
    for (const page of report.pages) {
      for (const [id, w] of Object.entries(page.widgets ?? {})) {
        if (w?.type !== 'value') continue;
        const filters = (page.filter?.widget?.[id] ?? []) as Filter[];
        const ts = filters.filter((f) => f.field.id.endsWith('.truthState') && f.model?.operator === 'equals');
        expect(ts, id).toHaveLength(1);
        const f = w.format as { title?: { text?: string }; subtitle?: { text?: string } } | undefined;
        const words = `${f?.title?.text ?? ''} ${f?.subtitle?.text ?? ''}`;
        expect(words, id).toContain(String(ts[0]!.model!.value));
        if (id.startsWith('kpi-money')) {
          const cur = filters.find((x) => x.field.id === 'ledger.currency');
          expect(cur?.model?.operator, id).toBe('equals');
          expect(words, id).toContain(String(cur!.model!.value));
          const field = (w.dataMapping as { value: { id: string }[] }).value[0]!.id;
          expect(field, id).toBe(cur!.model!.value === 'USD' ? 'ledger.usdMinor' : 'ledger.inrMinor');
        }
      }
    }
  });
  it('the FX tile is in INR, where the exchange-rate cost is', () => {
    const w = report.pages[0]!.widgets!['kpi-money-fx']!;
    expect((w.dataMapping as { value: { id: string }[] }).value[0]!.id).toBe('ledger.inrMinor');
  });
  it('no grid shows a grand total (it would add different currencies and labels)', () => {
    for (const page of report.pages)
      for (const w of Object.values(page.widgets ?? {}))
        if (w?.type === 'grid') expect((w.format as { style?: { grandTotalRow?: { enabled?: boolean } } }).style?.grandTotalRow?.enabled).toBe(false);
  });
  it('a chart of money uses one currency field and filters to that currency', () => {
    const page = report.pages[0]!;
    for (const [id, w] of Object.entries(page.widgets ?? {})) {
      if (!w || !String(w.type).includes('chart')) continue;
      const v = (w.dataMapping as { valueKey: { id: string }[] }).valueKey.map((x) => x.id);
      expect(v.length, id).toBe(1);
      expect(['ledger.usd', 'ledger.inr'], id).toContain(v[0]);
      const cur = ((page.filter?.widget?.[id] ?? []) as Filter[]).find((x) => x.field.id === 'ledger.currency');
      expect(cur?.model?.value, id).toBe(v[0] === 'ledger.usd' ? 'USD' : 'INR');
    }
  });
  it('charts that add money never add across truth states: the series is kind and label together', () => {
    const page = report.pages[0]!;
    for (const [id, w] of Object.entries(page.widgets ?? {})) {
      if (!w || !String(w.type).includes('chart')) continue;
      expect(String(w.type), id).not.toMatch(/stacked/);
      const legend = (w.dataMapping as { legendKey?: { id: string }[] }).legendKey ?? [];
      expect(legend.map((l) => l.id), id).toEqual(['ledger.series']);
    }
  });
  it('every widget has a place in the layout', () => {
    for (const page of report.pages) expect(Object.keys(page.widgetLayout ?? {}).sort()).toEqual(Object.keys(page.widgets ?? {}).sort());
  });
});
