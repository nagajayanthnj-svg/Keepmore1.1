import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleManualSync } from '../../src/disputes/manual-sync';
import { pollOnce } from '../../src/disputes/poller';
import type { SyncDeps } from '../../src/disputes/sync';
import type { Db } from '../../src/lib/db';
import { createPayPalClient } from '../../src/paypal/client';
import { createTestDb } from '../helpers/test-db';

const BASE = 'https://paypal.test';
const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/paypal/${n}.json`, 'utf8'));
const IUT = 'PP-R-IUT-10193562';
const RAV = 'PP-R-RAV-10193566';
const bodies: Record<string, unknown> = { [IUT]: fx('dispute-details-first'), [RAV]: fx('dispute-details') };
const resolved = fx('t009-PP-R-IUT-10193562-accept-3-final');

const server = setupServer();
let db: Db;
let close: () => Promise<void>;
let deps: SyncDeps;
let detailGets: string[] = [];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  detailGets = [];
  deps = { db, paypal: createPayPalClient({ clientId: 'id', clientSecret: 's', baseUrl: BASE }) };
  server.use(
    http.post(`${BASE}/v1/oauth2/token`, () => HttpResponse.json({ access_token: 't', expires_in: 3600 })),
    http.get(`${BASE}/v1/customer/disputes/:id`, ({ params }) => {
      const id = String(params.id);
      detailGets.push(id);
      const b = bodies[id];
      return b ? HttpResponse.json(b as object) : HttpResponse.json({ name: 'RESOURCE_NOT_FOUND' }, { status: 404 });
    }),
  );
});
afterEach(async () => {
  server.resetHandlers();
  await close();
});

// The list response below is built by the test. No real list response is on file (Phase 0 never listed),
// so only `items[].dispute_id` is assumed. Verify against the sandbox in the T-205 live check.
const list = (items: unknown, status = 200) =>
  server.use(http.get(`${BASE}/v1/customer/disputes`, () => HttpResponse.json({ items } as object, { status })));
const stored = () => db.disputeCase.findMany({ orderBy: { paypalDisputeId: 'asc' } });

describe('pollOnce: finds what the webhook missed', () => {
  it('stores a dispute that is listed but not yet known', async () => {
    list([{ dispute_id: IUT }]);
    const r = await pollOnce(deps);
    expect(r).toMatchObject({ discovered: 1, synced: 1, errors: [] });
    expect((await stored()).map((c) => c.paypalDisputeId)).toEqual([IUT]);
  });

  it('syncs a listed dispute once, whatever the list repeats, and ignores items that are not dispute ids', async () => {
    list([{ dispute_id: IUT }, { dispute_id: IUT }, { dispute_id: '../x' }, { dispute_id: 5 }, null, 'x', {}]);
    const r = await pollOnce(deps);
    expect(r.discovered).toBe(1);
    expect(detailGets).toEqual([IUT]);
  });

  it('does not rediscover a stored dispute, but still refreshes it while it is open', async () => {
    list([{ dispute_id: IUT }]);
    await pollOnce(deps);
    detailGets.length = 0;
    const r = await pollOnce(deps);
    expect(r).toMatchObject({ discovered: 0, synced: 1 });
    expect(detailGets).toEqual([IUT]);
  });

  it('picks up a change PayPal made without telling us', async () => {
    list([{ dispute_id: IUT }]);
    await pollOnce(deps);
    bodies[IUT] = resolved;
    await pollOnce(deps);
    expect((await stored())[0]).toMatchObject({ status: resolved.status });
    bodies[IUT] = fx('dispute-details-first');
  });

  it('stops polling a case once it is resolved and linked to its order', async () => {
    await db.order.create({
      data: {
        paypalOrderId: 'ORD1',
        captureId: '0HE26749YS519313U',
        itemsJson: '[]',
        country: 'US',
        grossMinor: 12000,
        currency: 'USD',
      },
    });
    list([{ dispute_id: IUT }]);
    bodies[IUT] = resolved;
    await pollOnce(deps);
    expect((await stored())[0]!.status).toBe('RESOLVED');
    detailGets.length = 0;
    const r = await pollOnce(deps);
    expect(r.synced).toBe(0);
    expect(detailGets).toEqual([]);
    bodies[IUT] = fx('dispute-details-first');
  });

  it('refreshes every open case, not only listed ones', async () => {
    list([{ dispute_id: IUT }, { dispute_id: RAV }]);
    await pollOnce(deps);
    list([]);
    detailGets.length = 0;
    expect((await pollOnce(deps)).synced).toBe(2);
    expect(detailGets.sort()).toEqual([IUT, RAV]);
  });
});

describe('pollOnce leaves demo cases alone', () => {
  it('never asks PayPal about a PP-DEMO case', async () => {
    await db.disputeCase.create({
      data: {
        paypalDisputeId: 'PP-DEMO-0001',
        reason: 'x',
        stage: 'CHARGEBACK',
        status: 'WAITING_FOR_SELLER_RESPONSE',
        amountMinor: 1,
        currency: 'USD',
        allowedActionsJson: '{}',
        requestedEvidence: '[]',
        lastSyncedAt: new Date(0),
        rawHash: 'x',
      },
    });
    list([]);
    const r = await pollOnce(deps);
    expect(r).toMatchObject({ synced: 0, errors: [] });
    expect(detailGets).toEqual([]);
  });
});

describe('pollOnce: one failure does not stop the rest', () => {
  it('reports a dispute that fails and carries on with the others', async () => {
    list([{ dispute_id: 'PP-R-GONE-1' }, { dispute_id: IUT }]);
    const r = await pollOnce(deps);
    expect(r.synced).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ disputeId: 'PP-R-GONE-1' });
    expect((await stored()).map((c) => c.paypalDisputeId)).toEqual([IUT]);
  });

  it('still refreshes open cases when the list call fails, and says so', async () => {
    list([{ dispute_id: IUT }]);
    await pollOnce(deps);
    list(undefined, 500);
    detailGets.length = 0;
    const r = await pollOnce(deps);
    expect(r.synced).toBe(1);
    expect(r.errors.map((e) => e.disputeId)).toEqual(['(list)']);
  });

  it('treats a list that is not the shape we read as an error, not as "no disputes"', async () => {
    server.use(http.get(`${BASE}/v1/customer/disputes`, () => HttpResponse.json({ something: 'else' })));
    const r = await pollOnce(deps);
    expect(r.errors.map((e) => e.disputeId)).toEqual(['(list)']);
  });

  it('puts no buyer data or PayPal body in an error message', async () => {
    list([{ dispute_id: 'PP-R-GONE-1' }]);
    const r = await pollOnce(deps);
    expect(JSON.stringify(r.errors)).not.toMatch(/RESOURCE_NOT_FOUND|@/);
  });
});

describe('handleManualSync: the sync button', () => {
  it('syncs now and returns what changed', async () => {
    const res = await handleManualSync(deps, IUT);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ disputeId: IUT, created: true, changed: true });
    const again = await handleManualSync(deps, IUT);
    expect(await again.json()).toMatchObject({ created: false, changed: false });
  });

  it('syncs a resolved case too', async () => {
    bodies[IUT] = resolved;
    expect((await handleManualSync(deps, IUT)).status).toBe(200);
    bodies[IUT] = fx('dispute-details-first');
  });

  it('refuses an id that is not a dispute id, without calling PayPal', async () => {
    const res = await handleManualSync(deps, '../x');
    expect(res.status).toBe(400);
    expect(detailGets).toEqual([]);
  });

  it('answers 502 with a code, not PayPal text, when PayPal fails or sends something unusable', async () => {
    const gone = await handleManualSync(deps, 'PP-R-GONE-1');
    expect(gone.status).toBe(502);
    expect(await gone.json()).toEqual({ error: 'PAYPAL_UNAVAILABLE' });
    bodies[IUT] = { dispute_id: IUT };
    const bad = await handleManualSync(deps, IUT);
    expect(bad.status).toBe(502);
    expect(await bad.json()).toEqual({ error: 'UNUSABLE_DISPUTE' });
    bodies[IUT] = fx('dispute-details-first');
  });

  it('answers 500 SERVER_MISCONFIGURED when PayPal is not set up', async () => {
    const res = await handleManualSync(null, IUT);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'SERVER_MISCONFIGURED' });
  });
});
