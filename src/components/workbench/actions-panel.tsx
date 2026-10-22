'use client';
// The Actions panel (T-401): buttons only for what PayPal offers now, the exact payload, then Approve and Send.
// Approve and Send are separate presses; any edit after approving needs a new approval (decision 2, 22 Oct).
// A refund is never preselected and ESCALATE needs an explicit "cannot be undone" tick (decision 6).
import { useState } from 'react';
import type { AnalyseEvent } from '../../ai/analyse-route';
import { claimText } from '../../ai/claim-text';
import type { WorkbenchView } from '../../disputes/workbench';
import type { RulesResult } from '../../rules/rules';
import { fromMinor } from '../../normalise/money';
import { TruthStateBadge } from '../truth-state-badge';
import { ACTION_LABEL } from './labels';
import { SandboxSettle } from './sandbox-settle';
import {
  approveOutcome,
  canonicalText,
  defaultPayload,
  editPayload,
  mainText,
  sendOutcome,
  type Outcome,
  type Payload,
  type WritableAction,
} from './payload';

type Result = Extract<AnalyseEvent, { type: 'result' }>;

const TEXT_LABEL: Record<WritableAction, string> = {
  SEND_MESSAGE: 'Message to the buyer',
  PROVIDE_SUPPORTING_INFO: 'Information for PayPal',
  PROVIDE_EVIDENCE: 'Evidence note (sent with each type we can support)',
  ACCEPT_CLAIM: 'Why you accept the claim (required; this refunds the buyer in full)',
  ESCALATE: 'Why you escalate (required)',
};

const TONE: Record<Outcome['tone'], string> = {
  ok: 'border-emerald-700 bg-emerald-50 text-emerald-900',
  warn: 'border-amber-700 bg-amber-50 text-amber-900',
  error: 'border-red-700 bg-red-50 text-red-900',
};

const post = async (url: string, body?: unknown) => {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } catch {
    return { status: 0, body: { error: 'NETWORK' } as Record<string, unknown> };
  }
};

export function ActionsPanel({ view, rules, result }: { view: WorkbenchView; rules: RulesResult | null; result: Result | null }) {
  const [action, setAction] = useState<WritableAction | null>(null);
  const [payload, setPayload] = useState<Payload>({});
  const [edited, setEdited] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [approval, setApproval] = useState<string | null>(null);
  const [message, setMessage] = useState<Outcome | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!result || !rules) return <p role="status">Asking PayPal what you can do now…</p>;
  const { source, actions } = result.allowed;

  const choose = (a: WritableAction) => {
    const shipped = rules.analysis.claims.find((c) => c.type === 'SHIPPED');
    setAction(a);
    setPayload(
      defaultPayload(a, {
        draft: result.gated.draft?.text ?? null,
        supportable: rules.checklist.filter((c) => c.supportable).map((c) => c.type),
        evidenceNote: shipped ? claimText(shipped) : '',
      }),
    );
    setEdited(false);
    setUnderstood(false);
    setApproval(null);
    setMessage(null);
    setSent(false);
  };
  const edit = (text: string) => {
    if (!action) return;
    setPayload(editPayload(action, payload, text));
    setEdited(true);
    setApproval(null); // the hash covered the old words
    setMessage(null);
  };
  const approve = async () => {
    if (!action) return;
    setBusy(true);
    const r = await post(`/api/disputes/${encodeURIComponent(view.disputeId)}/approve`, {
      action,
      payload,
      expectedRawHash: view.rawHash,
    });
    setBusy(false);
    setMessage(approveOutcome(r.status, r.body));
    if (r.status === 201) setApproval(String(r.body.approvalId));
  };
  const send = async () => {
    if (!approval) return;
    setBusy(true);
    const r = await post(`/api/approvals/${encodeURIComponent(approval)}/submit`);
    setBusy(false);
    setMessage(sendOutcome(r.status, r.body));
    setSent(true); // one press per approval: a retry after a lost answer needs the thread checked first
  };
  const sync = async () => {
    setBusy(true);
    await post(`/api/disputes/${encodeURIComponent(view.disputeId)}/sync`);
    window.location.reload();
  };

  const text = action ? mainText(action, payload) : '';
  const ready = !!action && text.trim().length > 0 && (action !== 'ESCALATE' || understood);

  return (
    <>
      <p className="text-neutral-600" data-testid="allowed-source" data-source={source}>
        {source === 'PAYPAL'
          ? 'What PayPal offers right now.'
          : source === 'SIMULATED'
            ? 'Simulated demo: nothing is sent to PayPal.'
            : 'PayPal could not be reached, so nothing can be sent. Sync and try again.'}
      </p>
      <div className="flex flex-wrap gap-2" data-testid="allowed-actions" role="group" aria-label="Actions PayPal offers">
        {actions.length === 0 && <span>No action is offered.</span>}
        {actions.map((a) => (
          <button
            key={a}
            type="button"
            data-testid={`action-${a}`}
            aria-pressed={action === a}
            onClick={() => choose(a as WritableAction)}
            className={`rounded border px-3 py-1.5 text-left font-medium ${
              action === a ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-400 bg-white hover:bg-neutral-50'
            } ${a === 'ESCALATE' || a === 'ACCEPT_CLAIM' ? 'border-dashed' : ''}`}
          >
            {ACTION_LABEL[a] ?? a}
            {a === result.gated.action && <span className="ml-1 text-xs font-normal">(recommended)</span>}
          </button>
        ))}
      </div>
      {view.stale && source === 'PAYPAL' && (
        <p className="rounded border border-amber-700 bg-amber-50 p-2 text-amber-900">
          Last read from PayPal over five minutes ago. Approving needs a fresh read.{' '}
          <button type="button" className="underline" onClick={sync} disabled={busy}>
            Sync now
          </button>
        </p>
      )}

      {action && (
        <div className="space-y-3 border-t border-neutral-200 pt-3" data-testid="approval-panel">
          {action === 'ESCALATE' && (
            <div className="rounded border-2 border-red-700 bg-red-50 p-2 text-red-900">
              <p>Escalating moves the case to PayPal&apos;s decision and cannot be undone. KeepMore never recommends it.</p>
              <label className="mt-1 flex items-center gap-2">
                <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} data-testid="escalate-understood" />
                I understand this cannot be undone
              </label>
            </div>
          )}
          {action === 'ACCEPT_CLAIM' && (
            <p className="rounded border border-amber-700 bg-amber-50 p-2 text-amber-900">
              Accepting refunds the buyer {fromMinor(view.amountMinor, view.currency)} {view.currency} in full. Nothing is chosen for you.
            </p>
          )}
          <label className="block">
            <span className="font-medium">{TEXT_LABEL[action]}</span>
            <textarea
              data-testid="payload-text"
              className="mt-1 block w-full rounded border border-neutral-400 p-2"
              rows={5}
              value={text}
              onChange={(e) => edit(e.target.value)}
              disabled={sent}
            />
          </label>
          {edited && (
            <p className="text-xs text-neutral-700" data-testid="edited-note">
              <TruthStateBadge state="Seller entered" /> Edited by you. Your words are not checked against the records.
            </p>
          )}
          <div>
            <h3 className="font-medium">Exact payload you approve</h3>
            <pre data-testid="payload" className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded bg-neutral-900 p-2 text-xs text-neutral-50">
              {canonicalText(payload)}
            </pre>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="approve"
              disabled={!ready || busy || !!approval || sent}
              onClick={approve}
              className="rounded bg-neutral-900 px-3 py-1.5 font-medium text-white disabled:opacity-40"
            >
              Approve this payload
            </button>
            <button
              type="button"
              data-testid="send"
              disabled={!approval || busy || sent}
              onClick={send}
              className="rounded border-2 border-neutral-900 px-3 py-1.5 font-medium disabled:opacity-40"
            >
              Send to PayPal
            </button>
          </div>
        </div>
      )}
      {result.sandboxSettle && (
        <SandboxSettle state={result.sandboxSettle} disputeId={view.disputeId} rawHash={view.rawHash} />
      )}
      {message && (
        <p role="status" data-testid="action-message" data-tone={message.tone} className={`rounded border-2 p-2 ${TONE[message.tone]}`}>
          {message.text}
        </p>
      )}
    </>
  );
}
