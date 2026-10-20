import { getCheckoutDeps, misconfigured } from '../../../../../lib/server-deps';
import { handleCapture } from '../../../../../orders/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const deps = getCheckoutDeps();
  if (!deps) return misconfigured();
  return handleCapture((await ctx.params).id, deps);
}
