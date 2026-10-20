'use client';
// THROWAWAY SPIKE: does AG Studio render our ledger shape with no licence key?
import type { AgReportState } from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';

const sum = (id: string) => ({ id, aggregation: 'sum' as const });
const report: AgReportState = {
  selectedPageId: 'p1',
  pages: [
    {
      id: 'p1',
      widgets: {
        kpi: { type: 'value', dataMapping: { value: [sum('ledger.amount')] }, format: { title: { enabled: true, text: 'Ledger total' } } },
        byType: { type: 'bar-chart-grouped', dataMapping: { categoryKey: [{ id: 'ledger.type' }], valueKey: [sum('ledger.amount')] }, format: { title: { enabled: true, text: 'By type' } } },
        grid: { type: 'grid', dataMapping: { cols: [{ id: 'ledger.type' }, { id: 'ledger.truthState' }, sum('ledger.amount')] }, format: { title: { enabled: true, text: 'By truth state' } } },
      },
      widgetLayout: {
        kpi: { xTrack: 0, yTrack: 0, xSpan: 8, ySpan: 7 },
        byType: { xTrack: 8, yTrack: 0, xSpan: 16, ySpan: 14 },
        grid: { xTrack: 0, yTrack: 14, xSpan: 24, ySpan: 14 },
      },
    },
  ],
};

const types = ['GROSS', 'PAYPAL_FEE', 'FX'] as const;
const sources = ['PAYPAL_VERIFIED', 'DEMO_SEEDED', 'REFERENCE_RATE_ESTIMATE'] as const;
const rows = Array.from({ length: 60 }, (_, i) => ({
  id: `L${i}`,
  type: types[i % 3],
  truthState: sources[i % 3] === 'PAYPAL_VERIFIED' ? 'Verified by PayPal' : sources[i % 3] === 'DEMO_SEEDED' ? 'Simulated demo' : 'Estimated',
  currency: 'USD',
  amount: (i % 3 === 0 ? 100 : 4) + i,
  occurredOn: `2026-0${(i % 6) + 4}-${String((i % 27) + 1).padStart(2, '0')}`,
}));

export default function Page() {
  return (
    <div style={{ height: '100vh' }}>
      <AgStudioProvider licenseKey={undefined}>
        <AgStudio
          style={{ height: '100%', width: '100%' }}
          mode="view"
          initialState={report}
          data={{
            description: 'Spike ledger rows',
            sources: [
              {
                id: 'ledger',
                name: 'Ledger',
                data: rows,
                fields: [
                  { id: 'id', name: 'Entry', format: 'textFormat', hide: true },
                  { id: 'type', name: 'Type', format: 'textFormat' },
                  { id: 'truthState', name: 'Truth state', format: 'textFormat' },
                  { id: 'currency', name: 'Currency', format: 'textFormat' },
                  { id: 'amount', name: 'Amount', format: 'currencyFormat' },
                  { id: 'occurredOn', name: 'Date', format: 'dateFormat' },
                ],
              },
            ],
          }}
        />
      </AgStudioProvider>
    </div>
  );
}
