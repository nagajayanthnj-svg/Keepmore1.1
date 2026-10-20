import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getAllowedActions } from '../../src/disputes/allowed-actions';
import { DisputeParseError } from '../../src/disputes/parse';
import { syncDispute, type SyncDeps } from '../../src/disputes/sync';
import type { Db } from '../../src/lib/db';
import { PayPalError, createPayPalClient } from '../../src/paypal/client';
import { createTestDb } from '../helpers/test-db';

const BASE = 'https://paypal.test';
const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/paypal/${n}.json`, 'utf8'));
const claim = fx('dispute-details-first'); // PP-R-IUT-10193562: accept_claim, provide_evidence
const review = fx('dispute-after-supporting-info'); // same dispute, under review: accept_claim, provide_supporting_info
const resolved = fx('t009-PP-R-IUT-10193562-accept-3-final'); // same dispute, resolved: nothing
const realError = fx('provide-evidence-response-v2').response; // a real PayPal error body; the test sets the status
const ID = 'PP-R-IUT-10193562';

const server = setupServer();
let db: Db;
let close: () => Promise<void>;
let deps: SyncDeps;
let gets = 0;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  gets = 0;
  deps = { db, paypal: createPayPalClient({ clientId: 'id', clientSecret: 's', baseUrl: BASE }) };
  server.use(http.post(`${BASE}/v1/oauth2/token`, () => HttpResponse.json({ access_token: 't', expires_in: 3600 })));
});
afterEach(async () => {
  server.resetHandlers();
  await close();
});

const serve = (body: unknown, status = 200) =>
  server.use(
    http.get(`${BASE}/v1/customer/disputes/:id`, () => {
      gets += 1;
      return HttpResponse.json(body as object, { status });
    }),
  );

describe('getAllowedActions: the gate reads PayPal fresh every time', () => {
  it('does a GET on every call and returns the actions with the hash of what it read', async () => {
    serve(claim);
    const a = await getAllowedActions(deps, ID);
    expect(a.allowed.actions.map((x) => x.action)).toEqual(['ACCEPT_CLAIM', 'PROVIDE_EVIDENCE']);
    expect(a).toMatchObject({ disputeId: ID, status: 'WAITING_FOR_SELLER_RESPONSE', stage: 'CHARGEBACK' });
    expect(a.rawHash).toMatch(/^[0-9a-f]{64}$/);
    await getAllowedActions(deps, ID);
    expect(gets).toBe(2);
  });

  it('follows the dispute as it changes and never answers from an earlier read', async () => {
    serve(claim);
    expect((await getAllowedActions(deps, ID)).allowed.actions.map((x) => x.action)).toContain('PROVIDE_EVIDENCE');
    serve(review);
    expect((await getAllowedActions(deps, ID)).allowed.actions.map((x) => x.action)).toEqual([
      'ACCEPT_CLAIM',
      'PROVIDE_SUPPORTING_INFO',
    ]);
    serve(resolved);
    expect((await getAllowedActions(deps, ID)).allowed.actions).toEqual([]);
  });

  it('ignores what a sync stored: a stored copy that allows more does not widen the gate', async () => {
    serve(claim);
    await syncDispute(deps, ID);
    await db.disputeCase.update({
      where: { paypalDisputeId: ID },
      data: { allowedActionsJson: JSON.stringify({ actions: [{ action: 'ESCALATE' }], acceptClaimTypes: [] }) },
    });
    serve(resolved);
    expect((await getAllowedActions(deps, ID)).allowed.actions).toEqual([]);
  });

  it('refuses an id that is not a dispute id without calling PayPal', async () => {
    await expect(getAllowedActions(deps, '../x')).rejects.toThrow(/dispute id/i);
    expect(gets).toBe(0);
  });

  it('passes a PayPal error up: no answer means no action', async () => {
    serve(realError, 500);
    await expect(getAllowedActions(deps, ID)).rejects.toBeInstanceOf(PayPalError);
  });

  it('refuses a payload for another dispute or one it cannot trust', async () => {
    serve(fx('dispute-details')); // PP-R-RAV-10193566
    await expect(getAllowedActions(deps, ID)).rejects.toBeInstanceOf(DisputeParseError);
    const bad = structuredClone(claim);
    delete bad.status;
    serve(bad);
    await expect(getAllowedActions(deps, ID)).rejects.toBeInstanceOf(DisputeParseError);
  });
});

describe('syncDispute stores a copy of the allowed actions for display', () => {
  it('writes it on create, and updates it when the dispute changes', async () => {
    serve(claim);
    await syncDispute(deps, ID);
    const stored = () =>
      db.disputeCase
        .findUniqueOrThrow({ where: { paypalDisputeId: ID } })
        .then((c) => JSON.parse(c.allowedActionsJson));
    expect((await stored()).actions.map((a: { action: string }) => a.action)).toEqual([
      'ACCEPT_CLAIM',
      'PROVIDE_EVIDENCE',
    ]);
    expect((await stored()).acceptClaimTypes).toEqual(['REFUND']);
    serve(resolved);
    await syncDispute(deps, ID);
    expect(await stored()).toEqual({ actions: [], acceptClaimTypes: [] });
  });

  it('fills it in for a case stored before this existed, even when nothing else changed', async () => {
    serve(claim);
    await syncDispute(deps, ID);
    await db.disputeCase.update({ where: { paypalDisputeId: ID }, data: { allowedActionsJson: '[]' } });
    await syncDispute(deps, ID); // same payload, same hash
    const c = await db.disputeCase.findUniqueOrThrow({ where: { paypalDisputeId: ID } });
    expect(JSON.parse(c.allowedActionsJson).actions).toHaveLength(2);
  });
});
