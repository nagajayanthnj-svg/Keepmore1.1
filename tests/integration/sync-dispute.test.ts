import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DisputeParseError } from '../../src/disputes/parse';
import { syncDispute, type SyncDeps } from '../../src/disputes/sync';
import type { Db } from '../../src/lib/db';
import { PayPalError, createPayPalClient } from '../../src/paypal/client';
import { handleWebhook, type WebhookDeps } from '../../src/webhooks/receiver';
import { createTestDb } from '../helpers/test-db';

const BASE = 'https://paypal.test';
const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/paypal/${n}.json`, 'utf8'));
const chargeback = fx('dispute-details-first'); // PP-R-IUT-10193562, 120.00, waiting for seller, deadline 2026-10-22
const resolved = fx('t009-PP-R-IUT-10193562-accept-3-final'); // same dispute, RESOLVED_BUYER_FAVOUR
const realError = fx('provide-evidence-response-v2').response; // a real PayPal error body; the test sets the status
const ID = 'PP-R-IUT-10193562';
const T1 = new Date('2026-10-21T10:00:00Z');
const T2 = new Date('2026-10-21T10:05:00Z');

const server = setupServer();
let db: Db;
let close: () => Promise<void>;
let now = T1;
let requests: string[] = [];
let deps: SyncDeps;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  now = T1;
  requests = [];
  deps = { db, paypal: createPayPalClient({ clientId: 'id', clientSecret: 's', baseUrl: BASE }), clock: () => now };
  server.use(http.post(`${BASE}/v1/oauth2/token`, () => HttpResponse.json({ access_token: 't', expires_in: 3600 })));
});
afterEach(async () => {
  server.resetHandlers();
  await close();
});

const serve = (body: unknown, status = 200) =>
  server.use(
    http.get(`${BASE}/v1/customer/disputes/:id`, ({ params }) => {
      requests.push(String(params.id));
      return HttpResponse.json(body as object, { status });
    }),
  );
const cases = () => db.disputeCase.findMany();

describe('syncDispute: first sync', () => {
  it('reads the dispute from PayPal and stores the case', async () => {
    serve(chargeback);
    const r = await syncDispute(deps, ID);
    expect(requests).toEqual([ID]);
    expect(r).toMatchObject({ disputeId: ID, created: true, changed: true });
    const [c] = await cases();
    expect(c).toMatchObject({
      paypalDisputeId: ID,
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      stage: 'CHARGEBACK',
      status: 'WAITING_FOR_SELLER_RESPONSE',
      amountMinor: 12000,
      currency: 'USD',
      outcomeCode: null,
      orderId: null,
      buyerHash: null,
    });
    // A display copy of the allowed actions (T-204); the gate itself is a fresh GET and never reads this.
    expect(JSON.parse(c!.allowedActionsJson).actions.map((a: { action: string }) => a.action)).toEqual([
      'ACCEPT_CLAIM',
      'PROVIDE_EVIDENCE',
    ]);
    expect(c!.sellerDeadline).toEqual(new Date('2026-10-22T18:29:59.000Z'));
    expect(JSON.parse(c!.requestedEvidence)).toEqual([
      'PROOF_OF_FULFILLMENT',
      'PROOF_OF_REFUND',
      'PROOF_OF_DELIVERY_SIGNATURE',
    ]);
    expect(c!.lastSyncedAt).toEqual(T1);
    expect(c!.rawHash).toBe(r.rawHash);
  });

  it('stores no buyer or seller data from the payload', async () => {
    serve(chargeback);
    await syncDispute(deps, ID);
    const dump = JSON.stringify(await cases());
    expect(dump).not.toContain('REDACTED');
    expect(dump).not.toContain('dasasd'); // the buyer's message
  });
});

describe('syncDispute: syncing again', () => {
  it('an unchanged dispute only moves lastSyncedAt', async () => {
    serve(chargeback);
    const a = await syncDispute(deps, ID);
    const [before] = await cases();
    now = T2;
    const b = await syncDispute(deps, ID);
    expect(b).toMatchObject({ created: false, changed: false, rawHash: a.rawHash });
    const rows = await cases();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: before!.id, rawHash: before!.rawHash, status: before!.status });
    expect(rows[0]!.lastSyncedAt).toEqual(T2);
  });

  it('a link order that PayPal shuffled is not a change', async () => {
    serve(chargeback);
    await syncDispute(deps, ID);
    const shuffled = structuredClone(chargeback);
    shuffled.links = [...shuffled.links].reverse();
    serve(shuffled);
    now = T2;
    expect(await syncDispute(deps, ID)).toMatchObject({ changed: false });
  });

  it('a changed dispute updates the same row and says so', async () => {
    serve(chargeback);
    const a = await syncDispute(deps, ID);
    const [before] = await cases();
    serve(resolved);
    now = T2;
    const b = await syncDispute(deps, ID);
    expect(b).toMatchObject({ created: false, changed: true });
    expect(b.rawHash).not.toBe(a.rawHash);
    const rows = await cases();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: before!.id,
      status: 'RESOLVED',
      outcomeCode: 'RESOLVED_BUYER_FAVOUR',
      sellerDeadline: null,
      requestedEvidence: '[]',
      rawHash: b.rawHash,
    });
    expect(rows[0]!.lastSyncedAt).toEqual(T2);
  });

  it('keeps the order link and buyer hash that other steps set', async () => {
    const order = await db.order.create({
      data: {
        paypalOrderId: 'O1',
        captureId: '0HE26749YS519313U',
        itemsJson: '[]',
        country: 'US',
        grossMinor: 12000,
        currency: 'USD',
      },
    });
    await db.disputeCase.create({
      data: {
        paypalDisputeId: ID,
        orderId: order.id,
        buyerHash: 'abc',
        reason: 'x',
        stage: 'INQUIRY',
        status: 'OPEN',
        amountMinor: 1,
        currency: 'USD',
        allowedActionsJson: '[]',
        requestedEvidence: '[]',
        lastSyncedAt: T1,
        rawHash: 'old',
      },
    });
    serve(chargeback);
    await syncDispute(deps, ID);
    expect((await cases())[0]).toMatchObject({
      orderId: order.id,
      buyerHash: 'abc',
      stage: 'CHARGEBACK',
      amountMinor: 12000,
    });
  });

  it('five syncs of a new dispute at once leave one row and none of them fails', async () => {
    serve(chargeback);
    const all = await Promise.all(Array.from({ length: 5 }, () => syncDispute(deps, ID)));
    expect(all).toHaveLength(5);
    expect(await cases()).toHaveLength(1);
  });
});

describe('syncDispute: failures change nothing', () => {
  it('refuses an id that is not a dispute id without calling PayPal', async () => {
    await expect(syncDispute(deps, '../orders/x')).rejects.toThrow(/dispute id/i);
    await expect(syncDispute(deps, '')).rejects.toThrow(/dispute id/i);
    expect(requests).toHaveLength(0); // an unhandled PayPal request would also fail the run
  });

  it('passes a PayPal error up and stores nothing', async () => {
    serve(realError, 404);
    await expect(syncDispute(deps, ID)).rejects.toBeInstanceOf(PayPalError);
    expect(await cases()).toHaveLength(0);
  });

  it('a payload it cannot trust is an error and leaves the stored case as it was', async () => {
    serve(chargeback);
    await syncDispute(deps, ID);
    const before = (await cases())[0]!;
    const bad = structuredClone(chargeback);
    bad.dispute_amount = { currency_code: 'USD', value: '12.345' };
    serve(bad);
    now = T2;
    await expect(syncDispute(deps, ID)).rejects.toBeInstanceOf(DisputeParseError);
    expect((await cases())[0]).toEqual(before);
  });

  it('refuses a payload for a different dispute than the one asked for', async () => {
    serve(fx('dispute-details')); // PP-R-RAV-10193566
    await expect(syncDispute(deps, ID)).rejects.toBeInstanceOf(DisputeParseError);
    expect(await cases()).toHaveLength(0);
  });
});

describe('a webhook ends in a stored case', () => {
  it('a verified dispute event makes the receiver sync that dispute', async () => {
    serve(fx('t009-PP-R-RAV-10193566-adjudicate-3-final')); // PP-R-RAV-10193566, resolved in the seller's favour
    const event = fx('webhook-customer-dispute-resolved-86105147-cbed-11f1-9883-c743da698d78');
    const deferred: Promise<unknown>[] = [];
    const hook: WebhookDeps = {
      db,
      verify: async () => true,
      syncDispute: async (id) => {
        await syncDispute(deps, id);
      },
      defer: (p) => {
        deferred.push(p);
      },
      clock: () => now,
    };
    const res = await handleWebhook(
      new Request('http://x', { method: 'POST', headers: event.headers, body: JSON.stringify(event.body) }),
      hook,
    );
    await Promise.all(deferred);
    expect(res.status).toBe(200);
    expect(requests).toEqual(['PP-R-RAV-10193566']);
    expect(await cases()).toMatchObject([
      { paypalDisputeId: 'PP-R-RAV-10193566', status: 'RESOLVED', outcomeCode: 'RESOLVED_SELLER_FAVOUR' },
    ]);
    expect((await db.webhookEvent.findMany())[0]).toMatchObject({ result: 'SYNC_REQUESTED' });
  });
});
