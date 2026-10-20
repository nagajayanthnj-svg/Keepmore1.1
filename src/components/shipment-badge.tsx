// Whether the seller's tracking reached PayPal. This is a status chip, not a truth-state label.
// It differs in border style as well as colour and wording, so colour is never the only signal.
export function ShipmentBadge({ pushStatus }: { pushStatus: string }) {
  const pushed = pushStatus === 'PUSHED';
  return (
    <span
      data-shipment-status={pushed ? 'PUSHED' : 'LOCAL_ONLY'}
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
        pushed
          ? 'border-2 border-solid border-emerald-700 bg-emerald-50 text-emerald-900'
          : 'border-2 border-dashed border-amber-700 bg-amber-50 text-amber-900'
      }`}
    >
      {pushed ? 'Tracking sent to PayPal' : 'Local tracking only'}
    </span>
  );
}
