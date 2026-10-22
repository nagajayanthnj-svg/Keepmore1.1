import { handleApprove } from '../../../../../disputes/http-handlers';
import { getActionDeps, guard, jsonBody } from '../../../../../lib/server-deps';
import { rejectCrossOrigin } from '../../../../../lib/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(
    'approve dispute action',
    async () => rejectCrossOrigin(req) ?? handleApprove(getActionDeps(), (await ctx.params).id, await jsonBody(req)),
  );
}
