import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { approveAction, verifyApproval, type ApprovalDeps } from '../../src/disputes/approval';
import { payloadHash } from '../../src/disputes/approval-payload';
import { syncDispute } from '../../src/disputes/sync';
import type { Db } from '../../src/lib/db';
import { fixedClock } from '../../src/lib/clock';
import { createPayPalClient } from '../../src/paypal/client';
import { createTestDb } from '../helpers/test-db';

const BASE = 'https://paypal.test';
const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/paypal/${n}.json`, 'utf8'));
const IUT = 'PP-R-IUT-10193562'; // claim stage: accept_claim (REFUND only), provide_evidence; 120.00
const RAV = 'PP-R-RAV-10193566'; // claim stage: accept_claim (REFUND, PARTIAL_REFUND), provide_evidence; 50.00
const bodies: Record<string, unknown> = {};
let gets = 0;

const server = setupServer();
let db: Db;
let close: () => Promise<void>;
let deps: ApprovalDeps;
const T0 = '2026-10-20T10:00:00.000Z';
const at = (iso: string) => ({ ...deps, clock: fixedClock(iso) });

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  gets = 0;
  bodies[IUT] = fx('dispute-details-first');
  bodies[RAV] = fx('dispute-details');
  deps = {
    db,
    paypal: createPayPalClient({ clientId: 'id', clientSecret: 's', baseUrl: BASE }),
    clock: fixedClock(T0),
  };
  server.use(
    http.post(`${BASE}/v1/oauth2/token`, () => HttpResponse.json({ access_token: 't', expires_in: 3600 })),
    http.get(`${BASE}/v1/customer/disputes/:id`, ({ params }) => {
      gets += 1;
      return HttpResponse.json(bodies[String(params.id)] as object);
    }),
  );
});
afterEach(async () => {
  server.resetHandlers();
  await close();
});

const caseOf = async (id = IUT) => {
  await syncDispute(deps, id);
  return db.disputeCase.findUniqueOrThrow({ where: { paypalDisputeId: id } });
};
const input = (c: { id: string; rawHash: string }, over: Record<string, unknown> = {}) => ({
  caseId: c.id,
  action: 'ACCEPT_CLAIM' as const,
  payload: { note: 'Refunding in full.', acceptClaimType: 'REFUND' },
  expectedRawHash: c.rawHash,
  approvedBy: 'seller',
  ...over,
});

describe('approveAction: the seller approves one exact payload', () => {
  it('stores the payload, both hashes, a fresh idempotency key and an audit row', async () => {
    const c = await caseOf();
    const r = await approveAction(deps, input(c));
    if (!r.ok) throw new Error(r.code);
    expect(r).toMatchObject({ created: true });
    const row = await db.caseAction.findUniqueOrThrow({ where: { id: r.approval.id } });
    expect(row).toMatchObject({
      caseId: c.id,
      action: 'ACCEPT_CLAIM',
      approvedBy: 'seller',
      stateHashAtApproval: c.rawHash,
      payloadHash: payloadHash('ACCEPT_CLAIM', { note: 'Refunding in full.', acceptClaimType: 'REFUND' }),
      submittedAt: null,
      httpStatus: null,
    });
    expect(row.approvedAt).toEqual(new Date(T0));
    expect(JSON.parse(row.payloadJson)).toEqual({ acceptClaimType: 'REFUND', note: 'Refunding in full.' });
    expect(row.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    const audit = await db.auditEvent.findMany({ where: { entity: 'CaseAction', entityId: row.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.kind).toBe('APPROVED');
    expect(audit[0]!.detailJson).not.toContain('Refunding in full.'); // a note can hold buyer data
    expect(JSON.parse(audit[0]!.detailJson)).toMatchObject({ action: 'ACCEPT_CLAIM', payloadHash: row.payloadHash });
  });

  it('approving the same thing twice returns the same approval and key, not a second row', async () => {
    const c = await caseOf();
    const a = await approveAction(deps, input(c));
    const b = await approveAction(deps, input(c));
    if (!a.ok || !b.ok) throw new Error('refused');
    expect(b).toMatchObject({ created: false });
    expect(b.approval.id).toBe(a.approval.id);
    expect(b.approval.idempotencyKey).toBe(a.approval.idempotencyKey);
    expect(await db.caseAction.count()).toBe(1);
    const other = await approveAction(deps, input(c, { payload: { note: 'Different.', acceptClaimType: 'REFUND' } }));
    if (!other.ok) throw new Error('refused');
    expect(other.approval.idempotencyKey).not.toBe(a.approval.idempotencyKey);
    expect(await db.caseAction.count()).toBe(2);
  });

  it('refuses a stale case before asking PayPal anything', async () => {
    const c = await caseOf();
    gets = 0;
    const r = await approveAction(at('2026-10-20T10:05:00.000Z'), input(c));
    expect(r).toMatchObject({ ok: false, code: 'STALE' });
    expect(gets).toBe(0);
    expect(await db.caseAction.count()).toBe(0);
    expect(await approveAction(at('2026-10-20T10:04:59.000Z'), input(c))).toMatchObject({ ok: true });
  });

  it('refuses an action PayPal does not allow now, read from a fresh GET and not from the stored copy', async () => {
    const c = await caseOf();
    const escalate = await approveAction(deps, input(c, { action: 'ESCALATE', payload: { note: 'x' } }));
    expect(escalate).toMatchObject({ ok: false, code: 'ACTION_NOT_ALLOWED' });
    await db.disputeCase.update({
      where: { id: c.id },
      data: { allowedActionsJson: JSON.stringify({ actions: [{ action: 'ESCALATE' }], acceptClaimTypes: [] }) },
    });
    expect(await approveAction(deps, input(c, { action: 'ESCALATE', payload: { note: 'x' } }))).toMatchObject({
      ok: false,
      code: 'ACTION_NOT_ALLOWED',
    });
  });

  it('refuses everything on a resolved dispute', async () => {
    bodies[IUT] = fx('t009-PP-R-IUT-10193562-accept-3-final');
    const c = await caseOf();
    expect(await approveAction(deps, input(c))).toMatchObject({ ok: false, code: 'ACTION_NOT_ALLOWED' });
  });

  it('refuses when the dispute is not what the seller was looking at', async () => {
    const c = await caseOf();
    expect(await approveAction(deps, input(c, { expectedRawHash: 'f'.repeat(64) }))).toMatchObject({
      ok: false,
      code: 'CASE_CHANGED',
    });
    // PayPal changed it after our last sync: the fresh GET shows a different state
    bodies[IUT] = fx('dispute-after-supporting-info');
    expect(await approveAction(deps, input(c))).toMatchObject({ ok: false, code: 'CASE_CHANGED' });
    expect(await db.caseAction.count()).toBe(0);
  });

  it('checks the refund type and amount against what PayPal offers and the dispute amount', async () => {
    const partial = { note: 'Partial.', acceptClaimType: 'PARTIAL_REFUND', refundAmountMinor: 2000 };
    const iut = await caseOf(IUT); // offers REFUND only
    expect(await approveAction(deps, input(iut, { payload: partial }))).toMatchObject({
      ok: false,
      code: 'TYPE_NOT_OFFERED',
    });
    const rav = await caseOf(RAV); // offers REFUND and PARTIAL_REFUND, 50.00
    expect(await approveAction(deps, input(rav, { payload: partial }))).toMatchObject({ ok: true });
    expect(await approveAction(deps, input(rav, { payload: { ...partial, refundAmountMinor: 5001 } }))).toMatchObject({
      ok: false,
      code: 'INVALID_PAYLOAD',
    });
  });

  it('refuses an invalid payload with field names only, and stores nothing', async () => {
    const c = await caseOf();
    const r = await approveAction(deps, input(c, { payload: { note: 'SECRET@buyer.com', acceptClaimType: 'NOPE' } }));
    expect(r).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
    expect(JSON.stringify(r)).not.toContain('SECRET');
    expect(await db.caseAction.count()).toBe(0);
  });

  it('refuses an unknown case, and an approver that is not a plain name', async () => {
    expect(await approveAction(deps, input({ id: 'nope', rawHash: 'x' }))).toMatchObject({
      ok: false,
      code: 'CASE_NOT_FOUND',
    });
    const c = await caseOf();
    for (const who of ['', 'a@b.com', 'x'.repeat(65), '<b>']) {
      expect(await approveAction(deps, input(c, { approvedBy: who }))).toMatchObject({
        ok: false,
        code: 'INVALID_APPROVER',
      });
    }
  });
});

describe('verifyApproval: what the action service (T-210) runs before it writes', () => {
  const approved = async () => {
    const c = await caseOf();
    const r = await approveAction(deps, input(c));
    if (!r.ok) throw new Error(r.code);
    return { c, id: r.approval.id };
  };

  it('passes when nothing changed and returns the payload to send and the key', async () => {
    const { c, id } = await approved();
    const v = await verifyApproval(db, id, { currentRawHash: c.rawHash });
    expect(v).toMatchObject({
      ok: true,
      action: 'ACCEPT_CLAIM',
      payload: { note: 'Refunding in full.', acceptClaimType: 'REFUND' },
    });
    if (v.ok) expect(v.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('fails on a hash mismatch when the stored payload is edited after approval', async () => {
    const { c, id } = await approved();
    await db.caseAction.update({
      where: { id },
      data: { payloadJson: JSON.stringify({ note: 'Refunding in full.', acceptClaimType: 'REFUND', extra: 1 }) },
    });
    expect(await verifyApproval(db, id, { currentRawHash: c.rawHash })).toMatchObject({
      ok: false,
      code: 'PAYLOAD_MISMATCH',
    });
    await db.caseAction.update({
      where: { id },
      data: { payloadJson: JSON.stringify({ note: 'Refund MORE.', acceptClaimType: 'REFUND' }) },
    });
    expect(await verifyApproval(db, id, { currentRawHash: c.rawHash })).toMatchObject({
      ok: false,
      code: 'PAYLOAD_MISMATCH',
    });
  });

  it('fails when the caller offers a different payload than the approved one', async () => {
    const { c, id } = await approved();
    const v = await verifyApproval(db, id, {
      currentRawHash: c.rawHash,
      payload: { note: 'Something else.', acceptClaimType: 'REFUND' },
    });
    expect(v).toMatchObject({ ok: false, code: 'PAYLOAD_MISMATCH' });
    const same = await verifyApproval(db, id, {
      currentRawHash: c.rawHash,
      payload: { acceptClaimType: 'REFUND', note: 'Refunding in full.' },
    });
    expect(same).toMatchObject({ ok: true });
  });

  it('fails when the dispute changed since the approval', async () => {
    const { id } = await approved();
    expect(await verifyApproval(db, id, { currentRawHash: 'e'.repeat(64) })).toMatchObject({
      ok: false,
      code: 'STATE_CHANGED',
    });
  });

  it('fails for an unknown approval and for one already submitted', async () => {
    expect(await verifyApproval(db, 'nope', { currentRawHash: 'x' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    const { c, id } = await approved();
    await db.caseAction.update({ where: { id }, data: { submittedAt: new Date(T0), httpStatus: 200 } });
    expect(await verifyApproval(db, id, { currentRawHash: c.rawHash })).toMatchObject({
      ok: false,
      code: 'ALREADY_SUBMITTED',
    });
  });
});
