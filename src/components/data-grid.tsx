'use client';

// The one grid wrapper (T-113). Screens pass plain rows and column specs and never touch AG Grid.
// Community only, so no licence key is needed. If AG Studio is used it lives beside this, not in it.
import {
  CellStyleModule,
  ClientSideRowModelModule,
  ColumnAutoSizeModule,
  NumberFilterModule,
  TextFilterModule,
  themeQuartz,
} from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { useMemo } from 'react';
import { toColDefs, type GridColumn } from './grid-columns';

const modules = [CellStyleModule, ClientSideRowModelModule, TextFilterModule, NumberFilterModule, ColumnAutoSizeModule];
const theme = themeQuartz.withParams({ headerFontWeight: 600 });

/** Plain data only: screens are server components. `id` must be unique per row. */
export type GridRow = { id: string } & Record<string, string | number | null>;

export function DataGrid({
  columns,
  rows,
  label,
  testId,
}: {
  columns: GridColumn[];
  rows: GridRow[];
  /** Accessible name for the grid. */
  label: string;
  testId?: string;
}) {
  const colDefs = useMemo(() => toColDefs(columns), [columns]);
  return (
    <div data-testid={testId} aria-label={label}>
      <AgGridProvider modules={modules}>
        <AgGridReact
          theme={theme}
          columnDefs={colDefs}
          rowData={rows}
          getRowId={({ data }) => data.id}
          domLayout="autoHeight"
          defaultColDef={{ flex: 1, minWidth: 110 }}
        />
      </AgGridProvider>
    </div>
  );
}
