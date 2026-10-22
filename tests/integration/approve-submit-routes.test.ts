import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleApprove, handleSubmit } from '../../src/disputes/http-handlers';
import type { ActionDeps } from '../../src/disputes/actions';
import { syncDispute } from '../../src/disputes/sync';
import type { Db } from '../../src/lib/db';
import { fixedClock } from '../../src/lib/clock';
import { createPayPalClient } from '../../src/paypal/client';
import { createTestDb } from '../helpers/test-db';

const BASE = 'https://paypal.test';
const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/paypal/${n}.json`, 'utf8'));
const IUT = 'PP-R-IUT-10193562'; // claim stage: accept_claim (REFUND), provide_evidence; 120.00
const CLAIM = fx('dispute-details-first');
const RESOLVED = fx('t009-PP-R-IUT-10193562-accept-3-final');
const OK_BODY = fx('t010-PP-R-RAV-10193566-message-2-response').response.body;
const T0 = '2026-10-20T10:00:00.000Z';

const server = setupServer();
let db: Db;
let close: () => Promise<void>;
let deps: ActionDeps;
let state: unknown;
let posts = 0;
let postStatus = 200;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  state = CLAIM;
  posts = 0;
  postStatus = 200;
  deps = {
    db,
    paypal: createPayPalClient({ clientId: 'id', clientSecret: 's', baseUrl: BASE }),
    clock: fixedClock(T0),
    sleep: async () => {},
    reread: { attempts: 3, delayMs: 1 },
  };
  server.use(
    http.post(`${BASE}/v1/oauth2/token`, () => HttpResponse.json({ access_token: 't', expires_in: 3600 })),
    http.get(`${BASE}/v1/customer/disputes/:id`, () => HttpResponse.json(state as object)),
    http.post(`${BASE}/v1/customer/disputes/:id/:action`, () => {
      posts++;
      if (postStatus < 300) state = RESOLVED;
      return HttpResponse.json(postStatus < 300 ? OK_BODY : { name: 'INTERNAL_SERVER_ERROR', debug_id: 'abc' }, { status: postStatus });
    }),
  );
  await syncDispute(deps, IUT);
});
afterEach(async () => {
  server.resetHandlers();
  await close();
});

const rawHash = async () => (await db.disputeCase.findUniqueOrThrow({ where: { paypalDisputeId: IUT } })).rawHash;
const accept = async (over: Record<string, unknown> = {}) => ({
  action: 'ACCEPT_CLAIM',
  payload: { note: 'Refunding in full.', acceptClaimType: 'REFUND' },
  expectedRawHash: await rawHash(),
  ...over,
});

describe('POST /api/disputes/[id]/approve', () => {
  it('201 with the approval id and the payload hash the seller approved', async () => {
    const res = await handleApprove(deps, IUT, await accept());
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.approvalId).toMatch(/^[a-z0-9]{20,40}$/i);
    expect(j.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(posts).toBe(0); // approving writes nothing to PayPal
  });
  it('409 CASE_CHANGED when the screen was showing an older state', async () => {
    const res = await handleApprove(deps, IUT, await accept({ expectedRawHash: 'f'.repeat(64) }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'CASE_CHANGED' });
  });
  it('403 ACTION_NOT_ALLOWED for an action PayPal does not offer now', async () => {
    const res = await handleApprove(deps, IUT, await accept({ action: 'SEND_MESSAGE', payload: { message: 'Hello' } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'ACTION_NOT_ALLOWED' });
  });
  it('422 INVALID_PAYLOAD with the issues', async () => {
    const res = await handleApprove(deps, IUT, await accept({ payload: { acceptClaimType: 'REFUND', note: '' } }));
    expect(res.status).toBe(422);
    expect((await res.json()).issues.length).toBeGreaterThan(0);
  });
  it('400 for a malformed body or id, 404 for an unknown dispute, 409 for a demo case', async () => {
    expect((await handleApprove(deps, IUT, { action: 'REFUND_NOW' })).status).toBe(400);
    expect((await handleApprove(deps, 'nope', await accept())).status).toBe(400);
    expect((await handleApprove(deps, 'PP-R-AAA-10000000', await accept())).status).toBe(404);
    expect((await handleApprove(deps, 'PP-DEMO-0001', await accept())).status).toBe(409);
  });
  it('500 when the server has no PayPal credentials', async () => {
    expect((await handleApprove(null, IUT, await accept())).status).toBe(500);
  });
});

describe('POST /api/approvals/[id]/submit', () => {
  const approve = async () => (await (await handleApprove(deps, IUT, await accept())).json()).approvalId as string;

  it('200 APPLIED after the change shows on a re-read', async () => {
    const res = await handleSubmit(deps, await approve());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: 'APPLIED' });
    expect(posts).toBe(1);
  });
  it('409 ALREADY_SUBMITTED when the same approval is sent twice', async () => {
    const id = await approve();
    await handleSubmit(deps, id);
    const res = await handleSubmit(deps, id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'ALREADY_SUBMITTED' });
    expect(posts).toBe(1);
  });
  it('a PayPal 5xx is reported with retryable and the debug id, never as success', async () => {
    postStatus = 500;
    const res = await handleSubmit(deps, await approve());
    expect(res.ok).toBe(false);
    const j = await res.json();
    expect(j.error).toMatch(/PAYPAL_/);
    expect(j).toHaveProperty('retryable');
    expect(j.outcome).toBeUndefined();
  });
  it('404 for an unknown approval, 400 for a malformed id', async () => {
    expect((await handleSubmit(deps, 'c'.repeat(25))).status).toBe(404);
    expect((await handleSubmit(deps, '../x')).status).toBe(400);
  });
});
