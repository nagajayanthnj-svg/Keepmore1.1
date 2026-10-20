import { getCheckoutDeps, misconfigured } from '../../../lib/server-deps';
import { handleCreate } from '../../../orders/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const deps = getCheckoutDeps();
  return deps ? handleCreate(req, deps) : misconfigured();
}
