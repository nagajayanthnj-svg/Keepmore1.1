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

const Panel = ({ title, id, children, testId }: { title: string; id: string; children: React.ReactNode; testId: string }) => (
  <section aria-labelledby={id} data-testid={testId} className="rounded-lg border border-neutral-200 bg-white p-4">
    <h2 id={id} className="text-base font-semibold">
      {title}
    </h2>
    <div className="mt-3 space-y-3 text-sm">{children}</div>
  </section>
);

function Records({ ids, view }: { ids: string[]; view: WorkbenchView }) {
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {ids.map((id) => {
        const r = view.evidence.find((e) => e.id === id);
        const m = view.buyerMessages.find((b) => b.id === id);
        return (
          <span key={id} className="inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700">
            <code className="whitespace-nowrap">{id}</code>
            {r ? humanise(r.type) : m ? 'Buyer message' : 'not in this case'}
            {(r ?? m) && <TruthStateBadge state={(r ?? m)!.trustState} />}
          </span>
        );
      })}
    </span>
  );
}

function Recommendation({ rules, result }: { rules: RulesResult | null; result: Result | null }) {
  if (!rules) return <p role="status">Reading the case…</p>;
  const action = result?.gated.action ?? rules.recommendedAction;
  const source = result ? (result.gated.source === 'AI' ? 'AI suggestion, checked' : 'Rules') : 'Rules (AI still thinking)';
  const summary = result?.gated.summary ?? rules.analysis.summary;
  const draft = result ? result.gated.draft : rules.analysis.draft;
  return (
    <>
      <p className="text-lg font-semibold" data-testid="recommended-action" data-action={action}>
        {ACTION_LABEL[action] ?? action}
      </p>
      <p className="text-neutral-600" data-testid="recommendation-source">
        {source}
        {result?.label ? ` · ${result.label}` : ''}
      </p>
      {(rules.flags.includes('DEADLINE_PASSED') || rules.flags.includes('DEADLINE_URGENT')) && (
        <p className="rounded border-2 border-red-700 bg-red-50 p-2 font-medium text-red-900" role="alert">
          {rules.flags.includes('DEADLINE_PASSED') ? 'The deadline has passed. Sync now.' : `${rules.deadline?.hoursLeft} hours left to respond.`}
        </p>
      )}
      {rules.flags.includes('REVIEW_BEFORE_DECIDING') && (
        <p className="rounded border border-amber-700 bg-amber-50 p-2 text-amber-900">High value: review before you decide.</p>
      )}
      {result?.gated.reason && (
        <p className="rounded border border-neutral-400 bg-neutral-50 p-2" data-testid="gate-reason">
          {result.gated.reason}
        </p>
      )}
      {result && !result.gated.agreesWithRules && result.mode === 'AI' && (
        <p className="text-neutral-700">The AI and the rules disagree. Rules say: {ACTION_LABEL[rules.recommendedAction]}.</p>
      )}
      <p>{summary}</p>
      {rules.checklist.length > 0 && (
        <div>
          <h3 className="font-medium">PayPal asked for</h3>
          <ul className="mt-1 space-y-1" data-testid="evidence-checklist">
            {rules.checklist.map((c) => (
              <li key={c.type} data-supportable={c.supportable}>
                <span aria-hidden>{c.supportable ? '✓' : '✗'}</span> {EVIDENCE_LABEL[c.type] ?? humanise(c.type)}:{' '}
                {c.supportable ? 'we have it' : `missing (${c.reason})`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {draft && (
        <div data-testid="draft">
          <h3 className="font-medium">Draft message</h3>
          <p className="mt-1 whitespace-pre-wrap rounded bg-neutral-50 p-2">{draft.text}</p>
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
      <div data-testid="truth-supported">
        <h3 className="font-medium">Backed by our records</h3>
        {supported.length === 0 ? (
          <p className="text-neutral-600">Nothing yet.</p>
        ) : (
          <ul className="mt-1 space-y-2">
            {supported.map((c) => (
              <li key={c.id}>
                {claimText(c)}
                <Records ids={c.recordIds} view={view} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div data-testid="truth-unsupported">
        <h3 className="font-medium">Not backed, so never sent</h3>
        {not.length === 0 ? (
          <p className="text-neutral-600">None.</p>
        ) : (
          <ul className="mt-1 space-y-2">
            {not.map((c) => {
              const r = checks.get(c.id);
              return (
                <li key={c.id}>
                  {claimText(c)}{' '}
                  <span className="text-neutral-600">
                    — {r?.superseded ? `replaced by a later event (${r.superseded})` : `${RESULT_LABEL[r?.result ?? 'UNVERIFIED']}: ${r?.reason ?? ''}`}
                  </span>
                  <Records ids={c.recordIds} view={view} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div data-testid="buyer-said">
        <h3 className="font-medium">What the buyer wrote</h3>
        <p className="text-neutral-600">Their account, not proof. Contact details are removed.</p>
        {view.buyerMessages.length === 0 ? (
          <p className="text-neutral-600">No messages.</p>
        ) : (
          <ul className="mt-1 space-y-2">
            {view.buyerMessages.map((m) => (
              <li key={m.id}>
                <blockquote className="border-l-4 border-neutral-300 pl-2 italic">{m.text}</blockquote>
                <span className="text-xs text-neutral-600">
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

function Allowed({ result }: { result: Result | null }) {
  if (!result) return <p role="status">Asking PayPal what you can do now…</p>;
  const { source, actions } = result.allowed;
  return (
    <>
      <p className="text-neutral-600" data-testid="allowed-source" data-source={source}>
        {source === 'PAYPAL'
          ? 'What PayPal offers right now.'
          : source === 'SIMULATED'
            ? 'Simulated demo: nothing is sent to PayPal.'
            : 'PayPal could not be reached, so nothing can be sent. Sync and try again.'}
      </p>
      <ul data-testid="allowed-actions" className="space-y-1">
        {actions.length === 0 ? <li>No action is offered.</li> : actions.map((a) => <li key={a}>{ACTION_LABEL[a] ?? a}</li>)}
      </ul>
    </>
  );
}

export function Workbench({ view }: { view: WorkbenchView }) {
  const { rules, result, failed } = useAnalysis(view.disputeId);
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-3">
      {failed && (
        <p role="alert" className="rounded border-2 border-red-700 bg-red-50 p-3 text-red-900 lg:col-span-3">
          The analysis could not be loaded. Nothing has been sent. Reload the page to try again.
        </p>
      )}
      <Panel title="Recommendation" id="wb-rec" testId="recommendation">
        <Recommendation rules={rules} result={result} />
      </Panel>
      <Panel title="Truth map" id="wb-truth" testId="truth-map">
        <TruthMap rules={rules} result={result} view={view} />
      </Panel>
      <Panel title="Actions" id="wb-actions" testId="actions">
        <Allowed result={result} />
      </Panel>
    </div>
  );
}
