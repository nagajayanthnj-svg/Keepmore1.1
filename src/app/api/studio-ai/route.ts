import { handleStudioAi } from '../../../ai/studio-ai-route';
import { getStudioAiDeps, guard, jsonBody } from '../../../lib/server-deps';
import { rejectCrossOrigin } from '../../../lib/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// AG Studio's AI assistant posts here (T-405). Demo data only; the model key stays on the server.
export async function POST(req: Request) {
  return guard('studio ai', async () => rejectCrossOrigin(req) ?? handleStudioAi(getStudioAiDeps(), await jsonBody(req)));
}
