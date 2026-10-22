// The one call the screens make (T-307/T-401): analyse the case, then gate the suggestion against the allowed actions.
// `allowed` must come from a fresh GET of the dispute's links. Nothing here calls PayPal.
import type { CaseFile } from '../case/case-file';
import type { Db } from '../lib/db';
import type { ActionCode } from '../disputes/allowed-actions';
import { analyse, type AnalyseOptions, type AnalyseResult } from './adapter';
import { gateSuggestion, type Gated } from './gate';
import type { AiProvider } from './provider';

export async function analyseAndGate(
  db: Db,
  cf: CaseFile,
  provider: AiProvider | null,
  opts: AnalyseOptions,
  allowed: readonly ActionCode[],
): Promise<{ result: AnalyseResult; gated: Gated }> {
  const result = await analyse(db, cf, provider, opts);
  const gated = gateSuggestion({
    ai: result.mode === 'AI' ? result.analysis : null,
    rules: result.rules,
    allowed,
    draftBlocked: result.validation?.draftBlocked,
  });
  return { result, gated };
}
