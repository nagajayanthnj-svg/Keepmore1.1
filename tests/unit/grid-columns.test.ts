import { describe, expect, it } from 'vitest';
import { formatMinor, toColDefs, type GridColumn } from '../../src/components/grid-columns';

describe('formatMinor', () => {
  it.each([
    [11442, 'USD', '$114.42'],
    [28834, 'INR', '₹288.34'],
    [500, 'JPY', 'JPY 500'], // zero-decimal currency, no symbol known
    [-588, 'USD', '$-5.88'],
  ])('%s %s -> %s', (minor, currency, text) => {
    expect(formatMinor(minor, currency)).toBe(text);
  });

  it.each([[1.5], ['11442'], [null], [undefined], [Number.NaN]])('shows nothing for %s, never a guess', (value) => {
    expect(formatMinor(value, 'USD')).toBe('');
  });

  it('shows nothing when the currency is missing', () => {
    expect(formatMinor(100, undefined)).toBe('');
  });
});

describe('toColDefs', () => {
  const truth: GridColumn = { kind: 'truth', field: 'truthState', header: 'Source' };
  const money: GridColumn = { kind: 'money', field: 'totalMinor', currencyField: 'currency', header: 'Total' };

  it('refuses money columns with no truth-state column, so no number goes unlabelled', () => {
    expect(() => toColDefs([money])).toThrow(/truth/i);
    expect(() => toColDefs([{ kind: 'text', field: 'a', header: 'A' }, money])).toThrow(/truth/i);
  });

  it('accepts a grid with no money at all', () => {
    expect(toColDefs([{ kind: 'text', field: 'a', header: 'A' }])).toHaveLength(1);
  });

  it('maps fields and headers in order', () => {
    const defs = toColDefs([{ kind: 'text', field: 'type', header: 'Kind' }, truth, money]);
    expect(defs.map((d) => [d.field, d.headerName])).toEqual([
      ['type', 'Kind'],
      ['truthState', 'Source'],
      ['totalMinor', 'Total'],
    ]);
  });

  it('formats a money cell from the row currency, in minor units', () => {
    const def = toColDefs([truth, money])[1]!;
    const fmt = def.valueFormatter as (p: unknown) => string;
    expect(fmt({ value: 11442, data: { currency: 'USD' } })).toBe('$114.42');
    expect(fmt({ value: 11442, data: {} })).toBe('');
  });

  it('draws the truth column with the badge and gives it a text filter', () => {
    const def = toColDefs([truth])[0]!;
    expect(def.cellRenderer).toBeTypeOf('function');
    expect(def.filter).toBe('agTextColumnFilter');
  });

  it('sorts money by minor units and offers no filter on it', () => {
    const def = toColDefs([truth, money])[1]!;
    expect(def.sortable).toBe(true);
    expect(def.filter).toBe(false);
    expect(def.type).toBe('rightAligned');
  });

  it('rejects duplicate fields', () => {
    expect(() =>
      toColDefs([
        { kind: 'text', field: 'a', header: 'A' },
        { kind: 'text', field: 'a', header: 'B' },
      ]),
    ).toThrow(/duplicate/i);
  });
});
