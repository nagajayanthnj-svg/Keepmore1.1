// analyse (T-305): Stage B. One model call, one repair retry on a bad answer, a 45 second limit, then Stage A only.
// The model's answer is a suggestion. Citation checks are reported (T-304) and the action gate is T-306.
// Every run, AI or rules, is stored in AgentRun.
import { createHash } from 'node:crypto';
import type { CaseFile } from '../case/case-file';
import type { Db } from '../lib/db';
import { runRules, type RulesResult } from '../rules/rules';
import { AnalysisSchema, type Analysis } from './schema';
import { validateClaims, type Validation } from './validate-claims';
import { buildPrompt, repairPrompt } from './prompt';
import type { AiPrompt, AiProvider } from './provider';

export const RULES_LABEL = 'Rules-based guidance — AI unavailable';

export interface AnalyseOptions {
  asOf: Date;
  timeoutMs?: number;
  /** True only for invented data (demo cases, evaluation). Real buyer text is never sent (CLAUDE.md). */
  syntheticData?: boolean;
  dailyCap?: number;
}
export interface AnalyseResult {
  mode: 'AI' | 'RULES';
  label: string | null;
  analysis: Analysis;
  rules: RulesResult;
  validation: Validation | null;
  runId: string;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function parseOutput(raw: string): { ok: true; value: Analysis } | { ok: false; error: string } {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'the answer was not valid JSON' };
  }
  const r = AnalysisSchema.safeParse(json);
  if (r.success) return { ok: true, value: r.data };
  const issues = r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  return { ok: false, error: `the answer did not match the schema: ${issues.join('; ').slice(0, 600)}` };
}

class Timeout extends Error {}
async function call(provider: AiProvider, prompt: AiPrompt, ms: number): Promise<string> {
  const ctl = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, rej) => {
    timer = setTimeout(() => {
      ctl.abort();
      rej(new Timeout('timeout'));
    }, ms);
  });
  try {
    return await Promise.race([provider.generate(prompt, ctl.signal), limit]);
  } finally {
    clearTimeout(timer);
  }
}

export async function analyse(db: Db, cf: CaseFile, provider: AiProvider | null, opts: AnalyseOptions): Promise<AnalyseResult> {
  const started = Date.now();
  const rules = runRules(cf, opts.asOf);
  const prompt = buildPrompt(cf, opts.asOf, opts.syntheticData ?? false);
  const inputHash = sha256(prompt.system + prompt.user);
  let raw = '';

  const store = async (mode: 'AI' | 'RULES', analysis: Analysis, validation: string, attempted: boolean) =>
    (
      await db.agentRun.create({
        data: {
          caseId: cf.caseId,
          mode,
          provider: attempted ? provider!.name : null,
          model: attempted ? provider!.model : null,
          inputHash,
          outputJson: JSON.stringify({ shown: analysis, raw: raw.slice(0, 20_000) }),
          validation,
          latencyMs: Date.now() - started,
        },
      })
    ).id;

  const fallBack = async (why: string, attempted: boolean): Promise<AnalyseResult> => ({
    mode: 'RULES',
    label: RULES_LABEL,
    analysis: rules.analysis,
    rules,
    validation: null,
    runId: await store('RULES', rules.analysis, `FELL_BACK: ${why}`, attempted),
  });

  if (!provider) return fallBack('NO_PROVIDER', false);
  if (opts.dailyCap !== undefined) {
    const startOfDay = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    const used = await db.agentRun.count({ where: { provider: { not: null }, createdAt: { gte: startOfDay } } });
    if (used >= opts.dailyCap) return fallBack('DAILY_CAP', false);
  }

  const ms = opts.timeoutMs ?? 45_000;
  let repaired = false;
  let current = prompt;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      raw = await call(provider, current, ms);
    } catch (e) {
      return fallBack(e instanceof Timeout ? `TIMEOUT after ${ms} ms` : 'PROVIDER_ERROR', true);
    }
    const parsed = parseOutput(raw);
    if (parsed.ok) {
      const validation = validateClaims(parsed.value, cf);
      const note = validation.hallucinatedCitations.length ? ` (hallucinated: ${validation.hallucinatedCitations.join(',')})` : '';
      return {
        mode: 'AI',
        label: null,
        analysis: parsed.value,
        rules,
        validation,
        runId: await store('AI', parsed.value, (repaired ? 'REPAIRED' : 'PASS') + note, true),
      };
    }
    if (attempt === 0) {
      repaired = true;
      current = repairPrompt(prompt, raw, parsed.error);
    } else {
      return fallBack(`SCHEMA_TWICE: ${parsed.error}`.slice(0, 300), true);
    }
  }
  return fallBack('UNREACHABLE', true);
}
