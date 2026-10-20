// T-210/T-211 live check: the first real write to a PayPal sandbox dispute, through submitApprovedAction.
// Sandbox only. It sends two short send-message notes ("KeepMore live check ...") to ONE sandbox dispute.
// Run (on main with this PR merged and pulled; the dev server is not needed):
//   npx tsx --env-file=.env scripts/live-t210.ts            (picks the first real dispute that offers SEND_MESSAGE)
//   npx tsx --env-file=.env scripts/live-t210.ts <PP-id>    (a specific sandbox dispute id)
//
// A. Normal write: approve, submit, expect APPLIED, and exactly one new message on the dispute.
// B. Lost answer: the write reaches PayPal, but we pretend the answer never came back. Expect PAYPAL_UNAVAILABLE
//    (retryable), then a second submit of the same approval. Records what the service does and how many messages exist.
// C. Submit approval A again: must be ALREADY_SUBMITTED, nothing sent.
// Everything is written to live-check-out/ (gitignored) only. Credential values and message text are never printed.
import fs from 'node:fs';
import { approveAction } from '../src/disputes/approval';
import { submitApprovedAction, type ActionDeps } from '../src/disputes/actions';
import { getAllowedActions } from '../src/disputes/allowed-actions';
import { syncDispute } from '../src/disputes/sync';
import { getCheckoutDeps, getDb } from '../src/lib/server-deps';

const step = (n: string, t: string) => console.log(`\n== ${n}. ${t}`);
const out: Record<string, unknown> = {};

async function messageCount(deps: ActionDeps, id: string): Promise<number | null> {
  const r = await deps.paypal.get<{ messages?: unknown[] }>(`/v1/customer/disputes/${id}`);
  return Array.isArray(r.body.messages) ? r.body.messages.length : null;
}

async function main() {
  const base = getCheckoutDeps();
  if (!base) throw new Error('PayPal credentials missing from .env');
  const db = getDb();
  const deps: ActionDeps = { db, paypal: base.paypal, reread: { attempts: 8, delayMs: 5000 } };

  step('0', 'Pick a sandbox dispute that offers SEND_MESSAGE right now');
  const wanted = process.argv[2];
  const cases = await db.disputeCase.findMany({ where: { paypalDisputeId: { not: { startsWith: 'PP-DEMO-' } } }, orderBy: { paypalDisputeId: 'asc' } });
  let chosen: (typeof cases)[number] | undefined;
  for (const c of cases) {
    if (wanted && c.paypalDisputeId !== wanted) continue;
    try {
      const fresh = await getAllowedActions({ paypal: base.paypal }, c.paypalDisputeId);
      const rels = fresh.allowed.actions.map((a) => a.action).join(',');
      console.log(`  ${c.paypalDisputeId}  ${c.stage}/${c.status}  actions: ${rels || '(none)'}`);
      if (!chosen && fresh.allowed.actions.some((a) => a.action === 'SEND_MESSAGE')) chosen = c;
    } catch (e) {
      console.log(`  ${c.paypalDisputeId}  could not read: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!chosen) {
    console.log('STOP: no stored dispute offers SEND_MESSAGE. Run db:seed or the poller first, or pass a dispute id.');
    return;
  }
  console.log(`using ${chosen.paypalDisputeId} (case ${chosen.id})`);
  out.dispute = chosen.paypalDisputeId;

  const approve = async (label: string) => {
    await syncDispute(deps, chosen!.paypalDisputeId); // makes the case fresh, so it is not stale
    const c = await db.disputeCase.findUniqueOrThrow({ where: { id: chosen!.id } });
    const r = await approveAction(deps, {
      caseId: c.id,
      action: 'SEND_MESSAGE',
      payload: { message: `KeepMore live check ${label} ${new Date().toISOString()}` },
      expectedRawHash: c.rawHash,
      approvedBy: 'live-check',
    });
    if (!r.ok) throw new Error(`approve ${label} failed: ${r.code} ${(r.issues ?? []).join(',')}`);
    return r.approval;
  };

  step('A', 'Normal write');
  const before = await messageCount(deps, chosen.paypalDisputeId);
  console.log(`messages before: ${before}`);
  const apprA = await approve('A');
  const rA = await submitApprovedAction(deps, apprA.id);
  console.log('result:', JSON.stringify(rA));
  const afterA = await messageCount(deps, chosen.paypalDisputeId);
  console.log(`messages after: ${afterA}  (expected ${before === null ? '?' : before + 1})`);
  const rowA = await db.caseAction.findUniqueOrThrow({ where: { id: apprA.id } });
  console.log(`stored: httpStatus ${rowA.httpStatus}, submittedAt set: ${Boolean(rowA.submittedAt)}`);
  out.A = { result: rA, before, afterA, httpStatus: rowA.httpStatus, response: rowA.responseJson };

  step('B', 'Write reaches PayPal, answer lost');
  const apprB = await approve('B');
  let lost = true;
  const lossy: ActionDeps = {
    ...deps,
    paypal: {
      ...base.paypal,
      post: async (path: string, body?: unknown, options?: { requestId?: string }) => {
        const res = await base.paypal.post(path, body, options);
        if (lost) {
          lost = false;
          throw new TypeError('simulated lost answer');
        }
        return res;
      },
    } as ActionDeps['paypal'],
  };
  const rB1 = await submitApprovedAction(lossy, apprB.id);
  console.log('first submit:', JSON.stringify(rB1));
  const rB2 = await submitApprovedAction(deps, apprB.id);
  console.log('second submit:', JSON.stringify(rB2));
  const afterB = await messageCount(deps, chosen.paypalDisputeId);
  console.log(`messages after: ${afterB}  (expected ${afterA === null ? '?' : afterA + 1}: one write, never two)`);
  out.B = { first: rB1, second: rB2, afterB };

  step('C', 'Submit approval A again');
  const rC = await submitApprovedAction(deps, apprA.id);
  console.log('result:', JSON.stringify(rC), '(expected ALREADY_SUBMITTED)');
  const afterC = await messageCount(deps, chosen.paypalDisputeId);
  console.log(`messages: ${afterC} (unchanged from B: ${afterC === afterB})`);
  out.C = { result: rC, afterC };

  fs.mkdirSync('live-check-out', { recursive: true });
  fs.writeFileSync('live-check-out/t210-result.json', `${JSON.stringify(out, null, 2)}\n`);
  console.log('\nsaved: live-check-out/t210-result.json (gitignored). Paste the output above to Claude.');
}

main().catch((e) => {
  console.log(`CRASHED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
