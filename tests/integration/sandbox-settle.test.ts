import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { submitApprovedAction, submitSandboxSettle, type ActionDeps } from '../../src/disputes/actions';
import { approveAction } from '../../src/disputes/approval';
import { sandboxAdjudicatePath } from '../../src/disputes/allowed-actions';
import { approveSandboxSettle } from '../../src/disputes/sandbox-settle';
import { handleSettleApprove, handleSettleSubmit } from '../../src/disputes/http-handlers';
import { syncDispute } from '../../src/disputes/sync';
import type { Db } from '../../src/lib/db';
import { fixedClock } from '../../src/lib/clock';
import { createPayPalClient } from '../../src/paypal/client';
import { createTestDb } from '../helpers/test-db';

const BASE = 'https://paypal.test';
const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/paypal/${n}.json`, 'utf8'));
const ID = 'PP-R-RAV-10193566';
const BEFORE = fx('t009-PP-R-RAV-10193566-adjudicate-1-before'); // UNDER_REVIEW, adjudicate link offered
const SENT = fx('t009-PP-R-RAV-10193566-adjudicate-2-response'); // the real request and response
const FINAL = fx('t009-PP-R-RAV-10193566-adjudicate-3-final'); // RESOLVED_SELLER_FAVOUR
const T0 = '2026-10-19T18:45:04.000Z';

const server = setupServer();
let db: Db;
let close: () => Promise<void>;
let state: unknown;
let posted: { path: string; body: unknown; requestId: string | null }[];
let deps: ActionDeps & { demoMode: boolean };

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  state = BEFORE;
  posted = [];
  deps = {
    db,
    paypal: createPayPalClient({ clientId: 'id', clientSecret: 's', baseUrl: BASE }),
    clock: fixedClock(T0),
    sleep: async () => {},
    reread: { attempts: 3, delayMs: 1 },
    demoMode: true,
  };
  server.use(
    http.post(`${BASE}/v1/oauth2/token`, () => HttpResponse.json({ access_token: 't', expires_in: 3600 })),
    http.get(`${BASE}/v1/customer/disputes/:id`, () => HttpResponse.json(state as object)),
    http.post(`${BASE}/v1/customer/disputes/:id/:action`, async ({ request }) => {
      posted.push({ path: new URL(request.url).pathname, body: await request.json(), requestId: request.headers.get('paypal-request-id') });
      state = FINAL;
      return HttpResponse.json(SENT.response.body, { status: 200 });
    }),
  );
  await db.order.create({
    data: {
      paypalOrderId: 'ORD-RAV',
      captureId: '3FG688039F4865201',
      itemsJson: '[]',
      country: 'US',
      grossMinor: 5000,
      currency: 'USD',
      buyerHash: 'b'.repeat(64),
      sellerProtection: 'ELIGIBLE',
    },
  });
  await syncDispute(deps, ID);
});
afterEach(async () => {
  server.resetHandlers();
  await close();
});

const theCase = () => db.disputeCase.findUniqueOrThrow({ where: { paypalDisputeId: ID } });
const approve = async (outcome = 'SELLER_FAVOR') => {
  const c = await theCase();
  return approveSandboxSettle(deps, { caseId: c.id, outcome, expectedRawHash: c.rawHash, approvedBy: 'seller' });
};

describe('sandbox-simulated adjudication (T-402)', () => {
  it('the adjudicate link is read from a fresh GET, and is not a seller action', () => {
    expect(sandboxAdjudicatePath(BEFORE)).toBe(`/v1/customer/disputes/${ID}/adjudicate`);
    expect(sandboxAdjudicatePath(FINAL)).toBeNull();
  });

  it('approve then send posts the body PayPal accepted in T-009, once, then re-reads and records the outcome', async () => {
    const a = await approve();
    if (!a.ok) throw new Error(a.code);
    expect(posted).toHaveLength(0); // approving sends nothing
    const r = await submitSandboxSettle(deps, a.approval.id);
    expect(r).toMatchObject({ ok: true, outcome: 'APPLIED' });
    expect(posted).toEqual([{ path: `/v1/customer/disputes/${ID}/adjudicate`, body: SENT.request.body, requestId: a.approval.idempotencyKey }]);
    const c = await theCase();
    expect(c.outcomeCode).toBe('RESOLVED_SELLER_FAVOUR');
    expect(await db.ledgerEntry.findMany({ where: { sourceRef: ID }, select: { type: true, amountMinor: true } })).toEqual([
      { type: 'RETAINED', amountMinor: 5000 },
    ]);
    expect(await submitSandboxSettle(deps, a.approval.id)).toMatchObject({ ok: false, code: 'ALREADY_SUBMITTED' });
  });

  it('refused when DEMO_MODE is off, before anything is asked of PayPal', async () => {
    const off = { ...deps, demoMode: false };
    const c = await theCase();
    expect(await approveSandboxSettle(off, { caseId: c.id, outcome: 'SELLER_FAVOR', expectedRawHash: c.rawHash, approvedBy: 'seller' })).toEqual({
      ok: false,
      code: 'DEMO_MODE_OFF',
    });
    const a = await approve();
    if (!a.ok) throw new Error(a.code);
    expect(await submitSandboxSettle(off, a.approval.id)).toMatchObject({ ok: false, code: 'DEMO_MODE_OFF' });
    expect(posted).toHaveLength(0);
  });

  it('refused when PayPal does not offer the adjudicate link yet', async () => {
    state = FINAL;
    await syncDispute(deps, ID);
    const a = await approve();
    expect(a).toMatchObject({ ok: false, code: 'NOT_OFFERED' });
  });

  it('refuses an outcome other than the two PayPal documents', async () => {
    expect(await approve('SPLIT')).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
  });

  it('a settle approval cannot go through the seller send path, and a seller approval cannot settle', async () => {
    const a = await approve();
    if (!a.ok) throw new Error(a.code);
    expect(await submitApprovedAction(deps, a.approval.id)).toMatchObject({ ok: false, code: 'ACTION_NOT_ALLOWED' });
    const c = await theCase();
    const seller = await approveAction(deps, {
      caseId: c.id,
      action: 'ACCEPT_CLAIM',
      payload: { note: 'ok', acceptClaimType: 'REFUND' },
      expectedRawHash: c.rawHash,
      approvedBy: 'seller',
    });
    if (!seller.ok) throw new Error(seller.code);
    expect(await submitSandboxSettle(deps, seller.approval.id)).toMatchObject({ ok: false, code: 'NOT_A_SETTLE_APPROVAL' });
    expect(posted).toHaveLength(0);
  });

  it('the routes answer 404 when DEMO_MODE is off', async () => {
    const off = { ...deps, demoMode: false };
    const c = await theCase();
    expect((await handleSettleApprove(off, ID, { outcome: 'SELLER_FAVOR', expectedRawHash: c.rawHash })).status).toBe(404);
    expect((await handleSettleSubmit(off, 'c'.repeat(25))).status).toBe(404);
    const ok = await handleSettleApprove(deps, ID, { outcome: 'SELLER_FAVOR', expectedRawHash: c.rawHash });
    expect(ok.status).toBe(201);
    const id = (await ok.json()).approvalId as string;
    const sent = await handleSettleSubmit(deps, id);
    expect(sent.status).toBe(200);
    expect(await sent.json()).toMatchObject({ outcome: 'APPLIED', label: 'Sandbox-simulated adjudication' });
  });
});
