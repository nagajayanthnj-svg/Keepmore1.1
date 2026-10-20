import { describe, expect, it } from 'vitest';
import { normaliseTracking } from '../../src/normalise/tracking';

// Independent review of T-106 normaliseTracking: text pasted from email, PDFs and spreadsheets.

describe('review: normaliseTracking', () => {
  it.each([
    ['en dash', 'EE–123–456–789–IN'],
    ['minus sign', 'EE−123−456−789−IN'],
    ['tabs', 'EE\t123\t456\t789\tIN'],
    ['newlines', 'EE123\n456\r\n789IN\n'],
    ['lowercase', 'ee123456789in'],
    ['mixed', ' ee 123–456\t789−in\n'],
  ])('%s: %j -> EE123456789IN', (_label, raw) => {
    expect(normaliseTracking(raw)).toBe('EE123456789IN');
  });

  it('is idempotent on the cleaned value', () => {
    const once = normaliseTracking(' ee 123–456\t789−in\n');
    expect(normaliseTracking(once)).toBe(once);
  });
});
