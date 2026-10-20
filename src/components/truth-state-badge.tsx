import { asTruthState, type TruthState } from '../lib/truth-state';

// Each state differs in border style as well as colour, so colour is never the only signal.
const LOOK: Record<TruthState, string> = {
  'Verified by PayPal': 'border-2 border-solid border-emerald-700 bg-emerald-50 text-emerald-900',
  Calculated: 'border border-solid border-sky-700 bg-sky-50 text-sky-900',
  'Seller entered': 'border border-double border-indigo-700 bg-indigo-50 text-indigo-900',
  Estimated: 'border border-dashed border-amber-700 bg-amber-50 text-amber-900',
  Illustrative: 'border border-dotted border-fuchsia-700 bg-fuchsia-50 text-fuchsia-900',
  Unknown: 'border-2 border-dashed border-neutral-600 bg-neutral-100 text-neutral-800',
  'Simulated demo': 'border-2 border-dotted border-orange-700 bg-orange-50 text-orange-900',
};

export function TruthStateBadge({ state }: { state: TruthState }) {
  const s = asTruthState(state);
  return (
    <span data-truth-state={s} className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${LOOK[s]}`}>
      {s}
    </span>
  );
}
