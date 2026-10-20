// The seven truth-state labels (CLAUDE.md). Every number or fact shown to the seller carries exactly one.
// If none fits, it is Unknown. Do not add a label here without changing CLAUDE.md first.
export const TRUTH_STATES = [
  'Verified by PayPal',
  'Calculated',
  'Seller entered',
  'Estimated',
  'Illustrative',
  'Unknown',
  'Simulated demo',
] as const;

export type TruthState = (typeof TRUTH_STATES)[number];

/** One line each, for the legend on the Overview screen. */
export const TRUTH_STATE_MEANING: Record<TruthState, string> = {
  'Verified by PayPal': 'Read from a PayPal response. We never recalculate it.',
  Calculated: 'Worked out by KeepMore from verified or entered numbers.',
  'Seller entered': 'Typed in by the seller. Not checked against PayPal.',
  Estimated: 'Our estimate from an assumption, such as a reference exchange rate.',
  Illustrative: 'An example or what-if value, not tied to a real order.',
  Unknown: 'No source for this yet. Nothing is guessed.',
  'Simulated demo': 'Seeded or simulated for the demo. Not real sales.',
};

const BY_SOURCE: Record<string, TruthState> = {
  PAYPAL_VERIFIED: 'Verified by PayPal',
  REFERENCE_RATE_ESTIMATE: 'Estimated',
  SELLER_ENTERED: 'Seller entered',
  DEMO_SEEDED: 'Simulated demo',
  HYPOTHETICAL_SCENARIO: 'Illustrative',
};

/** Ledger `sourceType` to label. Anything unrecognised is Unknown. */
export function truthStateForSource(sourceType: string | undefined): TruthState {
  return (sourceType && BY_SOURCE[sourceType]) || 'Unknown';
}

export const asTruthState = (value: string): TruthState =>
  (TRUTH_STATES as readonly string[]).includes(value) ? (value as TruthState) : 'Unknown';
