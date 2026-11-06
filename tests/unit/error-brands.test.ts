// Errors from another module copy (a bundler can load a module twice): a different class, same shape, same global brand.
// All SYNTHETIC. `instanceof` against the class imported here fails for these; the is* helpers must still say yes.
import { describe, expect, it } from 'vitest';
import { DisputeParseError, isDisputeParseError } from '../../src/disputes/parse';
import { CaptureBreakdownError, isCaptureBreakdownError } from '../../src/ledger/entries';
import {
  isPayPalChangeNotSeenError,
  isPayPalError,
  PayPalChangeNotSeenError,
  PayPalError,
} from '../../src/paypal/client';

const PE = Symbol.for('keepmore.error.PayPalError');
const NS = Symbol.for('keepmore.error.PayPalChangeNotSeenError');
const DP = Symbol.for('keepmore.error.DisputeParseError');
const CB = Symbol.for('keepmore.error.CaptureBreakdownError');
class PayPalErrorB extends Error {
  readonly [PE] = true;
  status = 400;
  issues: string[] = [];
  fields: string[] = [];
}
class NotSeenB extends Error {
  readonly [NS] = true;
}
class ParseB extends Error {
  readonly [DP] = true;
}
class BreakdownB extends Error {
  readonly [CB] = true;
}

describe('error recognition across module copies', () => {
  it('recognises a second copy of each class', () => {
    expect(isPayPalError(new PayPalErrorB('x'))).toBe(true);
    expect(isPayPalChangeNotSeenError(new NotSeenB('x'))).toBe(true);
    expect(isDisputeParseError(new ParseB('x'))).toBe(true);
    expect(isCaptureBreakdownError(new BreakdownB('x'))).toBe(true);
  });
  it('still recognises the real classes', () => {
    expect(isPayPalError(new PayPalError({ status: 500, message: 'x' }))).toBe(true);
    expect(isPayPalChangeNotSeenError(new PayPalChangeNotSeenError(3))).toBe(true);
    expect(isDisputeParseError(new DisputeParseError('x'))).toBe(true);
    expect(isCaptureBreakdownError(new CaptureBreakdownError('x'))).toBe(true);
  });
  it('does not match other errors, look-alike names without the brand, or non-errors', () => {
    const named = Object.assign(new Error('x'), { name: 'PayPalError', status: 400, issues: [], fields: [] });
    for (const v of [new Error('x'), named, { status: 400, issues: [], fields: [] }, null, undefined, 'x']) {
      expect(isPayPalError(v)).toBe(false);
      expect(isDisputeParseError(v)).toBe(false);
    }
    expect(isPayPalError(new ParseB('x'))).toBe(false);
    expect(isDisputeParseError(new PayPalErrorB('x'))).toBe(false);
  });
});
