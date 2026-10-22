import { handleSubmit } from '../../../../../disputes/http-handlers';
import { getActionDeps, guard } from '../../../../../lib/server-deps';
import { rejectCrossOrigin } from '../../../../../lib/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The only HTTP path to a PayPal dispute write. It goes through the action service (src/disputes/actions.ts).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard('submit approved action', async () => rejectCrossOrigin(req) ?? handleSubmit(getActionDeps(), (await ctx.params).id));
}
