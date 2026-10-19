import type { Carrier } from './tracking';

export const CANONICAL_STATUSES = [
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERED_TO_NEIGHBOUR',
  'HELD_AT_CUSTOMS',
  'RETURNED',
  'EXCEPTION',
  'UNKNOWN',
] as const;
export type CanonicalStatus = (typeof CANONICAL_STATUSES)[number];

type Table = ReadonlyArray<readonly [RegExp, CanonicalStatus]>;

// Each pattern is anchored on the whole normalised text (lower case, single spaces, no trailing
// punctuation), so "not delivered" can never match "delivered". Order matters: first match wins.
// ASSUMED: these are representative phrases written from the carriers' public wording, not a
// captured feed. Add real strings as they turn up; anything unlisted is UNKNOWN, by design.
const INDIA_POST: Table = [
  [/^item delivered to neighbou?r$/, 'DELIVERED_TO_NEIGHBOUR'],
  [/^item delivered$/, 'DELIVERED'],
  [/^item out for delivery$/, 'OUT_FOR_DELIVERY'],
  [/^item (held|detained) at customs$/, 'HELD_AT_CUSTOMS'],
  [/^item returned to sender$/, 'RETURNED'],
  [/^item (undelivered|delivery attempted.*)$/, 'EXCEPTION'],
  [/^item (booked|bagged|dispatched|despatched|received at .+|arrived at .+|in transit)$/, 'IN_TRANSIT'],
];

const DHL: Table = [
  [/^delivered - signed for by.*$/, 'DELIVERED'],
  [/^delivered$/, 'DELIVERED'],
  [/^with delivery courier$/, 'OUT_FOR_DELIVERY'],
  [/^shipment on hold at customs$/, 'HELD_AT_CUSTOMS'],
  [/^(shipment|clearance) (delayed|exception).*$/, 'EXCEPTION'],
  [/^returned to shipper$/, 'RETURNED'],
  [/^(shipment picked up|processed at .+|departed facility.*|arrived at .+|in transit)$/, 'IN_TRANSIT'],
];

const FEDEX: Table = [
  [/^delivered$/, 'DELIVERED'],
  [/^(on fedex vehicle for delivery|out for delivery)$/, 'OUT_FOR_DELIVERY'],
  [/^(held at customs|clearance delay)$/, 'HELD_AT_CUSTOMS'],
  [/^(delivery|shipment) exception$/, 'EXCEPTION'],
  [/^returning package to shipper$/, 'RETURNED'],
  [/^(picked up|in transit|departed fedex location|arrived at fedex location)$/, 'IN_TRANSIT'],
];

// The demo carrier is ours: its phrases are the canonical names in plain words.
const DEMO: Table = [
  [/^delivered to neighbou?r$/, 'DELIVERED_TO_NEIGHBOUR'],
  [/^delivered$/, 'DELIVERED'],
  [/^out for delivery$/, 'OUT_FOR_DELIVERY'],
  [/^held at customs$/, 'HELD_AT_CUSTOMS'],
  [/^returned to sender$/, 'RETURNED'],
  [/^exception$/, 'EXCEPTION'],
  [/^in transit$/, 'IN_TRANSIT'],
];

const TABLES: Record<Carrier, Table> = {
  INDIA_POST,
  DHL,
  FEDEX,
  DEMO,
  OTHER: [],
};

const clean = (raw: string) =>
  raw
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!\s]+$/, '')
    .trim();

/** Raw carrier text to a canonical status. Unmapped text is UNKNOWN, never a guess. */
export function normaliseStatus(carrier: Carrier, rawText: string): CanonicalStatus {
  const text = clean(rawText);
  if (!text) return 'UNKNOWN';
  return TABLES[carrier].find(([pattern]) => pattern.test(text))?.[1] ?? 'UNKNOWN';
}
