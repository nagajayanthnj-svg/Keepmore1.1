'use client';
// SANDBOX ONLY (T-402): stands in for PayPal staff deciding the case, so the demo can reach an outcome.
// Shown only when DEMO_MODE is on and the case is a real sandbox dispute. Approve, then send, like every write.
import { useState } from 'react';
import { TruthStateBadge } from '../truth-state-badge';
import { approveOutcome, canonicalText, sendOutcome, type Outcome } from './payload';

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

export function SandboxSettle({ state, disputeId, rawHash }: { state: 'OFFERED' | 'NOT_YET'; disputeId: string; rawHash: string }) {
  const [outcome, setOutcome] = useState<'SELLER_FAVOR' | 'BUYER_FAVOR' | null>(null);
  const [approval, setApproval] = useState<string | null>(null);
  const [message, setMessage] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const approve = async () => {
    setBusy(true);
    const r = await post(`/api/disputes/${encodeURIComponent(disputeId)}/sandbox-settle`, { outcome, expectedRawHash: rawHash });
    setBusy(false);
    setMessage(
      r.body.error === 'NOT_OFFERED'
        ? { tone: 'warn', text: 'PayPal does not show the adjudicate link yet. Nothing was approved.' }
        : approveOutcome(r.status, r.body),
    );
    if (r.status === 201) setApproval(String(r.body.approvalId));
  };
  const send = async () => {
    if (!approval) return;
    setBusy(true);
    const r = await post(`/api/approvals/${encodeURIComponent(approval)}/sandbox-settle`);
    setBusy(false);
    setDone(true);
    const m = sendOutcome(r.status, r.body);
    setMessage(r.status === 200 ? { ...m, text: `${m.text} Reload the page to see the outcome.` } : m);
  };

  return (
    <div className="space-y-2 rounded border-2 border-dotted border-orange-700 bg-orange-50 p-3" data-testid="sandbox-settle">
      <h3 className="font-semibold">
        Sandbox-simulated adjudication <TruthStateBadge state="Simulated demo" />
      </h3>
      <p>
        In production, PayPal staff decide the case. In the sandbox this step stands in for them, so the demo can reach an
        outcome. It is a real sandbox call and only works with DEMO_MODE on.
      </p>
      {state === 'NOT_YET' ? (
        <p data-testid="settle-not-yet">PayPal shows this step about 25–30 minutes after the review starts. Sync later.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Simulated decision">
            {(
              [
                ['SELLER_FAVOR', 'Seller wins'],
                ['BUYER_FAVOR', 'Buyer wins (not yet tried in the sandbox)'],
              ] as const
            ).map(([code, label]) => (
              <button
                key={code}
                type="button"
                aria-pressed={outcome === code}
                disabled={!!approval || done}
                onClick={() => {
                  setOutcome(code);
                  setMessage(null);
                }}
                className={`rounded border px-3 py-1.5 ${outcome === code ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-500 bg-white'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {outcome && (
            <>
              <pre className="rounded bg-neutral-900 p-2 text-xs text-neutral-50">{canonicalText({ adjudicationOutcome: outcome })}</pre>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy || !!approval || done} onClick={approve} className="rounded bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-40">
                  Approve this payload
                </button>
                <button type="button" disabled={busy || !approval || done} onClick={send} className="rounded border-2 border-neutral-900 px-3 py-1.5 disabled:opacity-40">
                  Send to PayPal sandbox
                </button>
              </div>
            </>
          )}
        </>
      )}
      {message && (
        <p role="status" className={`rounded border-2 p-2 ${TONE[message.tone]}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
