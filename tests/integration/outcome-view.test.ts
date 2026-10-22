import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedDemoDisputes } from '../../src/demo/disputes';
import { seedDemo } from '../../src/demo/seed';
import { loadOutcome } from '../../src/disputes/outcome-view';
import { syncDispute, type SyncDeps } from '../../src/disputes/sync';
import type { Db } from '../../src/lib/db';
import { createPayPalClient } from '../../src/paypal/client';
import { createTestDb } from '../helpers/test-db';

const BASE = 'https://paypal.test';
const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/paypal/${n}.json`, 'utf8'));
const bodies: Record<string, unknown> = {
  'PP-R-IUT-10193562': fx('t009-PP-R-IUT-10193562-accept-3-final'),
  'PP-R-RAV-10193566': fx('t009-PP-R-RAV-10193566-adjudicate-3-final'),
};
const server = setupServer();
let db: Db;
let close: () => Promise<void>;
let deps: SyncDeps;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  deps = { db, paypal: createPayPalClient({ clientId: 'id', clientSecret: 's', baseUrl: BASE }) };
  server.use(
    http.post(`${BASE}/v1/oauth2/token`, () => HttpResponse.json({ access_token: 't', expires_in: 3600 })),
    http.get(`${BASE}/v1/customer/disputes/:id`, ({ params }) => HttpResponse.json(bodies[String(params.id)] as object)),
  );
});
afterEach(async () => {
  server.resetHandlers();
  await close();
});
const order = (captureId: string, grossMinor: number) =>
  db.order.create({
    data: { paypalOrderId: `ORD-${captureId}`, captureId, itemsJson: '[]', country: 'US', grossMinor, currency: 'USD', buyerHash: 'b'.repeat(64), sellerProtection: 'ELIGIBLE' },
  });

describe('loadOutcome (T-404)', () => {
  it('a lost dispute: refunded and the settlement fee shown apart, nothing retained, each from PayPal', async () => {
    await order('0HE26749YS519313U', 12000);
    await syncDispute(deps, 'PP-R-IUT-10193562');
    const v = await loadOutcome(db, 'PP-R-IUT-10193562');
    expect(v).toMatchObject({ decided: true, kind: 'LOST', verified: true, outcomeCode: 'RESOLVED_BUYER_FAVOUR', orderRef: 'ORD-0HE26749YS519313U' });
    expect(v!.buckets.refunded).toMatchObject({ minor: -12000, currency: 'USD', truthState: 'Verified by PayPal' });
    expect(v!.buckets.fees).toMatchObject({ minor: -588, truthState: 'Verified by PayPal' });
    expect(v!.buckets.retained).toMatchObject({ minor: 0, truthState: null });
    expect(v!.lines.map((l) => l.type).sort()).toEqual(['DISPUTE_FEE', 'REFUND']);
  });
  it('a won dispute: the disputed amount retained', async () => {
    await order('3FG688039F4865201', 5000);
    await syncDispute(deps, 'PP-R-RAV-10193566');
    const v = await loadOutcome(db, 'PP-R-RAV-10193566');
    expect(v).toMatchObject({ kind: 'WON', verified: true });
    expect(v!.buckets.retained).toMatchObject({ minor: 5000, truthState: 'Verified by PayPal' });
    expect(v!.buckets.refunded.minor).toBe(0);
  });
  it('the resolved demo case shows a retained amount labelled Simulated demo; an open one is not decided', async () => {
    await seedDemo(db);
    await seedDemoDisputes(db, new Date('2026-10-20T12:00:00Z'));
    const won = await loadOutcome(db, 'PP-DEMO-0003');
    expect(won).toMatchObject({ decided: true, kind: 'WON' });
    expect(won!.buckets.retained.truthState).toBe('Simulated demo');
    expect(won!.buckets.retained.minor).toBeGreaterThan(0);
    expect(await loadOutcome(db, 'PP-DEMO-0001')).toMatchObject({ decided: false });
  });
  it('null for an unknown or malformed id', async () => {
    expect(await loadOutcome(db, 'PP-R-AAA-10000000')).toBeNull();
    expect(await loadOutcome(db, '../x')).toBeNull();
  });
});
