// T-006 spike: seller actions on the T-005 dispute. Two steps, chosen by STEP.
// Run: STEP=support DISPUTE_ID=PP-R-IUT-10193562 npx tsx --env-file=.env scripts/spike-t006.ts   (run support before require: require changes the status)
// DISPUTE_ID is required, and tests/fixtures/paypal/dispute-details-<DISPUTE_ID>.json (from T-005) must hold that dispute.
//
// STEP=support: GET the dispute (before), POST notes to the provide_supporting_info link from dispute-details-<DISPUTE_ID>.json as
//   application/json {"notes": ...}; on 415 only, retry once as multipart/form-data with a JSON part named "input".
//   JSON format per PayPal's integration guide (as reported; the API schema itself lists only a multipart file part).
//   Then re-GET the dispute (after) and print which attempt worked and what changed.
// STEP=require: POST /v1/customer/disputes/{id}/require-evidence {"action":"SELLER_EVIDENCE"} (sandbox only), then re-GET
//   the dispute and print how status, links and allowed_response_options changed from dispute-details-<DISPUTE_ID>.json.
//   Per PayPal's schema the dispute must be UNDER_REVIEW and its links must include require-evidence; the first T-005 fixture
//   had no such link, so a rejection is likely and is a finding, not a bug.
//
// Saves (redacted) under tests/fixtures/paypal/:
//   support: dispute-before-supporting-info.json, supporting-info-response.json, dispute-after-supporting-info.json
//   require: require-evidence-response.json, dispute-after-require-evidence.json
// Every failure prints status, debug ID and the full body; the script exits 0.
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

const save = (name: string, data: unknown) => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(redact(data), null, 2));
  console.log(`saved tests/fixtures/paypal/${name}`);
};

async function call(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init.method} ${url} → ${res.status} debug_id=${res.headers.get('paypal-debug-id')}\n${JSON.stringify(body, null, 2)}`);
  return body;
}

// Unlike call(), never throws on an HTTP error: for T-006 the error response is the result.
async function attempt(label: string, url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { raw_text: text }; }
  const r = { status: res.status, ok: res.ok, debug_id: res.headers.get('paypal-debug-id') ?? body?.debug_id ?? null, body };
  console.log(`\n${label} → ${r.status} debug_id=${r.debug_id}`);
  if (!r.ok) console.log(`full error body:\n${text}`);
  return r;
}

const step = process.env.STEP;
if (step !== 'support' && step !== 'require') throw new Error('Set STEP=support or STEP=require');

const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) throw new Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env');

const disputeId = process.env.DISPUTE_ID;
if (!disputeId) throw new Error('Set DISPUTE_ID, e.g. DISPUTE_ID=PP-R-IUT-10193562');
const detailsFile = `dispute-details-${disputeId}.json`;
const before = JSON.parse(fs.readFileSync(path.join(OUT, detailsFile), 'utf8'));
if (before.dispute_id !== disputeId) throw new Error(`${detailsFile} holds dispute ${before.dispute_id}, not ${disputeId}`);
const rels = (d: any): string[] => (d?.links ?? []).map((l: any) => l.rel);

const { access_token } = await call(`${BASE}/v1/oauth2/token`, {
  method: 'POST',
  headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=client_credentials',
});
const auth = { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };
const disputeUrl = `${BASE}/v1/customer/disputes/${encodeURIComponent(disputeId)}`;

const summary = (label: string, b: any, a: any) => {
  const added = rels(a).filter((r) => !rels(b).includes(r));
  const removed = rels(b).filter((r) => !rels(a).includes(r));
  console.log(`\n${label}: status ${b.status} → ${a.status} | state ${b.dispute_state} → ${a.dispute_state} | stage ${b.dispute_life_cycle_stage} → ${a.dispute_life_cycle_stage}`);
  console.log(`links before: ${rels(b).join(', ') || 'none'}`);
  console.log(`links after:  ${rels(a).join(', ') || 'none'}`);
  console.log(`links added: ${added.join(', ') || 'none'} | removed: ${removed.join(', ') || 'none'}`);
  console.log(`allowed_response_options before: ${JSON.stringify(b.allowed_response_options ?? 'absent')}`);
  console.log(`allowed_response_options after:  ${JSON.stringify(a.allowed_response_options ?? 'absent')}`);
  return { added, removed };
};

if (step === 'support') {
  const link = (before.links ?? []).find((l: any) => l.rel === 'provide_supporting_info');
  if (!link?.href) throw new Error(`No provide_supporting_info link in ${detailsFile} (links: ${rels(before).join(', ') || 'none'})`);

  // Fresh "before": the dispute may have moved since T-005 saved its fixture.
  const pre = await attempt(`GET /v1/customer/disputes/${disputeId} (before)`, disputeUrl, { method: 'GET', headers: auth });
  save('dispute-before-supporting-info.json', pre.ok ? pre.body : { status: pre.status, debug_id: pre.debug_id, body: pre.body });
  const b = pre.ok ? pre.body : before;
  console.log(`before: stage ${b.dispute_life_cycle_stage} status ${b.status} state ${b.dispute_state}${pre.ok ? '' : ` (from ${detailsFile}; fresh GET failed)`}`);

  const notes = 'Shipped with carrier INDIA_POST, tracking number EE123456789IN.';
  const urlPath = new URL(link.href).pathname;

  const json = await attempt(`POST ${urlPath} (attempt 1: application/json)`, link.href,
    { method: 'POST', headers: auth, body: JSON.stringify({ notes }) });
  const attempts: Record<string, unknown>[] = [{ attempt: 1, content_type: 'application/json', request: { notes }, response: json }];
  let worked = json.ok ? 'attempt 1 (application/json)' : '';

  if (json.status === 415) {
    // FormData sets Content-Type with the boundary itself, so only Authorization is passed.
    const form = new FormData();
    form.append('input', new Blob([JSON.stringify({ notes })], { type: 'application/json' }));
    const multi = await attempt(`POST ${urlPath} (attempt 2: multipart/form-data, part "input")`, link.href,
      { method: 'POST', headers: { Authorization: auth.Authorization }, body: form });
    attempts.push({ attempt: 2, content_type: 'multipart/form-data', parts: { input: { notes } }, response: multi });
    if (multi.ok) worked = 'attempt 2 (multipart/form-data, JSON part "input")';
  }
  save('supporting-info-response.json', { method: 'POST', path: urlPath, attempts });
  console.log(worked ? `\nworked: ${worked}` : `\nno attempt succeeded${json.status === 415 ? '' : ' (no retry: attempt 1 was not 415)'}`);

  const post = await attempt(`GET /v1/customer/disputes/${disputeId} (after)`, disputeUrl, { method: 'GET', headers: auth });
  save('dispute-after-supporting-info.json', post.ok ? post.body : { status: post.status, debug_id: post.debug_id, body: post.body });
  if (!post.ok) process.exit(0);

  const { added, removed } = summary('provide_supporting_info', b, post.body);
  const info = post.body.supporting_info ?? [];
  console.log(`supporting_info entries after: ${info.length}${info.length ? ` (last: source ${info.at(-1).source}, stage ${info.at(-1).dispute_life_cycle_stage})` : ''}`);
  const last = attempts.at(-1)!.response as Awaited<ReturnType<typeof attempt>>;
  console.log(`\nDECISIONS.md row: T-006 | provide_supporting_info | ${worked || 'failed'} | ${json.status}${attempts.length > 1 ? ` then ${last.status}` : ''} | debug ${last.debug_id} | status ${b.status} → ${post.body.status} | links +[${added.join(',')}] -[${removed.join(',')}] | supporting_info ${info.length}`);
  process.exit(0);
}

console.log(`dispute ${disputeId} before (${detailsFile}): stage ${before.dispute_life_cycle_stage} status ${before.status} state ${before.dispute_state}`);
if (before.status !== 'UNDER_REVIEW') console.log(`warning: status is ${before.status}; require-evidence expects UNDER_REVIEW`);
if (!rels(before).includes('require_evidence') && !rels(before).includes('require-evidence'))
  console.log(`warning: no require-evidence link in ${detailsFile} (links: ${rels(before).join(', ') || 'none'}); PayPal may reject the call`);

const request = { action: 'SELLER_EVIDENCE' };
const req = await attempt(`POST /v1/customer/disputes/${disputeId}/require-evidence`, `${disputeUrl}/require-evidence`,
  { method: 'POST', headers: auth, body: JSON.stringify(request) });
if (req.ok) console.log(JSON.stringify(redact(req.body), null, 2));
save('require-evidence-response.json', { request: { method: 'POST', path: `/v1/customer/disputes/${disputeId}/require-evidence`, body: request }, response: req });

const after = await attempt(`GET /v1/customer/disputes/${disputeId}`, disputeUrl, { method: 'GET', headers: auth });
save('dispute-after-require-evidence.json', after.ok ? after.body : { status: after.status, debug_id: after.debug_id, body: after.body });
if (!after.ok) process.exit(0);

const a = after.body;
const added = rels(a).filter((r) => !rels(before).includes(r));
const removed = rels(before).filter((r) => !rels(a).includes(r));
console.log(`\nstatus ${before.status} → ${a.status} | state ${before.dispute_state} → ${a.dispute_state} | stage ${before.dispute_life_cycle_stage} → ${a.dispute_life_cycle_stage}`);
console.log(`links before: ${rels(before).join(', ') || 'none'}`);
console.log(`links after:  ${rels(a).join(', ') || 'none'}`);
console.log(`links added: ${added.join(', ') || 'none'} | removed: ${removed.join(', ') || 'none'}`);
console.log(`allowed_response_options before: ${JSON.stringify(before.allowed_response_options ?? 'absent')}`);
console.log(`allowed_response_options after:  ${JSON.stringify(a.allowed_response_options ?? 'absent')}`);
if (a.seller_response_due_date) console.log(`seller_response_due_date ${a.seller_response_due_date}`);
console.log(`\nDECISIONS.md row: T-006 | require-evidence SELLER_EVIDENCE | ${req.status} | debug ${req.debug_id} | status ${before.status} → ${a.status} | links +[${added.join(',')}] -[${removed.join(',')}] | allowed_response_options ${a.allowed_response_options ? Object.keys(a.allowed_response_options).join(',') : 'absent'}`);
