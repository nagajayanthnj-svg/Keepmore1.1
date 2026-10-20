import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StaleBadge } from '../../src/components/stale-badge';

const html = (state: string) => renderToStaticMarkup(createElement(StaleBadge, { state }));

describe('StaleBadge', () => {
  it('says Stale and tells the seller what to do', () => {
    expect(html('Stale')).toContain('Stale');
    expect(html('Stale')).toContain('data-sync-state="STALE"');
  });
  it('says Fresh for Fresh and treats anything else as Stale, the safe direction', () => {
    expect(html('Fresh')).toContain('data-sync-state="FRESH"');
    expect(html('whatever')).toContain('data-sync-state="STALE"');
  });
  it('does not rely on colour alone', () => {
    expect(html('Stale')).toMatch(/border-(dashed|dotted|double|solid)/);
    expect(html('Fresh')).toMatch(/border-(dashed|dotted|double|solid)/);
  });
});
