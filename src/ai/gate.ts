// The action gate for the suggestion (T-306): executable action = AI suggestion ∩ allowed actions.
// `allowed` must come from a FRESH GET of the dispute's links (CLAUDE.md). This module only decides what to
// show; the action service re-checks the links again at approval, and nothing here calls PayPal.
import type { ActionCode } from '../disputes/allowed-actions';
import type { RulesResult } from '../rules/rules';
import type { Action, Analysis } from './schema';

const NO_WRITE: readonly Action[] = ['WAIT', 'NO_ACTION'];

export interface Gated {
  action: Action;
  source: 'AI' | 'RULES';
  /** Why the AI suggestion was not used, or why nothing can be done. Shown to the seller. */
  reason: string | null;
  /** From the final action, never from the model's own claim. */
  approvalRequired: boolean;
  agreesWithRules: boolean;
  draft: Analysis['draft'];
  summary: string;
}

export function gateSuggestion(input: {
  ai: Analysis | null;
  rules: RulesResult;
  allowed: readonly ActionCode[];
  draftBlocked?: boolean;
}): Gated {
  const { ai, rules, allowed } = input;
  const offered = (a: Action) => NO_WRITE.includes(a) || (a !== 'ESCALATE' && (allowed as readonly string[]).includes(a));
  const agreesWithRules = !ai || ai.recommendedAction === rules.recommendedAction;
  const finish = (action: Action, source: Gated['source'], reason: string | null, a: Analysis): Gated => ({
    action,
    source,
    reason,
    approvalRequired: !NO_WRITE.includes(action),
    agreesWithRules,
    draft: action === 'SEND_MESSAGE' || action === 'PROVIDE_SUPPORTING_INFO' ? a.draft : null,
    summary: a.summary,
  });

  if (ai && offered(ai.recommendedAction)) {
    if (input.draftBlocked && ai.draft) {
      const safe = rules.recommendedAction === ai.recommendedAction ? rules.analysis.draft : null;
      return finish(ai.recommendedAction, 'AI', 'The AI draft was held back because it cited claims the records do not support.', {
        ...ai,
        draft: safe,
      });
    }
    return finish(ai.recommendedAction, 'AI', null, ai);
  }

  const why = ai
    ? ai.recommendedAction === 'ESCALATE'
      ? 'The AI suggested escalating. Escalating cannot be undone, so it is never recommended; you can still choose it yourself. Showing the rules recommendation.'
      : `The AI suggested ${ai.recommendedAction}, which PayPal does not offer now. Showing the rules recommendation.`
    : null;

  if (offered(rules.recommendedAction)) return finish(rules.recommendedAction, 'RULES', why, rules.analysis);
  return finish(
    'NO_ACTION',
    'RULES',
    `${why ? why + ' ' : ''}The recommended action (${rules.recommendedAction}) is no longer offered by PayPal. Sync the case and look again.`,
    { ...rules.analysis, draft: null },
  );
}
