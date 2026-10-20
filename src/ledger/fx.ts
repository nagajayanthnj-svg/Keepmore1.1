// FX estimate (T-109). Integer maths on decimal strings: no float touches money.
// The result is the estimated cost of converting the net USD amount to rupees at a given spread,
// always labelled REFERENCE_RATE_ESTIMATE ("Estimated"): the rate is an assumption, not PayPal's.
import type { LedgerEntryInput } from './store';

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

function parseDecimal(text: string, what: string): { int: bigint; scale: number } {
  const m = DECIMAL.exec(text);
  if (!m) throw new Error(`${what} must be a plain decimal string, got "${text}"`);
  const frac = m[2] ?? '';
  return { int: BigInt(m[1]! + frac), scale: frac.length };
}

/** `fx = net_USD × rate × spread`, rounded half up to paise once, at the end. */
export function estimateFx(netMinorUsd: number, rate: string, spread: string): number {
  if (!Number.isSafeInteger(netMinorUsd) || netMinorUsd < 0)
    throw new Error('netMinorUsd must be a non-negative integer');
  const r = parseDecimal(rate, 'rate');
  const s = parseDecimal(spread, 'spread');
  if (r.int === 0n) throw new Error('rate must be above zero');
  if (s.int > 10n ** BigInt(s.scale)) throw new Error('spread must be between 0 and 1');
  // cents × (rupees per dollar) is paise, so no unit factor is needed.
  const numerator = BigInt(netMinorUsd) * r.int * s.int;
  const divisor = 10n ** BigInt(r.scale + s.scale);
  return Number((numerator * 2n + divisor) / (2n * divisor));
}

export interface FbilRate {
  rate: string;
  date: Date;
}

export interface ChosenRate {
  rate: string;
  origin: 'FBIL' | 'PAYPAL';
  rateDate: Date | undefined;
}

/** A rate PayPal returned (`exchange_rate.value`) overrides the FBIL reference rate. No rate at all gives undefined. */
export function chooseRate(input: { fbil?: FbilRate; paypal?: { value: string } }): ChosenRate | undefined {
  if (input.paypal) return { rate: input.paypal.value, origin: 'PAYPAL', rateDate: undefined };
  if (input.fbil) return { rate: input.fbil.rate, origin: 'FBIL', rateDate: input.fbil.date };
  return undefined;
}

/**
 * The FX ledger entry for one order, in paise. Undefined when no rate is known: the caller shows Unknown.
 * Even with a PayPal rate the entry stays an estimate: the rate is PayPal's, the spread is ours.
 */
export function fxEstimateEntry(input: {
  orderId: string;
  netMinorUsd: number;
  spread: string;
  occurredAt: Date;
  calcVersion: string;
  fbil?: FbilRate;
  paypal?: { value: string };
}): LedgerEntryInput | undefined {
  const chosen = chooseRate({ fbil: input.fbil, paypal: input.paypal });
  if (!chosen) return undefined;
  const paise = estimateFx(input.netMinorUsd, chosen.rate, input.spread);
  return {
    orderId: input.orderId,
    type: 'FX',
    amountMinor: paise,
    currency: 'INR',
    inrMinor: paise,
    sourceType: 'REFERENCE_RATE_ESTIMATE',
    sourceRef: chosen.origin === 'PAYPAL' ? 'PAYPAL_EXCHANGE_RATE' : undefined,
    rate: chosen.rate,
    rateDate: chosen.rateDate,
    calcVersion: input.calcVersion,
    occurredAt: input.occurredAt,
  };
}
