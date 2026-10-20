// T-205 live check: the poller and the sync route against the real PayPal sandbox. Reads only; nothing is written to PayPal.
// Run (dev server open in another window, on main with PR #35 merged and pulled):
//   npx tsx --env-file=.env scripts/live-t205.ts
// Optional: APP_URL (default http://localhost:3000).
//
// 1. Proves the app is up and has the sync route (a bad id must give JSON 400 BAD_DISPUTE_ID).
// 2. GETs the dispute list once and saves it: raw to live-check-out/ (gitignored), redacted to tests/fixtures/paypal/.
// 3. Runs pollOnce twice on the app database (dev.db): the second run must discover nothing.
// 4. Calls the sync route for one stored dispute and prints the stored cases.
// Credential values are never printed.
import fs from 'node:fs';
import path from 'node:path';
import { isStale, pollOnce } from '../src/disputes/poller';
import { getSyncDeps, getDb } from '../src/lib/server-deps';

const BASE = 'https://api-m.sandbox.paypal.com';
const APP = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const PII = new Set(['email_address', 'payer_id', 'account_id', 'merchant_id', 'given_name', 'surname', 'full_name',
  'address_line_1', 'address_line_2', 'admin_area_1', 'admin_area_2', 'postal_code', 'national_number']);
const NAMED = new Set(['buyer', 'seller']);

function redact(v: unknown, key = ''): unknown {
  if (Array.isArray(v)) return v.map((x) => redact(x, key));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redact(x, k)]));
  }
  if (typeof v === 'string' && (PII.has(key) || key === 'name' && NAMED.has(key))) return 'REDACTED';
  return v;
}
function redactDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redactDeep);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [
        k,
        NAMED.has(k) && x && typeof x === 'object' ? redact({ ...(x as object), name: 'REDACTED' }) : redactDeep(x),
      ]),
    );
  }
  return v;
}
const clean = (v: unknown) => redact(redactDeep(v));

function step(n: number, title: string) {
  console.log(`\n== ${n}. ${title}`);
}

async function main() {
  const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
  console.log(`PAYPAL_CLIENT_ID set: ${Boolean(id)}, PAYPAL_CLIENT_SECRET set: ${Boolean(secret)}`);
  if (!id || !secret) throw new Error('PayPal credentials missing from .env');

  step(1, `Is the app up at ${APP} with the sync route?`);
  let res: Response;
  try {
    res = await fetch(`${APP}/api/disputes/..%2Fx/sync`, { method: 'POST' });
  } catch {
    console.log('FAIL: connection refused. The dev server is not running. Start `npm run dev` in a second window and leave it open.');
    return;
  }
  const text = await res.text();
  if (res.status === 400 && text.includes('BAD_DISPUTE_ID')) console.log('OK: 400 BAD_DISPUTE_ID (new code is running)');
  else {
    console.log(`FAIL: status ${res.status}, body starts: ${text.slice(0, 80)}`);
    console.log('An HTML 404 means old code: merge PR #35, pull main, restart the dev server.');
    return;
  }

  step(2, 'GET the dispute list once and save it');
  const tokenRes = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!tokenRes.ok) throw new Error(`token request failed: ${tokenRes.status}`);
  const token = ((await tokenRes.json()) as { access_token: string }).access_token;
  const listRes = await fetch(`${BASE}/v1/customer/disputes?page_size=50`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const raw = await listRes.text();
  fs.mkdirSync('live-check-out', { recursive: true });
  fs.writeFileSync('live-check-out/t205-list-raw.json', raw);
  console.log(`status ${listRes.status}; raw saved to live-check-out/t205-list-raw.json (gitignored)`);
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    console.log('FAIL: the body is not JSON');
    return;
  }
  console.log('top-level keys:', Object.keys(body).join(', '));
  const items = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : null;
  if (!items) console.log('SHAPE DIFFERS: no "items" array. The poller treats this as an error; tell Claude the keys above.');
  else {
    console.log(`items: ${items.length}; keys of the first item: ${Object.keys(items[0] ?? {}).join(', ')}`);
    for (const it of items) console.log(`  ${String(it.dispute_id)}  ${String(it.status)}  ${String(it.update_time)}`);
    const links = Array.isArray(body.links) ? (body.links as { rel?: string }[]).map((l) => l.rel).join(', ') : '(none)';
    console.log(`list links: ${links}`);
  }
  const fixture = path.resolve('tests/fixtures/paypal/t205-dispute-list.json');
  if (fs.existsSync(fixture)) console.log('fixture exists, not overwritten:', fixture);
  else {
    fs.writeFileSync(fixture, `${JSON.stringify(clean(body), null, 2)}\n`);
    console.log('redacted fixture saved:', fixture);
  }

  step(3, 'pollOnce twice on the app database');
  const deps = getSyncDeps();
  if (!deps) throw new Error('no sync deps');
  for (const n of [1, 2]) {
    const r = await pollOnce(deps);
    console.log(`run ${n}: discovered ${r.discovered}, synced ${r.synced}, errors ${JSON.stringify(r.errors)}`);
  }
  console.log('Expected: run 1 discovers every listed dispute not yet stored; run 2 discovers 0.');

  step(4, 'Sync route and stored cases');
  const db = getDb();
  const cases = await db.disputeCase.findMany({ orderBy: { paypalDisputeId: 'asc' } });
  if (cases[0]) {
    const r = await fetch(`${APP}/api/disputes/${cases[0].paypalDisputeId}/sync`, { method: 'POST' });
    console.log(`POST sync ${cases[0].paypalDisputeId}: ${r.status} ${await r.text()}`);
  }
  const now = new Date();
  for (const c of cases) {
    const acts = (JSON.parse(c.allowedActionsJson) as { actions?: { action: string }[] }).actions?.map((a) => a.action).join(',') ?? '?';
    console.log(`  ${c.paypalDisputeId}  ${c.stage}/${c.status}  actions: ${acts || '(none)'}  stale: ${isStale(c.lastSyncedAt, now)}`);
  }
}

main().catch((e) => {
  console.log(`CRASHED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
