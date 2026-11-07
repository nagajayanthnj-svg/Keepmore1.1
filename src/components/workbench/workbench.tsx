'use client';
// The dispute workbench (T-401): recommendation, truth map, actions. It asks the analyse route (T-308) and shows the
// rules answer at once, then the AI answer or the rules fallback. It never decides what may be sent: the allowed
// actions come from PayPal (fresh GET) through the route, and the approve and send routes check again.
import { useEffect, useState } from 'react';
import type { AnalyseEvent } from '../../ai/analyse-route';
import { claimText } from '../../ai/claim-text';
import type { Claim } from '../../ai/schema';
import type { WorkbenchView } from '../../disputes/workbench';
import type { RulesResult } from '../../rules/rules';
import { TruthStateBadge } from '../truth-state-badge';
import { ActionsPanel } from './actions-panel';
import { ACTION_LABEL, EVIDENCE_LABEL, RESULT_LABEL, humanise } from './labels';

type Result = Extract<AnalyseEvent, { type: 'result' }>;

function useAnalysis(disputeId: string) {
  const [rules, setRules] = useState<RulesResult | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/disputes/${encodeURIComponent(disputeId)}/analyse`, { method: 'POST' });
        if (!res.ok || !res.body) throw new Error(String(res.status));
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const e = JSON.parse(buf.slice(0, nl)) as AnalyseEvent;
            buf = buf.slice(nl + 1);
            if (!live) return;
            if (e.type === 'rules') setRules(e.rules);
            else if (e.type === 'result') setResult(e);
            else setFailed(true);
          }
        }
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [disputeId]);
  return { rules, result, failed };
}

// `raised` marks the panel where the seller acts.
const Panel = ({ title, id, children, testId, raised = false }: { title: string; id: string; children: React.ReactNode; testId: string; raised?: boolean }) => (
  <section aria-labelledby={id} data-testid={testId} className={raised ? 'km-panel-raised' : 'km-panel'}>
    <h2 id={id} className="km-h2 text-base">
      {title}
    </h2>
    <div className="mt-4 space-y-4 text-sm leading-relaxed">{children}</div>
  </section>
);

function Records({ ids, view }: { ids: string[]; view: WorkbenchView }) {
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {ids.map((id) => {
        const r = view.evidence.find((e) => e.id === id);
        const m = view.buyerMessages.find((b) => b.id === id);
        return (
          <span key={id} className="inline-flex items-center gap-1.5 rounded-md bg-canvas px-2 py-1 text-xs text-muted">
            <code className="whitespace-nowrap">{id}</code>
            {r ? humanise(r.type) : m ? 'Buyer message' : 'not in this case'}
            {(r ?? m) && <TruthStateBadge state={(r ?? m)!.trustState} />}
          </span>
        );
      })}
    </span>
  );
}

const trustOf = (c: Claim, view: WorkbenchView) =>
  view.evidence.find((e) => e.id === c.recordIds[0])?.trustState;

function Recommendation({ rules, result }: { rules: RulesResult | null; result: Result | null }) {
  if (!rules) return <p role="status">Reading the case…</p>;
  const action = result?.gated.action ?? rules.recommendedAction;
  const source = result ? (result.gated.source === 'AI' ? 'AI suggestion, checked' : 'Rules') : 'Rules (AI still thinking)';
  const summary = result?.gated.summary ?? rules.analysis.summary;
  const draft = result ? result.gated.draft : rules.analysis.draft;
  return (
    <>
      <p className="text-xl font-semibold text-brand-700" data-testid="recommended-action" data-action={action}>
        {ACTION_LABEL[action] ?? action}
      </p>
      <p className="-mt-2 text-xs text-muted" data-testid="recommendation-source">
        {source}
        {result?.label ? ` · ${result.label}` : ''}
      </p>
      {(rules.flags.includes('DEADLINE_PASSED') || rules.flags.includes('DEADLINE_URGENT')) && (
        <p className="km-callout-danger font-medium" role="alert">
          {rules.flags.includes('DEADLINE_PASSED') ? 'The deadline has passed. Sync now.' : `${rules.deadline?.hoursLeft} hours left to respond.`}
        </p>
      )}
      {rules.flags.includes('REVIEW_BEFORE_DECIDING') && (
        <p className="km-callout-warn">High value: review before you decide.</p>
      )}
      {result?.gated.reason && (
        <p className="km-callout-info" data-testid="gate-reason">
          {result.gated.reason}
        </p>
      )}
      {result && !result.gated.agreesWithRules && result.mode === 'AI' && (
        <p className="text-muted">The AI and the rules disagree. Rules say: {ACTION_LABEL[rules.recommendedAction]}.</p>
      )}
      <p>{summary}</p>
      {rules.checklist.length > 0 && (
        <div>
          <h3 className="font-semibold text-navy-900">PayPal asked for</h3>
          <ul className="mt-1 space-y-1" data-testid="evidence-checklist">
            {rules.checklist.map((c) => (
              <li key={c.type} data-supportable={c.supportable}>
                <span aria-hidden className={`mr-1 inline-grid h-4 w-4 place-items-center rounded-full text-[0.65rem] font-bold text-white ${c.supportable ? 'bg-emerald-600' : 'bg-red-600'}`}>{c.supportable ? '✓' : '✗'}</span> {EVIDENCE_LABEL[c.type] ?? humanise(c.type)}:{' '}
                {c.supportable ? 'we have it' : `missing (${c.reason})`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {draft && (
        <div data-testid="draft">
          <h3 className="font-semibold text-navy-900">Draft message</h3>
          <p className="mt-1 whitespace-pre-wrap rounded-lg border border-line bg-canvas p-3">{draft.text}</p>
        </div>
      )}
    </>
  );
}

function TruthMap({ result, rules, view }: { result: Result | null; rules: RulesResult | null; view: WorkbenchView }) {
  const claims: Claim[] = result?.analysis.claims ?? rules?.analysis.claims ?? [];
  const checks = new Map((result?.claims ?? []).map((c) => [c.claimId, c]));
  const ok = (c: Claim) => {
    const r = checks.get(c.id);
    return result ? r?.result === 'SUPPORTED' && !r.superseded : true; // rules claims are built from the records
  };
  const supported = claims.filter(ok);
  const not = claims.filter((c) => !ok(c));
  return (
    <>
      <div data-testid="truth-supported" className="border-l-4 border-emerald-600 pl-3">
        <h3 className="font-semibold text-emerald-900">Backed by our records</h3>
        {supported.length === 0 ? (
          <p className="text-muted">Nothing yet.</p>
        ) : (
          <ul className="mt-1 space-y-2">
            {supported.map((c) => (
              <li key={c.id}>
                {claimText(c, trustOf(c, view))}
                <Records ids={c.recordIds} view={view} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div data-testid="truth-unsupported" className="border-l-4 border-red-600 pl-3">
        <h3 className="font-semibold text-red-900">Not backed, so never sent</h3>
        {not.length === 0 ? (
          <p className="text-muted">None.</p>
        ) : (
          <ul className="mt-1 space-y-2">
            {not.map((c) => {
              const r = checks.get(c.id);
              return (
                <li key={c.id}>
                  {claimText(c, trustOf(c, view))}{' '}
                  <span className="text-muted">
                    — {r?.superseded ? `replaced by a later event (${r.superseded})` : `${RESULT_LABEL[r?.result ?? 'UNVERIFIED']}: ${r?.reason ?? ''}`}
                  </span>
                  <Records ids={c.recordIds} view={view} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div data-testid="buyer-said" className="border-l-4 border-slate-300 pl-3">
        <h3 className="font-semibold text-muted">What the buyer wrote</h3>
        <p className="text-muted">Their account, not proof. Contact details are removed.</p>
        {view.buyerMessages.length === 0 ? (
          <p className="text-muted">No messages.</p>
        ) : (
          <ul className="mt-1 space-y-2">
            {view.buyerMessages.map((m) => (
              <li key={m.id}>
                <blockquote className="italic text-ink">{m.text}</blockquote>
                <span className="text-xs text-muted">
                  {m.at.slice(0, 10)} <TruthStateBadge state={m.trustState} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

export function Workbench({ view }: { view: WorkbenchView }) {
  const { rules, result, failed } = useAnalysis(view.disputeId);
  return (
    <div className="mt-7 grid items-start gap-5 lg:grid-cols-[1fr_1.15fr_1fr]">
      {failed && (
        <p role="alert" className="km-callout-danger lg:col-span-3">
          The analysis could not be loaded. Nothing has been sent. Reload the page to try again.
        </p>
      )}
      <Panel title="Recommendation" id="wb-rec" testId="recommendation">
        <Recommendation rules={rules} result={result} />
      </Panel>
      <Panel title="Truth map" id="wb-truth" testId="truth-map">
        <TruthMap rules={rules} result={result} view={view} />
      </Panel>
      <Panel title="Actions" id="wb-actions" testId="actions" raised>
        <ActionsPanel view={view} rules={rules} result={result} />
      </Panel>
    </div>
  );
}
