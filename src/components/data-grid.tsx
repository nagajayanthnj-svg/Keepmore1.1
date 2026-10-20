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
  fit = 'width',
}: {
  columns: GridColumn[];
  rows: GridRow[];
  /** Accessible name for the grid. */
  label: string;
  testId?: string;
  /**
   * 'width' shares the width between columns (short tables). 'content' sizes each column to its widest
   * cell and header, so no label is clipped; a wide table then scrolls sideways inside the grid.
   */
  fit?: 'width' | 'content';
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
          defaultColDef={fit === 'content' ? { minWidth: 110 } : { flex: 1, minWidth: 110 }}
          {...(fit === 'content' && {
            autoSizeStrategy: { type: 'fitCellContents' as const },
            // Render every column, so a sideways scroll never hides a truth-state label from a screen reader or a test.
            suppressColumnVirtualisation: true,
          })}
        />
      </AgGridProvider>
    </div>
  );
}
