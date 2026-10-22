// T-305/T-306 live smoke test: one real call to the AI provider on invented evaluation cases.
//   npx tsx --env-file=.env scripts/live-ai-smoke.ts
// Needs AI_API_KEY (and optionally AI_MODEL) in .env. Sends ONLY the invented cases EV-01 and EV-14 (EV-14 holds
// an instruction in the buyer's text), never a real dispute. Prints the key's presence, never its value.
// Stores AgentRun rows in dev.db (caseId EVAL-...) and saves live-check-out/ai-smoke.json (gitignored).
import fs from 'node:fs';
import { analyse } from '../src/ai/adapter';
import { gateSuggestion } from '../src/ai/gate';
import { providerFromEnv } from '../src/ai/provider';
import { getDb } from '../src/lib/server-deps';
import type { CaseFile } from '../src/case/case-file';

async function main() {
  const provider = providerFromEnv();
  if (!provider) {
    console.log('No usable AI_API_KEY / AI_PROVIDER=gemini in the environment: nothing to test. (Key value is never printed.)');
    process.exit(1);
  }
  console.log(`provider=${provider.name} model=${provider.model}`);
  const db = getDb();
  const out: unknown[] = [];
  for (const id of ['EV-01', 'EV-14']) {
    const c = JSON.parse(fs.readFileSync(`eval/cases/${id}.json`, 'utf8')) as { asOf: string; caseFile: CaseFile };
    const r = await analyse(db, c.caseFile, provider, { asOf: new Date(c.asOf), syntheticData: true });
    const run = await db.agentRun.findUniqueOrThrow({ where: { id: r.runId } });
    const gated = gateSuggestion({
      ai: r.mode === 'AI' ? r.analysis : null,
      rules: r.rules,
      allowed: c.caseFile.allowedActions.actions,
      draftBlocked: r.validation?.draftBlocked,
    });
    const row = {
      id,
      mode: r.mode,
      validation: run.validation,
      latencyMs: run.latencyMs,
      aiAction: r.mode === 'AI' ? r.analysis.recommendedAction : null,
      rulesAction: r.rules.recommendedAction,
      gatedAction: gated.action,
      gateReason: gated.reason,
      claimResults: r.validation?.results.map((x) => `${x.claimId}:${x.result}`) ?? [],
      hallucinated: r.validation?.hallucinatedCitations ?? [],
      summary: gated.summary,
    };
    out.push(row);
    console.log(JSON.stringify(row, null, 1));
  }
  fs.mkdirSync('live-check-out', { recursive: true });
  fs.writeFileSync('live-check-out/ai-smoke.json', JSON.stringify(out, null, 1));
}
main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e).replace(/key=[^&\s]+/gi, 'key=[removed]'));
  process.exit(1);
});
