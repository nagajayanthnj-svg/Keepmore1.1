import { describe, expect, it } from 'vitest';
import { chooseRate, estimateFx, fxEstimateEntry } from '../../src/ledger/fx';

describe('estimateFx', () => {
  it('net 11442 USD cents × 84 × 3% = 28834 paise (the plan example)', () => {
    expect(estimateFx(11442, '84', '0.03')).toBe(28834);
  });
  it('uses the rate digits exactly, with no float drift', () => {
    expect(estimateFx(11442, '83.9512', '0.03')).toBe(28817);
    expect(estimateFx(4734, '84.1234', '0.025')).toBe(9956);
  });
  it('rounds half up, once, at the end', () => {
    expect(estimateFx(50, '1', '0.01')).toBe(1); // 0.5
    expect(estimateFx(49, '1', '0.01')).toBe(0); // 0.49
    expect(estimateFx(150, '1', '0.01')).toBe(2); // 1.5
    expect(estimateFx(1, '0.5', '1')).toBe(1); // 0.5
  });
  it('handles zero net and a zero spread', () => {
    expect(estimateFx(0, '84', '0.03')).toBe(0);
    expect(estimateFx(11442, '84', '0')).toBe(0);
  });
  it('rejects values it cannot trust', () => {
    expect(() => estimateFx(-1, '84', '0.03')).toThrow();
    expect(() => estimateFx(10.5, '84', '0.03')).toThrow();
    expect(() => estimateFx(Number.NaN, '84', '0.03')).toThrow();
    expect(() => estimateFx(100, 'abc', '0.03')).toThrow();
    expect(() => estimateFx(100, '-84', '0.03')).toThrow();
    expect(() => estimateFx(100, '0', '0.03')).toThrow();
    expect(() => estimateFx(100, '84', '1.5')).toThrow();
    expect(() => estimateFx(100, '84', '-0.01')).toThrow();
    expect(() => estimateFx(100, '84.', '0.03')).toThrow();
    expect(() => estimateFx(100, '1e2', '0.03')).toThrow();
  });
});

describe('chooseRate', () => {
  const fbil = { rate: '84.0000', date: new Date('2026-10-19T00:00:00Z') };
  it('uses the FBIL reference rate when PayPal gave none', () => {
    expect(chooseRate({ fbil })).toEqual({ rate: '84.0000', origin: 'FBIL', rateDate: fbil.date });
  });
  it('lets a PayPal exchange_rate override the FBIL rate', () => {
    expect(chooseRate({ fbil, paypal: { value: '83.5100' } })).toEqual({
      rate: '83.5100',
      origin: 'PAYPAL',
      rateDate: undefined,
    });
  });
  it('returns undefined when there is no rate at all, so the caller shows Unknown', () => {
    expect(chooseRate({})).toBeUndefined();
  });
});

describe('fxEstimateEntry', () => {
  const base = {
    orderId: 'o1',
    netMinorUsd: 11442,
    spread: '0.03',
    occurredAt: new Date('2026-10-19T14:49:25Z'),
    calcVersion: 'fx-v1',
  };
  it('builds an FX entry in paise, labelled as a reference-rate estimate, with the rate and its date', () => {
    const e = fxEstimateEntry({ ...base, fbil: { rate: '84', date: new Date('2026-10-19T00:00:00Z') } });
    expect(e).toMatchObject({
      orderId: 'o1',
      type: 'FX',
      amountMinor: 28834,
      currency: 'INR',
      inrMinor: 28834,
      sourceType: 'REFERENCE_RATE_ESTIMATE',
      rate: '84',
      calcVersion: 'fx-v1',
    });
    expect(e!.rateDate).toEqual(new Date('2026-10-19T00:00:00Z'));
  });
  it('still labels the entry an estimate when a PayPal rate overrides the rate, and says so in sourceRef', () => {
    const e = fxEstimateEntry({ ...base, paypal: { value: '83.5' } });
    expect(e).toMatchObject({
      sourceType: 'REFERENCE_RATE_ESTIMATE',
      sourceRef: 'PAYPAL_EXCHANGE_RATE',
      rate: '83.5',
      amountMinor: estimateFx(11442, '83.5', '0.03'),
    });
  });
  it('writes nothing when no rate is known', () => {
    expect(fxEstimateEntry(base)).toBeUndefined();
  });
});
