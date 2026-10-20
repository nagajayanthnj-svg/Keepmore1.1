import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buyerHash } from '../../src/orders/buyer-hash';

const secret = 'k'.repeat(32);

describe('buyerHash', () => {
  it('is HMAC-SHA256 of the payer id, as hex', () => {
    expect(buyerHash(secret, 'PAYER123')).toBe(createHmac('sha256', secret).update('PAYER123').digest('hex'));
    expect(buyerHash(secret, 'PAYER123')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('is stable for one payer and differs between payers and between secrets', () => {
    expect(buyerHash(secret, 'A')).toBe(buyerHash(secret, 'A'));
    expect(buyerHash(secret, 'A')).not.toBe(buyerHash(secret, 'B'));
    expect(buyerHash(secret, 'A')).not.toBe(buyerHash('j'.repeat(32), 'A'));
  });
  it('does not contain the payer id', () => {
    expect(buyerHash(secret, 'PAYER123')).not.toContain('PAYER123');
  });
  it('refuses a short or missing secret, and an empty payer id', () => {
    expect(() => buyerHash('short', 'A')).toThrow(/HMAC_SECRET/);
    expect(() => buyerHash(undefined, 'A')).toThrow(/HMAC_SECRET/);
    expect(() => buyerHash(secret, '')).toThrow();
  });
});
