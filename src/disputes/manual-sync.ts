// The sync button (T-205): one fresh read of one dispute, now. Reads only; never writes to PayPal.
import { PayPalError } from '../paypal/client';
import { DISPUTE_ID, DisputeParseError } from './parse';
import { syncDispute, type SyncDeps } from './sync';

export async function handleManualSync(deps: SyncDeps | null, disputeId: string): Promise<Response> {
  if (!DISPUTE_ID.test(disputeId)) return Response.json({ error: 'BAD_DISPUTE_ID' }, { status: 400 });
  if (disputeId.startsWith('PP-DEMO-')) return Response.json({ error: 'DEMO_CASE' }, { status: 409 });
  if (!deps) return Response.json({ error: 'SERVER_MISCONFIGURED' }, { status: 500 });
  try {
    const r = await syncDispute(deps, disputeId);
    return Response.json({ disputeId: r.disputeId, created: r.created, changed: r.changed });
  } catch (e) {
    if (e instanceof DisputeParseError) return Response.json({ error: 'UNUSABLE_DISPUTE' }, { status: 502 });
    if (e instanceof PayPalError) return Response.json({ error: 'PAYPAL_UNAVAILABLE' }, { status: 502 });
    throw e;
  }
}
