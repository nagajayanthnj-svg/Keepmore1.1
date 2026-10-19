import { describe, expect, it } from 'vitest';
import { fromMinor, toMinor } from '../../src/normalise/money';

describe('toMinor', () => {
  it('parses decimal strings to integer minor units', () => {
    expect(toMinor('114.42', 'USD')).toBe(11442);
    expect(toMinor('114', 'USD')).toBe(11400);
    expect(toMinor('0.07', 'USD')).toBe(7);
    expect(toMinor('-5.88', 'USD')).toBe(-588);
  });

  it('is exact where floats are not', () => {
    expect(toMinor('0.29', 'USD')).toBe(29); // 0.29 * 100 === 28.999999999999996
    expect(toMinor('1.15', 'USD')).toBe(115);
  });

  it('uses the currency exponent', () => {
    expect(toMinor('500', 'JPY')).toBe(500);
    expect(toMinor('1.234', 'KWD')).toBe(1234);
    expect(toMinor('955.46', 'INR')).toBe(95546);
  });

  it('rejects more decimals than the currency has, never rounds', () => {
    expect(() => toMinor('114.425', 'USD')).toThrow();
    expect(() => toMinor('500.5', 'JPY')).toThrow();
  });

  it('accepts trailing zeros beyond the exponent', () => {
    expect(toMinor('114.4200', 'USD')).toBe(11442);
  });

  it('rejects anything that is not a plain decimal string', () => {
    for (const bad of ['', ' ', 'abc', '1,000.00', '1e3', '12.', '.5', '$5', '--1']) {
      expect(() => toMinor(bad, 'USD')).toThrow();
    }
  });

  it('rejects a JS number at the type level and at runtime', () => {
    // @ts-expect-error a number is not a decimal string
    expect(() => toMinor(114.42, 'USD')).toThrow();
  });

  it('rejects an unknown currency', () => {
    expect(() => toMinor('1.00', 'XXXX')).toThrow();
  });

  it('rejects amounts beyond the safe integer range', () => {
    expect(() => toMinor('90071992547409.93', 'USD')).toThrow();
  });
});

describe('fromMinor', () => {
  it('formats integer minor units as a decimal string', () => {
    expect(fromMinor(11442, 'USD')).toBe('114.42');
    expect(fromMinor(7, 'USD')).toBe('0.07');
    expect(fromMinor(11400, 'USD')).toBe('114.00');
    expect(fromMinor(-588, 'USD')).toBe('-5.88');
    expect(fromMinor(0, 'USD')).toBe('0.00');
  });

  it('uses the currency exponent', () => {
    expect(fromMinor(500, 'JPY')).toBe('500');
    expect(fromMinor(1234, 'KWD')).toBe('1.234');
  });

  it('round-trips', () => {
    for (const s of ['114.42', '0.01', '47.34', '28.27', '120.00']) {
      expect(fromMinor(toMinor(s, 'USD'), 'USD')).toBe(s);
    }
  });

  it('rejects non-integers', () => {
    expect(() => fromMinor(114.42, 'USD')).toThrow();
    expect(() => fromMinor(Number.NaN, 'USD')).toThrow();
  });
});
