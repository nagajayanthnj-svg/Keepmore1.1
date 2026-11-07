import { describe, expect, it } from 'vitest';
import { DisputeParseError } from '../../src/disputes/parse';
import { pollErrorCode } from '../../src/disputes/poller';

const DP = Symbol.for('keepmore.error.DisputeParseError');

// SYNTHETIC: what a second copy of parse.ts defines (same global brand, different class identity).
class DisputeParseErrorCopy extends Error {
  readonly [DP] = true;
}

describe('pollErrorCode', () => {
  it('names an unusable dispute, from this copy of the class or another', () => {
    expect(pollErrorCode(new DisputeParseError('x'))).toBe('UNUSABLE_DISPUTE');
    expect(pollErrorCode(new DisputeParseErrorCopy('x'))).toBe('UNUSABLE_DISPUTE');
  });
  it('falls back to the error name, then ERROR', () => {
    expect(pollErrorCode(new TypeError('x'))).toBe('TypeError');
    expect(pollErrorCode('x')).toBe('ERROR');
  });
});
