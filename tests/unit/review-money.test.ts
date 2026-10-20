import { describe, expect, it } from 'vitest';
import { fromMinor, toMinor } from '../../src/normalise/money';

// Independent review of T-104: inputs chosen to break toMinor / fromMinor.

// Seeded PRNG (mulberry32) so a failure always reproduces with the same numbers.
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 1000 safe integers spread over every magnitude, both signs, with 0 and the extremes. */
function randomIntegers(seed: number): number[] {
  const rand = prng(seed);
  const out = [0, 1, -1, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER];
  while (out.length < 1000) {
    const digits = 1 + Math.floor(rand() * 16);
    const n = Math.min(Math.floor(rand() * 10 ** digits), Number.MAX_SAFE_INTEGER);
    out.push(rand() < 0.5 && n !== 0 ? -n : n); // -0 is not a money value; see the negative zero tests
  }
  return out;
}

describe('review: round trip fromMinor -> toMinor', () => {
  it.each([
    ['JPY', 0],
    ['USD', 2],
    ['KWD', 3],
  ] as const)('%s (exponent %i) over 1000 random integers', (currency, exp) => {
    for (const n of randomIntegers(exp + 1)) {
      const text = fromMinor(n, currency);
      expect(text).toMatch(exp === 0 ? /^-?\d+$/ : new RegExp(`^-?\\d+\\.\\d{${exp}}$`));
      expect(toMinor(text, currency)).toBe(n);
    }
  });
});

describe('review: values near Number.MAX_SAFE_INTEGER', () => {
  it('accepts the largest safe amount in each exponent', () => {
    expect(toMinor('9007199254740991', 'JPY')).toBe(Number.MAX_SAFE_INTEGER);
    expect(toMinor('90071992547409.91', 'USD')).toBe(Number.MAX_SAFE_INTEGER);
    expect(toMinor('9007199254740.991', 'KWD')).toBe(Number.MAX_SAFE_INTEGER);
    expect(toMinor('-90071992547409.91', 'USD')).toBe(-Number.MAX_SAFE_INTEGER);
  });

  it('rejects one minor unit past it, and values that would silently round', () => {
    expect(() => toMinor('9007199254740992', 'JPY')).toThrow(RangeError);
    expect(() => toMinor('9007199254740993', 'JPY')).toThrow(RangeError); // Number() rounds this to ...992
    expect(() => toMinor('90071992547409.92', 'USD')).toThrow(RangeError);
    expect(() => toMinor('9007199254740.992', 'KWD')).toThrow(RangeError);
    expect(() => toMinor('-90071992547409.92', 'USD')).toThrow(RangeError);
    expect(() => toMinor('99999999999999999999.99', 'USD')).toThrow(RangeError);
  });

  it('fromMinor formats the extremes and refuses anything unsafe', () => {
    expect(fromMinor(Number.MAX_SAFE_INTEGER, 'USD')).toBe('90071992547409.91');
    expect(fromMinor(-Number.MAX_SAFE_INTEGER, 'KWD')).toBe('-9007199254740.991');
    expect(() => fromMinor(Number.MAX_SAFE_INTEGER + 1, 'USD')).toThrow(TypeError);
    expect(() => fromMinor(0.5, 'USD')).toThrow(TypeError);
    expect(() => fromMinor(Number.NaN, 'USD')).toThrow(TypeError);
  });
});

describe('review: negative zero', () => {
  // -0 === 0, but Intl.NumberFormat prints -0 as "-$0.00", and Object.is(-0, 0) is false.
  it('"-0.00" and "-0" are plain zero, never -0', () => {
    expect(toMinor('-0.00', 'USD')).toBe(0);
    expect(toMinor('-0', 'JPY')).toBe(0);
    expect(toMinor('-0.000', 'KWD')).toBe(0);
  });

  it('fromMinor(-0) has no minus sign', () => {
    expect(fromMinor(-0, 'USD')).toBe('0.00');
  });
});

describe('review: leading zeros', () => {
  it('are accepted and ignored', () => {
    expect(toMinor('007.50', 'USD')).toBe(750);
    expect(toMinor('000', 'JPY')).toBe(0);
    expect(toMinor('-007.50', 'USD')).toBe(-750);
    expect(toMinor('0000.001', 'KWD')).toBe(1);
  });
});

describe('review: whitespace and look-alike characters', () => {
  it.each([
    ' 12.50',
    '12.50 ',
    '12 .50',
    '12. 50',
    '1 000.00',
    '12.\t50',
    '12.50\n',
    '- 12.50',
    '1 000.00', // non-breaking space
    '1 000.00', // narrow no-break space, used by some locales as a group separator
    '−12.50', // minus sign, not hyphen-minus
    '１２.50', // full-width digits
    '+12.50',
  ])('rejects %j', (value) => {
    expect(() => toMinor(value, 'USD')).toThrow(TypeError);
  });
});
