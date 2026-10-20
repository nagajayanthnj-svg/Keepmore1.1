// Money is integer minor units plus an ISO 4217 code. Decimal strings in, never floats.

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

function exponent(currency: string): number {
  // ICU knows the ISO 4217 exponent (USD 2, JPY 0, KWD 3). An unknown code throws RangeError.
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits as number;
}

/** "114.42", "USD" -> 11442. Rejects floats, extra decimals (no rounding) and unsafe sizes. */
export function toMinor(value: string, currency: string): number {
  const m = typeof value === 'string' ? DECIMAL.exec(value) : null;
  if (!m) throw new TypeError(`toMinor needs a plain decimal string, got ${JSON.stringify(value)}`);
  const exp = exponent(currency);
  const [, sign, whole, frac = ''] = m as unknown as [string, string, string, string?];
  const extra = frac.slice(exp);
  if (/[^0]/.test(extra)) throw new RangeError(`${value} has more than ${exp} decimals for ${currency}`);
  const minor = Number(whole + frac.slice(0, exp).padEnd(exp, '0'));
  if (!Number.isSafeInteger(minor)) throw new RangeError(`${value} is too large`);
  return sign && minor !== 0 ? -minor : minor; // "-0.00" is 0, never -0
}

/** 11442, "USD" -> "114.42". */
export function fromMinor(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor)) throw new TypeError(`fromMinor needs an integer, got ${minor}`);
  const exp = exponent(currency);
  const digits = Math.abs(minor)
    .toString()
    .padStart(exp + 1, '0');
  const body = exp === 0 ? digits : `${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
  return minor < 0 ? `-${body}` : body;
}
