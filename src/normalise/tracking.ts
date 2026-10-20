export const CARRIERS = ['INDIA_POST', 'DHL', 'FEDEX', 'DEMO', 'OTHER'] as const;
export type Carrier = (typeof CARRIERS)[number];

/** Uppercase, strip whitespace and hyphens (any dash, e.g. en dash or minus sign from pasted text). Anything else is kept: it does not guess. */
export function normaliseTracking(raw: string): string {
  return raw.toUpperCase().replace(/[\s\-‐-―−]+/g, '');
}

// ASSUMED spellings: not checked against PayPal's carrier enum yet. Extend from real data.
const ALIASES: Record<string, Carrier> = {
  INDIAPOST: 'INDIA_POST',
  SPEEDPOST: 'INDIA_POST',
  INPOST: 'INDIA_POST',
  DHL: 'DHL',
  DHLEXPRESS: 'DHL',
  DHLAPI: 'DHL',
  FEDEX: 'FEDEX',
  DEMO: 'DEMO',
};

/** "India Post" -> INDIA_POST. Unmapped carriers become OTHER, which has no status table. */
export function normaliseCarrier(raw: string): Carrier {
  return ALIASES[raw.toUpperCase().replace(/[^A-Z]/g, '')] ?? 'OTHER';
}
