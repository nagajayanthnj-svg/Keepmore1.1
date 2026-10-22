import { handleSettleSubmit } from '../../../../../disputes/http-handlers';
import { getSettleDeps, guard } from '../../../../../lib/server-deps';
import { rejectCrossOrigin } from '../../../../../lib/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SANDBOX ONLY (T-402): send an approved "Sandbox-simulated adjudication" through the action service. 404 unless DEMO_MODE=true.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard('submit sandbox settle', async () => rejectCrossOrigin(req) ?? handleSettleSubmit(getSettleDeps(), (await ctx.params).id));
}
