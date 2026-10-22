// Evaluation runner (T-310): runs the real model on the evaluation cases, scores against the owner's frozen labels,
// and writes the report. Uses the real provider, so it is the only place (with the smoke test) the model is called.
//   npm run eval                 development split (24 cases), as often as needed
//   npm run eval -- --heldout    the 12 held-out cases: ONCE. A second run is refused (eval/runs/heldout.lock).
// Only the invented cases are sent. Never prints the key. Raw answers and scores go to eval/runs/, the report to eval/.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { analyse } from '../src/ai/adapter';
import { gateSuggestion } from '../src/ai/gate';
import { providerFromEnv } from '../src/ai/provider';
import type { CaseFile } from '../src/case/case-file';
import { aggregate, scoreCase, type CaseScore, type Label } from '../src/eval/score';
import { getDb } from '../src/lib/server-deps';

const FROZEN_LABELS_TREE = '08a3bce9c1eebe23f10facc2e67669160acb5eaa'; // docs/DECISIONS.md, T-309
const heldout = process.argv.includes('--heldout');
const split = heldout ? 'heldout' : 'dev';
const lock = 'eval/runs/heldout.lock';
// The provider limits calls per minute (the first dev run lost its last 9 cases after about 15 quick calls). Pace the calls.
const paceMs = Number(process.argv.find((a) => a.startsWith('--pace='))?.slice(7) ?? 6000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function labelsTree(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD:eval/labels'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

async function main() {
  if (heldout && fs.existsSync(lock)) {
    console.error(`The held-out cases were already run (${fs.readFileSync(lock, 'utf8').trim()}). They run once. Refusing.`);
    process.exit(2);
  }
  const provider = providerFromEnv();
  if (!provider) {
    console.error('No usable AI_API_KEY / AI_PROVIDER=gemini in the environment.');
    process.exit(1);
  }
  const tree = labelsTree();
  const frozen = tree === FROZEN_LABELS_TREE;
  const files = fs.readdirSync('eval/cases').filter((f) => /^EV-\d{2}\.json$/.test(f)).sort();
  const db = getDb();
  const scores: CaseScore[] = [];
  const rows: Array<Record<string, unknown>> = [];
  fs.mkdirSync('eval/runs', { recursive: true });

  for (const f of files) {
    const c = JSON.parse(fs.readFileSync(`eval/cases/${f}`, 'utf8')) as { id: string; split: string; asOf: string; caseFile: CaseFile };
    if (c.split !== split) continue;
    const label = JSON.parse(fs.readFileSync(`eval/labels/${f}`, 'utf8')) as Label;
    if (scores.length) await sleep(paceMs);
    const r = await analyse(db, c.caseFile, provider, { asOf: new Date(c.asOf), syntheticData: true });
    const run = await db.agentRun.findUniqueOrThrow({ where: { id: r.runId } });
    const gated = gateSuggestion({
      ai: r.mode === 'AI' ? r.analysis : null,
      rules: r.rules,
      allowed: c.caseFile.allowedActions.actions,
      draftBlocked: r.validation?.draftBlocked,
    });
    const s = scoreCase({ id: c.id, label, mode: r.mode, repaired: run.validation.startsWith('REPAIRED'), analysis: r.analysis, validation: r.validation, gated });
    scores.push(s);
    rows.push({ id: c.id, label: label.recommendedAction, also: label.alsoAcceptable, mustNot: label.mustNotRecommend, ai: r.mode === 'AI' ? r.analysis.recommendedAction : null, final: gated.action, gateReason: gated.reason, validation: run.validation, latencyMs: run.latencyMs, summary: r.analysis.summary, draft: gated.draft?.text ?? null, score: s });
    console.log(`${c.id} label=${label.recommendedAction} ai=${r.mode === 'AI' ? r.analysis.recommendedAction : 'FELL_BACK'} final=${gated.action} ${s.decisionAcceptable ? 'ok' : 'MISS'}${s.textFlags.length ? ' flags=' + s.textFlags.join('|') : ''}`);
  }

  const a = aggregate(scores);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(`eval/runs/${split}-${stamp}.json`, JSON.stringify({ stamp, split, provider: provider.name, model: provider.model, labelsTree: tree, frozen, aggregate: a, rows }, null, 1));
  const g = (k: keyof typeof a.gates) => `${a.gates[k].pass === null ? 'REVIEW' : a.gates[k].pass ? 'PASS' : 'FAIL'} — ${a.gates[k].value}`;
  const md = `# Evaluation report (${split})

- Run: ${stamp}. Model: ${provider.name} ${provider.model}, temperature 0, one repair retry, 45 s limit.
- Cases: ${a.n} (${split} split of the 36 invented cases). Labels tree: \`${tree}\` — ${frozen ? 'matches the frozen labels (T-309)' : '**DIFFERS from the frozen labels; do not trust this run until explained**'}.
- Method: the model's own recommendation is scored against the owner's label (acceptable = the label's action or an alternative the owner allowed, and not on the must-not list). A fallback to rules counts as a miss and as schema-invalid. Claims are checked by \`validateClaims\` against the cited records (no second model). Phrases the owner ruled out are screened by pattern and a **human must read each flagged text** before the forbidden-claims gate can pass.

## Gates (plan, 20 Oct)
| Gate | Result |
| --- | --- |
| 0 hallucinated citations | ${g('hallucinatedCitations')} |
| 0 forbidden claims | ${g('forbiddenClaims')} |
| 100% schema-valid after one repair | ${g('schemaValid')} |
| At least 90% decision accuracy | ${g('decisionAccuracy')} |
| Zero action-gate violations, zero unsupported claims accepted | ${g('actionGate')} |

## Numbers (denominators shown)
- Decision accuracy, model alone: ${(a.decisionAccuracy * a.n).toFixed(0)} of ${a.n}. After the gate: ${(a.finalAccuracy * a.n).toFixed(0)} of ${a.n}.
- Forbidden actions recommended by the model: ${a.aiForbiddenActions} of ${a.n}. Past the gate: ${a.gateViolations}.
- Citation precision (claims SUPPORTED / claims made): ${a.claims.supported} of ${a.claims.total}${a.citationPrecision === null ? '' : ` (${(a.citationPrecision * 100).toFixed(1)}%)`}.
- Answers repaired: ${a.repaired} of ${a.n}.
- Cases flagged for owner review: ${a.casesWithTextFlags.join(', ') || 'none'}.

## Cases
| Case | Label | Also OK | Must not | Model | After gate | Result |
| --- | --- | --- | --- | --- | --- | --- |
${rows.map((r) => `| ${r.id} | ${r.label} | ${(r.also as string[]).join(', ') || '-'} | ${(r.mustNot as string[]).join(', ') || '-'} | ${r.ai ?? `fell back: ${String(r.validation).replace(/\|/g, '/').slice(0, 70)}`} | ${r.final} | ${(r.score as CaseScore).decisionAcceptable ? 'ok' : 'MISS'}${(r.score as CaseScore).textFlags.length ? ' (flag)' : ''} |`).join('\n')}
`;
  fs.writeFileSync(heldout ? 'eval/report-heldout.md' : 'eval/report.md', md);
  if (heldout) fs.writeFileSync(lock, `${stamp} labels=${tree}\n`);
  console.log(`\n${a.n} cases. Decision accuracy ${(a.decisionAccuracy * 100).toFixed(1)}%. Report: ${heldout ? 'eval/report-heldout.md' : 'eval/report.md'}`);
}
main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e).replace(/key=[^&\s]+/gi, 'key=[removed]'));
  process.exit(1);
});
