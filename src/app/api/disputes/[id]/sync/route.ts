import { handleManualSync } from '../../../../../disputes/manual-sync';
import { getSyncDeps, guard } from '../../../../../lib/server-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard('sync dispute', async () => handleManualSync(getSyncDeps(), (await ctx.params).id));
}
