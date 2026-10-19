// Time is full UTC ISO-8601. Local dates exist only to compare date claims in the carrier's zone.

const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

/** The calendar date ("YYYY-MM-DD") of a UTC instant in the carrier's time zone. */
export function carrierLocalDate(utc: Date | string, carrierTz: string): string {
  if (typeof utc === 'string' && !(utc.includes('T') && HAS_OFFSET.test(utc))) {
    throw new TypeError(`expected a full ISO-8601 timestamp with an offset, got ${JSON.stringify(utc)}`);
  }
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) throw new TypeError(`invalid date ${JSON.stringify(utc)}`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: carrierTz, // an unknown zone throws RangeError
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
