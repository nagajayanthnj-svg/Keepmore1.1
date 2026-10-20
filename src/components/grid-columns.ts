// Column specs for the one grid wrapper (T-113). Pure and plain, so it is unit tested without a browser.
// Money cells hold integer minor units and are formatted with fromMinor; the grid does no arithmetic.
import type { ColDef, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community';
import { createElement } from 'react';
import { fromMinor } from '../normalise/money';
import { asTruthState } from '../lib/truth-state';
import { StaleBadge } from './stale-badge';
import { TruthStateBadge } from './truth-state-badge';

export type GridColumn =
  | { kind: 'text'; field: string; header: string }
  | { kind: 'integer'; field: string; header: string }
  /** `field` holds integer minor units; `currencyField` names the row's currency column. */
  | { kind: 'money'; field: string; currencyField: string; header: string }
  /** `field` holds a truth-state label; it is drawn as the badge. */
  | { kind: 'truth'; field: string; header: string }
  /** `field` holds the text; `hrefField` names the row column with a path on this site (starting with one "/"). */
  | { kind: 'link'; field: string; hrefField: string; header: string }
  /** `field` holds "Fresh" or "Stale"; it is drawn as the badge. */
  | { kind: 'freshness'; field: string; header: string };

const SYMBOL: Record<string, string> = { USD: '$', INR: '₹' };

/** "$114.42" from 11442 USD. Anything that is not an integer amount in a known currency string shows nothing. */
export function formatMinor(minor: unknown, currency: unknown): string {
  if (typeof minor !== 'number' || !Number.isSafeInteger(minor) || typeof currency !== 'string' || !currency) return '';
  return `${SYMBOL[currency] ?? `${currency} `}${fromMinor(minor, currency)}`;
}

const badge = (p: ICellRendererParams) =>
  typeof p.value === 'string' ? createElement(TruthStateBadge, { state: asTruthState(p.value) }) : null;

function linkRenderer(hrefField: string) {
  function LinkCell(p: ICellRendererParams) {
    const href: unknown = p.data?.[hrefField];
    // A path on this site only: one leading "/" and no "//" or scheme.
    return typeof p.value === 'string' && typeof href === 'string' && /^\/(?!\/)[^\s]*$/.test(href)
      ? createElement('a', { href, className: 'font-medium text-sky-800 underline' }, p.value)
      : (p.value ?? null);
  }
  return LinkCell;
}
const freshness = (p: ICellRendererParams) =>
  typeof p.value === 'string' ? createElement(StaleBadge, { state: p.value }) : null;

/**
 * Turns specs into AG Grid column definitions. A grid that shows money must also have a truth-state
 * column: every number carries a label (CLAUDE.md), so an unlabelled money grid cannot be built.
 */
export function toColDefs(columns: GridColumn[]): ColDef[] {
  const fields = columns.map((c) => c.field);
  const dupe = fields.find((f, i) => fields.indexOf(f) !== i);
  if (dupe) throw new Error(`Duplicate grid column field: ${dupe}`);
  if (columns.some((c) => c.kind === 'money') && !columns.some((c) => c.kind === 'truth')) {
    throw new Error('A grid with money needs a truth-state column');
  }
  return columns.map((c): ColDef => {
    const base = { field: c.field, headerName: c.header, sortable: true };
    switch (c.kind) {
      case 'text':
        return { ...base, filter: 'agTextColumnFilter' };
      case 'integer':
        return { ...base, filter: 'agNumberColumnFilter', type: 'rightAligned' };
      case 'truth':
        return { ...base, filter: 'agTextColumnFilter', cellRenderer: badge };
      case 'link':
        return { ...base, filter: 'agTextColumnFilter', cellRenderer: linkRenderer(c.hrefField) };
      case 'freshness':
        return { ...base, filter: 'agTextColumnFilter', cellRenderer: freshness };
      case 'money':
        return {
          ...base,
          filter: false, // a filter would take typed numbers; amounts stay integer minor units
          type: 'rightAligned',
          valueFormatter: (p: ValueFormatterParams) =>
            formatMinor(p.value, (p.data as Record<string, unknown> | undefined)?.[c.currencyField]),
        };
    }
  });
}
