import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShipmentBadge } from '../../src/components/shipment-badge';

const html = (pushStatus: string) => renderToStaticMarkup(createElement(ShipmentBadge, { pushStatus }));

describe('ShipmentBadge', () => {
  it('says the tracking reached PayPal only when it did', () => {
    expect(html('PUSHED')).toContain('Tracking sent to PayPal');
    expect(html('PUSHED')).not.toContain('Local tracking only');
  });

  it.each(['REJECTED', 'NOT_ATTEMPTED', 'SOMETHING_NEW'])('%s shows "Local tracking only"', (status) => {
    expect(html(status)).toContain('Local tracking only');
  });

  it('exposes the status for tests and does not rely on colour alone', () => {
    expect(html('REJECTED')).toContain('data-shipment-status="LOCAL_ONLY"');
    expect(html('PUSHED')).toContain('data-shipment-status="PUSHED"');
    expect(html('REJECTED')).toMatch(/border-(dashed|dotted|double|solid)/);
  });
});
