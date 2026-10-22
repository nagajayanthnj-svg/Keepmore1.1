import { handleAnalyse } from '../../../../../ai/analyse-route';
import { getAnalyseDeps, guard } from '../../../../../lib/server-deps';
import { rejectCrossOrigin } from '../../../../../lib/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard('analyse dispute', async () => rejectCrossOrigin(req) ?? handleAnalyse(getAnalyseDeps(), (await ctx.params).id));
}
