import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CaptureBreakdownError, captureFromOrder, entriesFromCapture } from '../../src/ledger/entries';

type Money = { currency_code: string; value: unknown };
type Capture = Record<string, unknown> & { seller_receivable_breakdown: Record<string, unknown> };
const load = (name: string) => JSON.parse(readFileSync(`tests/fixtures/paypal/${name}.json`, 'utf8'));
const capture = (name: string) => captureFromOrder(load(name));

describe('entriesFromCapture on the real sandbox captures', () => {
  it.each([
    ['capture-usd-primary', '0HE26749YS519313U', 12000, 588, '2026-10-19T14:49:25.000Z'],
    ['capture-usd-primary-50', '3FG688039F4865201', 5000, 266, '2026-10-19T14:51:53.000Z'],
    ['capture-physical-30', '1YP10400KC305794V', 3000, 173, '2026-10-19T16:38:43.000Z'],
    ['capture-webhook-test', '9UF03893Y1045740S', 2500, 151, '2026-10-19T15:30:14.000Z'],
  ])('%s gives GROSS and PAYPAL_FEE straight from the breakdown', (file, id, gross, fee, at) => {
    const entries = entriesFromCapture(capture(file), { orderId: 'o1', calcVersion: 'ledger-v1' });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      orderId: 'o1',
      type: 'GROSS',
      amountMinor: gross,
      currency: 'USD',
      sourceType: 'PAYPAL_VERIFIED',
      sourceRef: id,
      calcVersion: 'ledger-v1',
    });
    expect(entries[1]).toMatchObject({
      type: 'PAYPAL_FEE',
      amountMinor: fee,
      currency: 'USD',
      sourceType: 'PAYPAL_VERIFIED',
      sourceRef: id,
    });
    expect(entries[0]!.occurredAt.toISOString()).toBe(at);
    expect(entries[1]!.occurredAt.toISOString()).toBe(at);
  });

  it('never recalculates: the fee is what PayPal returned, not a percentage of gross', () => {
    // 5.88 on 120.00 is not 4.6% + 0.36 (= 5.88) by luck on every capture; 1.51 on 25.00 is not.
    const entries = entriesFromCapture(capture('capture-webhook-test'), { orderId: 'o', calcVersion: 'v' });
    expect(entries.find((e) => e.type === 'PAYPAL_FEE')!.amountMinor).toBe(151);
  });

  it('carries no INR amount and no rate: nothing here is converted', () => {
    const entries = entriesFromCapture(capture('capture-usd-primary'), { orderId: 'o', calcVersion: 'v' });
    for (const e of entries) {
      expect(e.inrMinor).toBeUndefined();
      expect(e.rate).toBeUndefined();
    }
  });
});

describe('refusing to guess', () => {
  const withBreakdown = (patch: (b: Record<string, unknown>) => void) => {
    const c = structuredClone(capture('capture-usd-primary')) as Capture;
    patch(c.seller_receivable_breakdown);
    return c;
  };
  const run = (c: unknown) => entriesFromCapture(c as never, { orderId: 'o', calcVersion: 'v' });

  it('throws when seller_receivable_breakdown is missing', () => {
    const c = structuredClone(capture('capture-usd-primary')) as Record<string, unknown>;
    delete c.seller_receivable_breakdown;
    expect(() => run(c)).toThrow(CaptureBreakdownError);
  });
  it('throws when the fee is missing rather than writing a zero fee', () => {
    expect(() => run(withBreakdown((b) => delete b.paypal_fee))).toThrow(CaptureBreakdownError);
  });
  it('throws when gross and fee are in different currencies', () => {
    expect(() => run(withBreakdown((b) => ((b.paypal_fee as Money).currency_code = 'EUR')))).toThrow(
      CaptureBreakdownError,
    );
  });
  it('throws on an amount that is not a plain decimal string', () => {
    expect(() => run(withBreakdown((b) => ((b.paypal_fee as Money).value = 5.88)))).toThrow();
    expect(() => run(withBreakdown((b) => ((b.paypal_fee as Money).value = '-5.88')))).toThrow();
  });
  it('throws when the capture is not COMPLETED', () => {
    const c = structuredClone(capture('capture-usd-primary')) as Record<string, unknown>;
    c.status = 'PENDING';
    expect(() => run(c)).toThrow(CaptureBreakdownError);
  });
});

describe('captureFromOrder', () => {
  it('takes the first capture of the first purchase unit', () => {
    expect(capture('capture-usd-primary').id).toBe('0HE26749YS519313U');
  });
  it('throws when the order response holds no capture', () => {
    expect(() => captureFromOrder(load('order-created-usd-primary'))).toThrow(CaptureBreakdownError);
  });
});
