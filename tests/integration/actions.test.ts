import { readdirSync, readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { submitApprovedAction, type ActionDeps } from '../../src/disputes/actions';
import { approveAction } from '../../src/disputes/approval';
import { syncDispute } from '../../src/disputes/sync';
import { fixedClock } from '../../src/lib/clock';
import type { Db } from '../../src/lib/db';
import { createPayPalClient } from '../../src/paypal/client';
import { createTestDb } from '../helpers/test-db';

const BASE = 'https://paypal.test';
const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/paypal/${n}.json`, 'utf8'));
const IUT = 'PP-R-IUT-10193562';
const CLAIM = fx('dispute-details-first');
const RESOLVED = fx('t009-PP-R-IUT-10193562-accept-3-final');
const OK_BODY = fx('t010-PP-R-RAV-10193566-message-2-response').response.body;
const REAL_ERROR = fx('t009-PP-R-IUT-10193562-accept-2-response').response.body;
const T0 = '2026-10-20T10:00:00.000Z';

interface Posted {
  path: string;
  requestId: string | null;
  contentType: string | null;
  body: unknown;
}
let posts: Posted[];
let gets: number;
let state: unknown; // what GET returns now
let changeAfterPost: unknown; // what GET returns once a POST was accepted
let postStatuses: Array<{ status: number; body: unknown }>;
let getsAfterPost: number;
let applied: boolean;
let lag: number; // GETs after the POST that still show the old state

const server = setupServer();
let db: Db;
let close: () => Promise<void>;
let deps: ActionDeps;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  posts = [];
  gets = 0;
  getsAfterPost = 0;
  applied = false;
  lag = 0;
  state = CLAIM;
  changeAfterPost = RESOLVED;
  postStatuses = [{ status: 200, body: OK_BODY }];
  deps = {
    db,
    paypal: createPayPalClient({ clientId: 'id', clientSecret: 's', baseUrl: BASE }),
    clock: fixedClock(T0),
    sleep: async () => {},
    reread: { attempts: 5, delayMs: 1 },
    build: (action, payload) => ({ built: action, payload }),
  };
  server.use(
    http.post(`${BASE}/v1/oauth2/token`, () => HttpResponse.json({ access_token: 't', expires_in: 3600 })),
    http.get(`${BASE}/v1/customer/disputes/:id`, () => {
      gets += 1;
      if (applied) {
        getsAfterPost += 1;
        if (getsAfterPost > lag) state = changeAfterPost;
      }
      return HttpResponse.json(state as object);
    }),
    http.post(`${BASE}/v1/customer/disputes/:id/:action`, async ({ request, params }) => {
      posts.push({
        path: new URL(request.url).pathname,
        requestId: request.headers.get('paypal-request-id'),
        contentType: request.headers.get('content-type'),
        body: await request.json(),
      });
      void params;
      const next = postStatuses.length > 1 ? postStatuses.shift()! : postStatuses[0]!;
      if (next.status < 300) applied = true;
      return HttpResponse.json(next.body as object, { status: next.status });
    }),
  );
});
afterEach(async () => {
  server.resetHandlers();
  await close();
});

async function approved(
  payload: unknown = { note: 'Refunding in full.', acceptClaimType: 'REFUND' },
  action: 'ACCEPT_CLAIM' | 'PROVIDE_EVIDENCE' = 'ACCEPT_CLAIM',
) {
  await syncDispute(deps, IUT);
  const c = await db.disputeCase.findUniqueOrThrow({ where: { paypalDisputeId: IUT } });
  const r = await approveAction(deps, {
    caseId: c.id,
    action,
    payload,
    expectedRawHash: c.rawHash,
    approvedBy: 'seller',
  });
  if (!r.ok) throw new Error(r.code);
  return { c, id: r.approval.id, key: r.approval.idempotencyKey };
}

describe('submitApprovedAction: the one place a dispute write happens', () => {
  it('writes the approved payload once, with the approval key, then re-reads until the change shows and re-syncs', async () => {
    const { c, id, key } = await approved();
    lag = 2;
    const r = await submitApprovedAction(deps, id);
    expect(r).toMatchObject({ ok: true, outcome: 'APPLIED', httpStatus: 200 });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      path: `/v1/customer/disputes/${IUT}/accept-claim`,
      requestId: key,
      contentType: 'application/json',
      body: { built: 'ACCEPT_CLAIM', payload: { acceptClaimType: 'REFUND', note: 'Refunding in full.' } },
    });
    const row = await db.caseAction.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ httpStatus: 200 });
    expect(row.submittedAt).toEqual(new Date(T0));
    expect(JSON.parse(row.responseJson!)).toEqual(OK_BODY);
    expect((await db.disputeCase.findUniqueOrThrow({ where: { id: c.id } })).status).toBe(RESOLVED.status);
    const audit = await db.auditEvent.findMany({ where: { entityId: id, kind: 'SUBMITTED' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.detailJson).not.toContain('Refunding in full.');
  });

  it('says PENDING, keeps the response, and still syncs when the change has not shown after the last read', async () => {
    const { id } = await approved();
    changeAfterPost = CLAIM;
    const r = await submitApprovedAction(deps, id);
    expect(r).toMatchObject({ ok: true, outcome: 'PENDING', httpStatus: 200 });
    expect((await db.caseAction.findUniqueOrThrow({ where: { id } })).submittedAt).not.toBeNull();
  });
});

describe('the default request bodies (T-211)', () => {
  it('uses the real body for the action when no builder is given', async () => {
    const { build: _build, ...noBuild } = deps;
    void _build;
    const { id } = await approved();
    await submitApprovedAction(noBuild, id);
    expect(posts[0]!.body).toEqual({ note: 'Refunding in full.' });
  });

  it('a body that cannot be built sends nothing and leaves the approval usable', async () => {
    const { id } = await approved();
    const r = await submitApprovedAction(
      {
        ...deps,
        build: () => {
          throw new Error('boom');
        },
      },
      id,
    );
    expect(r).toMatchObject({ ok: false, code: 'INVALID_BODY' });
    expect(posts).toHaveLength(0);
    expect((await db.caseAction.findUniqueOrThrow({ where: { id } })).submittedAt).toBeNull();
  });
});

describe('what blocks a write', () => {
  it('no approval: nothing is sent', async () => {
    expect(await submitApprovedAction(deps, 'nope')).toMatchObject({ ok: false, code: 'NO_APPROVAL' });
    expect(posts).toHaveLength(0);
  });

  it('a stale case: nothing is sent, and PayPal is not even read', async () => {
    const { id } = await approved();
    gets = 0;
    const r = await submitApprovedAction({ ...deps, clock: fixedClock('2026-10-20T10:05:00.000Z') }, id);
    expect(r).toMatchObject({ ok: false, code: 'STALE' });
    expect(gets).toBe(0);
    expect(posts).toHaveLength(0);
  });

  it('rawHash changed since the approval: nothing is sent', async () => {
    const { id } = await approved();
    state = fx('dispute-after-supporting-info');
    expect(await submitApprovedAction(deps, id)).toMatchObject({ ok: false, code: 'STATE_CHANGED' });
    expect(posts).toHaveLength(0);
  });

  it('an action no longer in the fresh links: nothing is sent', async () => {
    const { id } = await approved();
    const moved = fx('t009-PP-R-IUT-10193562-accept-3-final'); // resolved: no links but self
    state = moved;
    // make the approval's state match, so only the gate can stop it
    const fresh = await import('../../src/disputes/parse').then((m) => m.disputeRawHash(moved));
    await db.caseAction.update({ where: { id }, data: { stateHashAtApproval: fresh } });
    expect(await submitApprovedAction(deps, id)).toMatchObject({ ok: false, code: 'ACTION_NOT_ALLOWED' });
    expect(posts).toHaveLength(0);
  });

  it('a payload edited after approval: nothing is sent', async () => {
    const { id } = await approved();
    await db.caseAction.update({
      where: { id },
      data: { payloadJson: JSON.stringify({ note: 'Refund MORE.', acceptClaimType: 'REFUND' }) },
    });
    expect(await submitApprovedAction(deps, id)).toMatchObject({ ok: false, code: 'PAYLOAD_MISMATCH' });
    expect(posts).toHaveLength(0);
  });

  it('an approval already used: no second write', async () => {
    const { id } = await approved();
    await submitApprovedAction(deps, id);
    expect(await submitApprovedAction(deps, id)).toMatchObject({ ok: false, code: 'ALREADY_SUBMITTED' });
    expect(posts).toHaveLength(1);
  });

  it('PayPal cannot be read: nothing is sent and the approval stays usable', async () => {
    const { id } = await approved();
    server.use(
      http.get(`${BASE}/v1/customer/disputes/:id`, () =>
        HttpResponse.json({ name: 'INTERNAL_SERVER_ERROR' }, { status: 500 }),
      ),
    );
    expect(await submitApprovedAction(deps, id)).toMatchObject({
      ok: false,
      code: 'PAYPAL_UNAVAILABLE',
      retryable: true,
    });
    expect(posts).toHaveLength(0);
    expect((await db.caseAction.findUniqueOrThrow({ where: { id } })).submittedAt).toBeNull();
  });
});

describe('failures at PayPal', () => {
  it('a server error leaves the approval unsent, and the retry reuses the same PayPal-Request-Id', async () => {
    const { id, key } = await approved();
    postStatuses = [
      { status: 503, body: { name: 'SERVICE_UNAVAILABLE' } },
      { status: 200, body: OK_BODY },
    ];
    const first = await submitApprovedAction(deps, id);
    expect(first).toMatchObject({ ok: false, code: 'PAYPAL_UNAVAILABLE', retryable: true });
    const row = await db.caseAction.findUniqueOrThrow({ where: { id } });
    expect(row.submittedAt).toBeNull();
    const second = await submitApprovedAction(deps, id);
    expect(second).toMatchObject({ ok: true });
    expect(posts.map((p) => p.requestId)).toEqual([key, key]);
  });

  it('a 400 is final: stored with its code and debug id, no payload text, and not retried', async () => {
    const { id } = await approved({ note: 'Private words about the buyer.', acceptClaimType: 'REFUND' });
    postStatuses = [{ status: 400, body: REAL_ERROR }];
    const r = await submitApprovedAction(deps, id);
    expect(r).toMatchObject({ ok: false, code: 'PAYPAL_REJECTED', httpStatus: 400, paypalCode: REAL_ERROR.name });
    const row = await db.caseAction.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ httpStatus: 400 });
    expect(row.submittedAt).not.toBeNull();
    expect(row.responseJson).toContain(REAL_ERROR.name);
    expect(row.responseJson).not.toContain('Private words');
    expect(await submitApprovedAction(deps, id)).toMatchObject({ ok: false, code: 'ALREADY_SUBMITTED' });
    expect(posts).toHaveLength(1);
  });
});

describe('the rule: PayPal dispute writes live in src/disputes/actions.ts only', () => {
  it('no other file in src/disputes posts to PayPal', () => {
    const files = readdirSync('src/disputes').filter((f) => f.endsWith('.ts') && f !== 'actions.ts');
    for (const f of files) {
      expect(readFileSync(`src/disputes/${f}`, 'utf8'), f).not.toMatch(/\.(post|put|patch|delete)\s*[<(]/);
    }
  });
});
