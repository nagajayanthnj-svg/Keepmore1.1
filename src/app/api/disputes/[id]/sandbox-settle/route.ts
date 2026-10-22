import { handleSettleApprove } from '../../../../../disputes/http-handlers';
import { getSettleDeps, guard, jsonBody } from '../../../../../lib/server-deps';
import { rejectCrossOrigin } from '../../../../../lib/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SANDBOX ONLY (T-402): approve a "Sandbox-simulated adjudication". 404 unless DEMO_MODE=true.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(
    'approve sandbox settle',
    async () => rejectCrossOrigin(req) ?? handleSettleApprove(getSettleDeps(), (await ctx.params).id, await jsonBody(req)),
  );
}
