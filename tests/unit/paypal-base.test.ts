import { describe, expect, it } from 'vitest';
import { paypalBaseUrl, SANDBOX_API } from '../../src/lib/server-deps';

describe('paypalBaseUrl', () => {
  it('defaults to the sandbox API when unset or empty', () => {
    expect(paypalBaseUrl(undefined)).toBe(SANDBOX_API);
    expect(paypalBaseUrl('')).toBe(SANDBOX_API);
    expect(paypalBaseUrl('   ')).toBe(SANDBOX_API);
  });
  it('accepts the sandbox API, with a trailing slash or spaces', () => {
    expect(SANDBOX_API).toBe('https://api-m.sandbox.paypal.com');
    expect(paypalBaseUrl('https://api-m.sandbox.paypal.com')).toBe(SANDBOX_API);
    expect(paypalBaseUrl(' https://api-m.sandbox.paypal.com/ ')).toBe(SANDBOX_API);
  });
  it.each([
    'https://sandbox.paypal.com',
    'https://www.sandbox.paypal.com',
    'https://api-m.paypal.com', // live
    'https://api.paypal.com', // live
    'http://api-m.sandbox.paypal.com',
    'https://api-m.sandbox.paypal.com.evil.test',
    'api-m.sandbox.paypal.com',
  ])('refuses %s and says what is allowed', (bad) => {
    expect(() => paypalBaseUrl(bad)).toThrow(/PAYPAL_API_BASE.*https:\/\/api-m\.sandbox\.paypal\.com/);
  });
});
