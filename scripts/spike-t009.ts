// T-009 spike: close a sandbox dispute, by sandbox adjudication or seller acceptance. One step per run, chosen by STEP.
// Run: STEP=adjudicate DISPUTE_ID=PP-R-OSP-10193570 npx tsx --env-file=.env scripts/spike-t009.ts
//
// Link hrefs come only from GETs made in this run; nothing is sent if its link is absent. require-evidence is never called.
//
// STEP=adjudicate: GET every 60 s, up to 60 min, until an "adjudicate" link appears (one line per poll), then POST it with
//   application/json {"adjudication_outcome": "SELLER_FAVOR"}. Per PayPal's disputes OpenAPI schema: sandbox only;
//   adjudication_outcome is required, enum BUYER_FAVOR | SELLER_FAVOR; status must be UNDER_REVIEW and the link present.
//   On dispute 3 the link was first seen 28.5 min after UNDER_REVIEW began, close to the old 40-min limit.
// STEP=accept: one fresh GET, then POST the "accept_claim" link with application/json {"<NOTE_FIELD>": TEXT}.
//   TEXT defaults to "Accepting the claim and refunding the buyer in full." (1-2000 chars); NOTE_FIELD is note (default) or notes.
//   The note is REQUIRED (or a document): on dispute 1 an empty body {} failed with 400 EITHER_OF_NOTES_OR_DOCUMENT_IS_MANDATORY
//   and {"note": TEXT} returned 200. PayPal's reference does not say so: it lists only an optional multipart file part
//   "accept-claim-document". accept_claim_type, refund_amount and return_shipping_address are not sent.
//   Accepting closes the dispute in the buyer's favour and refunds them.
//
// On any non-2xx: print the full error body and stop.
// After a 2xx (either step): GET every 15 s for 3 min, printing changes to status, state, dispute_outcome.outcome_code,
// fund_movements and links, then save the final dispute.
// Saves (redacted) under tests/fixtures/paypal/, prefixed t009-<dispute id>-<step>-: the dispute when the link was found,
// the request and response, and the final dispute. Existing files are never overwritten: a re-run adds a timestamp.
// PayPal errors and timeouts are findings: the script prints them and exits 0.
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://api-m.sandbox.paypal.com';
const OUT = path.resolve('tests/fixtures/paypal');
const PII = new Set(['email_address', 'payer_id', 'account_id', 'merchant_id', 'given_name', 'surname', 'full_name',
  'address_line_1', 'address_line_2', 'admin_area_1', 'admin_area_2', 'postal_code', 'national_number']);
// Dispute bodies name people as buyer.name and seller.name; elsewhere "name" is an error or item name, so it stays.
const NAMED = new Set(['buyer', 'seller']);
const EMAIL = /[^\s@"]+@[^\s@"]+\.[^\s@"]+/g;

// Also masks emails inside free text such as buyer messages.
const redact = (v: any, parent = ''): any =>
  Array.isArray(v) ? v.map((x) => redact(x, parent))
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) =>
      [k, PII.has(k) || (k === 'name' && NAMED.has(parent)) ? `REDACTED_${k.toUpperCase()}` : redact(x, k)]))
  : typeof v === 'string' ? v.replace(EMAIL, 'REDACTED_EMAIL')
  : v;

// From PayPal's disputes OpenAPI schema (components.schemas), checked 2026-10-19.
const ADJUDICATION_OUTCOMES = ['BUYER_FAVOR', 'SELLER_FAVOR'];
const OUTCOME_CODES = ['RESOLVED_BUYER_FAVOUR', 'RESOLVED_SELLER_FAVOUR', 'RESOLVED_WITH_PAYOUT', 'CANCELED_BY_BUYER', 'ACCEPTED', 'DENIED', 'NONE'];

const step = process.env.STEP;
if (step !== 'accept' && step !== 'adjudicate') throw new Error('Set STEP=adjudicate or STEP=accept');
const disputeId = process.env.DISPUTE_ID;
if (!disputeId) throw new Error('Set DISPUTE_ID, e.g. DISPUTE_ID=PP-R-OSP-10193570');
const noteField = process.env.NOTE_FIELD ?? 'note';
if (noteField !== 'note' && noteField !== 'notes') throw new Error('Set NOTE_FIELD=note or NOTE_FIELD=notes');
const text = process.env.TEXT ?? 'Accepting the claim and refunding the buyer in full.';
if (text.length < 1 || text.length > 2000) throw new Error(`TEXT must be 1-2000 characters (got ${text.length})`);
const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) throw new Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const save = (name: string, data: unknown) => {
  fs.mkdirSync(OUT, { recursive: true });
  const base = `t009-${disputeId}-${step}-${name}.json`;
  const file = fs.existsSync(path.join(OUT, base)) ? base.replace(/\.json$/, `-${stamp}.json`) : base;
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(redact(data), null, 2));
  console.log(`saved tests/fixtures/paypal/${file}`);
};

async function call(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init.method} ${url} → ${res.status} debug_id=${res.headers.get('paypal-debug-id')}\n${JSON.stringify(body, null, 2)}`);
  return body;
}

// Never throws: an HTTP error is a result, and a network error during a long poll must not end the run.
async function attempt(url: string, init: RequestInit) {
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { raw_text: text }; }
    return { status: res.status, ok: res.ok, debug_id: res.headers.get('paypal-debug-id') ?? body?.debug_id ?? null, body, text };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { status: 0, ok: false, debug_id: null, body: { network_error: message }, text: `network error: ${message}` };
  }
}

// The adjudicate wait can run 60 min; refresh the token a minute before expiry.
let token = { value: '', expiresAt: 0 };
async function accessToken() {
  if (Date.now() < token.expiresAt) return token.value;
  const body = await call(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
  return token.value;
}

const disputeUrl = `${BASE}/v1/customer/disputes/${encodeURIComponent(disputeId)}`;
const get = async () => attempt(disputeUrl, { method: 'GET', headers: { Authorization: `Bearer ${await accessToken()}` } });
const rels = (d: any): string[] => (d?.links ?? []).map((l: any) => l.rel);
const findLink = (d: any, rel: string) => (d?.links ?? []).find((l: any) => l.rel === rel);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const line = (label: string, d: any) =>
  `${now()} | ${label} | status ${d.status} | state ${d.dispute_state} | outcome ${d.dispute_outcome?.outcome_code ?? 'absent'} | links ${rels(d).join(', ') || 'none'}`;

// Polls until done(dispute) or the time limit; returns the last good dispute and whether done was reached.
async function waitFor(label: string, everyMs: number, limitMs: number, done: (d: any) => boolean) {
  const t0 = Date.now();
  let last: any = null;
  for (;;) {
    const g = await get();
    if (g.ok) {
      last = g.body;
      console.log(line(label, last));
      if (done(last)) return { dispute: last, reached: true };
    } else {
      console.log(`${now()} | ${label} | GET failed: ${g.status} debug_id=${g.debug_id} ${g.text}`);
    }
    if (Date.now() - t0 + everyMs > limitMs) return { dispute: last, reached: false };
    await sleep(everyMs);
  }
}

const rel = step === 'adjudicate' ? 'adjudicate' : 'accept_claim';
let found: { dispute: any; reached: boolean };
if (step === 'adjudicate') {
  console.log(`adjudication_outcome values in PayPal's reference: ${ADJUDICATION_OUTCOMES.join(', ')}`);
  console.log(`dispute_outcome.outcome_code values in PayPal's reference: ${OUTCOME_CODES.join(', ')}`);
  console.log(`\ndispute ${disputeId}: waiting for an adjudicate link (every 60 s, up to 60 min)`);
  found = await waitFor('wait adjudicate', 60_000, 60 * 60_000, (d) => !!findLink(d, 'adjudicate'));
} else {
  console.log(`accept-claim with JSON field "${noteField}". A note is required; an empty body fails.`);
  console.log(`Accepting closes dispute ${disputeId} in the buyer's favour and refunds them.\n`);
  found = await waitFor('fresh GET', 0, 0, (d) => !!findLink(d, 'accept_claim'));
}
if (found.dispute) save('1-before', found.dispute);
if (!found.reached) {
  const why = step === 'adjudicate' ? 'no adjudicate link appeared within 60 min' : 'no accept_claim link on the dispute';
  console.log(`\nSTOP: ${why}. Nothing was sent. Last links: ${rels(found.dispute).join(', ') || 'none (no successful GET)'}`);
  process.exit(0);
}
const b = found.dispute;
console.log(`allowed_response_options: ${JSON.stringify(b.allowed_response_options ?? 'absent')}`);
if (step === 'adjudicate' && b.status !== 'UNDER_REVIEW') console.log(`warning: status is ${b.status}; the schema allows adjudicate only in UNDER_REVIEW`);

const link = findLink(b, rel);
const body = step === 'adjudicate' ? { adjudication_outcome: 'SELLER_FAVOR' } : { [noteField]: text };
const urlPath = new URL(link.href).pathname;
console.log(`\nPOST ${urlPath} (application/json)\nbody: ${JSON.stringify(body)}`);
const r = await attempt(link.href, {
  method: 'POST', headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
console.log(`POST ${urlPath} → ${r.status} debug_id=${r.debug_id}`);
console.log(r.ok ? JSON.stringify(redact(r.body), null, 2) : `full error body:\n${r.text}`);
save('2-response', {
  request: { method: 'POST', path: urlPath, content_type: 'application/json', body },
  response: { status: r.status, debug_id: r.debug_id, body: r.body },
});
const issues = (r.body?.details ?? []).map((d: any) => d.issue).join(',');
const what = step === 'adjudicate' ? 'adjudicate SELLER_FAVOR' : `accept-claim {"${noteField}"}`;
if (!r.ok) {
  console.log(`\nSTOP: ${step === 'adjudicate' ? 'adjudicate' : 'accept-claim'} returned ${r.status}${issues ? ` (${issues})` : ''}. Not polled.`);
  console.log(`DECISIONS.md row: T-009 ${what} | ${disputeId} | ${r.status} ${issues} | debug ${r.debug_id}`);
  process.exit(0);
}

// Poll after the 2xx: earlier writes took up to ~25 s to show.
const snap = (d: any) => ({
  status: d.status, state: d.dispute_state, outcome_code: d.dispute_outcome?.outcome_code ?? 'absent',
  fund_movements: (d.fund_movements ?? []).map((f: any) => `${f.party} ${f.type} ${f.amount?.value} ${f.amount?.currency_code} ${f.reason} ${f.initiated_time}`),
  links: rels(d),
});
let last: any = b;
let prev = snap(b);
const t0 = Date.now();
while (Date.now() - t0 < 3 * 60_000) {
  await sleep(15_000);
  const g = await get();
  if (!g.ok) { console.log(`${now()} | watch | GET failed: ${g.status} debug_id=${g.debug_id}`); continue; }
  last = g.body;
  const cur = snap(last);
  const changed = (Object.keys(cur) as (keyof typeof cur)[]).filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(prev[k]));
  console.log(`${now()} | watch | ${changed.length ? changed.map((k) => `${k}: ${JSON.stringify(prev[k])} → ${JSON.stringify(cur[k])}`).join(' | ') : 'no change'}`);
  prev = cur;
}
save('3-final', last);
const fin = snap(last);
console.log(`\nfinal: status ${fin.status} | state ${fin.state} | outcome_code ${fin.outcome_code} | links ${fin.links.join(', ')}`);
console.log(`dispute_outcome: ${JSON.stringify(last.dispute_outcome ?? 'absent')}`);
console.log(`fund_movements:\n  ${fin.fund_movements.join('\n  ') || 'none'}`);
console.log(`\nDECISIONS.md row: T-009 ${what} | ${disputeId} | ${r.status} | debug ${r.debug_id} | after 3 min: ${fin.status} / ${fin.state} | outcome ${fin.outcome_code} | links ${fin.links.join(', ')}`);
