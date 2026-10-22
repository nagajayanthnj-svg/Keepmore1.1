import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleAnalyse, type AnalyseEvent } from '../../src/ai/analyse-route';
import type { AiProvider } from '../../src/ai/provider';
import { seedDemoDisputes } from '../../src/demo/disputes';
import { seedDemo } from '../../src/demo/seed';
import { syncDispute } from '../../src/disputes/sync';
import type { Db } from '../../src/lib/db';
import { createPayPalClient, type PayPalClient } from '../../src/paypal/client';
import { createTestDb } from '../helpers/test-db';

const BASE = 'https://paypal.test';
const claim = JSON.parse(readFileSync('tests/fixtures/paypal/dispute-details-first.json', 'utf8'));
const REAL = 'PP-R-IUT-10193562';
const NOW = new Date('2026-10-20T12:00:00.000Z');

const server = setupServer();
let db: Db;
let close: () => Promise<void>;
let paypal: PayPalClient;
let gets = 0;
let fail = false;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await seedDemo(db);
  await seedDemoDisputes(db, NOW);
  gets = 0;
  fail = false;
  paypal = createPayPalClient({ clientId: 'id', clientSecret: 's', baseUrl: BASE });
  server.use(
    http.post(`${BASE}/v1/oauth2/token`, () => HttpResponse.json({ access_token: 't', expires_in: 3600 })),
    http.get(`${BASE}/v1/customer/disputes/${REAL}`, () => {
      gets++;
      return fail ? HttpResponse.json({ name: 'INTERNAL_SERVER_ERROR' }, { status: 500 }) : HttpResponse.json(claim);
    }),
  );
});
afterEach(async () => {
  server.resetHandlers();
  await close();
});

async function events(res: Response): Promise<AnalyseEvent[]> {
  const text = await res.text();
  return text.trim().split('\n').map((l) => JSON.parse(l) as AnalyseEvent);
}
function recorder(answer?: (user: string) => string): AiProvider & { users: string[] } {
  const p = {
    name: 'mock',
    model: 'm',
    users: [] as string[],
    async generate(x: { system: string; user: string }) {
      p.users.push(x.user);
      if (!answer) throw new Error('no answer');
      return answer(x.user);
    },
  };
  return p;
}

describe('T-308 analyse route', () => {
  it('streams the rules answer first, then the result (demo case, AI off)', async () => {
    const res = await handleAnalyse({ db, paypal: null, provider: null, now: () => NOW }, 'PP-DEMO-0001');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/ndjson/);
    const ev = await events(res);
    expect(ev.map((e) => e.type)).toEqual(['rules', 'result']);
    const result = ev[1]!;
    if (result.type !== 'result') throw new Error();
    expect(result.mode).toBe('RULES');
    expect(result.label).toMatch(/AI unavailable/);
    expect(result.allowed.source).toBe('SIMULATED');
  });

  it('the Stage A event arrives before any Stage B event', async () => {
    let release!: () => void;
    const wait = new Promise<void>((r) => (release = r));
    const slow: AiProvider = {
      name: 'slow',
      model: 's',
      async generate() {
        await wait;
        throw new Error('done waiting');
      },
    };
    const res = await handleAnalyse({ db, paypal: null, provider: slow, now: () => NOW }, 'PP-DEMO-0001');
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(JSON.parse(first.split('\n')[0]!).type).toBe('rules');
    release();
    let rest = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += new TextDecoder().decode(value);
    }
    expect(rest).toContain('"type":"result"');
  });

  it('a real case: allowed actions come from a fresh GET, and buyer words are withheld from the model', async () => {
    await syncDispute({ db, paypal }, REAL);
    const before = gets;
    const p = recorder();
    const ev = await events(await handleAnalyse({ db, paypal, provider: p, now: () => NOW }, REAL));
    expect(gets).toBe(before + 1);
    const result = ev.at(-1)!;
    if (result.type !== 'result') throw new Error();
    expect(result.allowed.source).toBe('PAYPAL');
    expect(result.allowed.actions).toEqual(expect.arrayContaining(['ACCEPT_CLAIM', 'PROVIDE_EVIDENCE']));
    for (const u of p.users) expect(u).not.toMatch(/"text": "(?!\[withheld)/);
  });

  it('when PayPal cannot be reached, nothing is executable but the advice still shows', async () => {
    await syncDispute({ db, paypal }, REAL);
    fail = true;
    const ev = await events(await handleAnalyse({ db, paypal, provider: null, now: () => NOW }, REAL));
    const result = ev.at(-1)!;
    if (result.type !== 'result') throw new Error();
    expect(result.allowed).toMatchObject({ source: 'UNAVAILABLE', actions: [] });
    expect(['WAIT', 'NO_ACTION']).toContain(result.gated.action);
    expect(ev[0]!.type).toBe('rules');
  });

  it('gives the truth map: every shown claim with its check result', async () => {
    const ev = await events(await handleAnalyse({ db, paypal: null, provider: null, now: () => NOW }, 'PP-DEMO-0001'));
    const result = ev.at(-1)!;
    if (result.type !== 'result') throw new Error();
    expect(result.claims.length).toBe(result.analysis.claims.length);
    expect(result.claims.every((c) => ['SUPPORTED', 'NEAR_MATCH', 'MISMATCH', 'UNVERIFIED'].includes(c.result))).toBe(true);
  });

  it('400 for a bad id, 404 for an unknown dispute', async () => {
    expect((await handleAnalyse({ db, paypal: null, provider: null }, 'nope')).status).toBe(400);
    expect((await handleAnalyse({ db, paypal: null, provider: null }, 'PP-R-AAA-10000000')).status).toBe(404);
  });
});
