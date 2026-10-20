// Whether a dispute was read from PayPal recently (T-205: stale from 5 minutes). Not a truth-state label.
// It differs in border style as well as wording, so colour is never the only signal.
export function StaleBadge({ state }: { state: string }) {
  const fresh = state === 'Fresh';
  return (
    <span
      data-sync-state={fresh ? 'FRESH' : 'STALE'}
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
        fresh
          ? 'border-2 border-solid border-emerald-700 bg-emerald-50 text-emerald-900'
          : 'border-2 border-dashed border-amber-700 bg-amber-50 text-amber-900'
      }`}
    >
      {fresh ? 'Fresh' : 'Stale'}
    </span>
  );
}
