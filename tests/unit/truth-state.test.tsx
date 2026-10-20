import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TruthStateBadge } from '../../src/components/truth-state-badge';
import { TRUTH_STATES, truthStateForSource } from '../../src/lib/truth-state';

describe('TRUTH_STATES', () => {
  it('is exactly the seven labels in CLAUDE.md', () => {
    expect([...TRUTH_STATES]).toEqual([
      'Verified by PayPal',
      'Calculated',
      'Seller entered',
      'Estimated',
      'Illustrative',
      'Unknown',
      'Simulated demo',
    ]);
  });
});

describe('truthStateForSource', () => {
  it.each([
    ['PAYPAL_VERIFIED', 'Verified by PayPal'],
    ['REFERENCE_RATE_ESTIMATE', 'Estimated'],
    ['SELLER_ENTERED', 'Seller entered'],
    ['DEMO_SEEDED', 'Simulated demo'],
    ['HYPOTHETICAL_SCENARIO', 'Illustrative'],
  ])('%s -> %s', (source, label) => {
    expect(truthStateForSource(source)).toBe(label);
  });
  it('maps anything it does not know to Unknown, never a new label', () => {
    expect(truthStateForSource('SOMETHING_NEW')).toBe('Unknown');
    expect(truthStateForSource('')).toBe('Unknown');
    expect(truthStateForSource(undefined)).toBe('Unknown');
  });
});

describe('TruthStateBadge', () => {
  it.each(TRUTH_STATES)('renders %s as text, exactly once, with a machine-readable state', (state) => {
    const html = renderToStaticMarkup(createElement(TruthStateBadge, { state }));
    expect(html.split(`>${state}<`)).toHaveLength(2); // the label text appears once
    expect(html).toContain(`data-truth-state="${state}"`);
  });
  it('shows Unknown for a value outside the seven', () => {
    const html = renderToStaticMarkup(createElement(TruthStateBadge, { state: 'Probably fine' as never }));
    expect(html).toContain('>Unknown<');
    expect(html).not.toContain('Probably fine');
  });
  it('gives each state its own look so colour is never the only signal', () => {
    const classes = new Set(
      TRUTH_STATES.map((s) => /class="([^"]*)"/.exec(renderToStaticMarkup(createElement(TruthStateBadge, { state: s })))![1]),
    );
    expect(classes.size).toBe(TRUTH_STATES.length);
  });
});
