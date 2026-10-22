// What the server sees for the AI assistant and AG Studio. Prints names and yes/no only, never a key.
//   npx tsx --env-file=.env scripts/check-ai-setup.ts
import { getDb, getStudioAi } from '../src/lib/server-deps';
import { providerFromEnv } from '../src/ai/provider';

async function main() {
  const studio = getStudioAi();
  const workbench = providerFromEnv();
  console.log(`AI_PROVIDER:                    ${process.env.AI_PROVIDER ?? '(unset, means gemini)'}`);
  console.log(`AI_API_KEY set:                 ${process.env.AI_API_KEY ? (process.env.AI_API_KEY === 'your-gemini-api-key' ? 'placeholder only' : 'yes') : 'no'}`);
  console.log(`AI_MODEL:                       ${process.env.AI_MODEL ?? '(unset, means gemini-3.5-flash-lite)'}`);
  console.log(`Studio assistant model:         ${studio ? (studio.kind === 'gemini' ? `gemini ${studio.model}` : studio.kind) : 'none (button greyed out)'}`);
  console.log(`Workbench AI model:             ${workbench ? `${workbench.name} ${workbench.model}` : 'none'}`);
  console.log(`AG licence key set:             ${process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ? 'yes' : 'no (trial watermark)'}`);
  const db = getDb();
  const demo = await db.ledgerEntry.count({ where: { order: { paypalOrderId: { startsWith: 'DEMO-' } } } });
  console.log(`Demo ledger lines:              ${demo}${demo === 0 ? '  (run npm run db:seed)' : ''}`);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
