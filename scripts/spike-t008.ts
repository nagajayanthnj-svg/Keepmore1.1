// T-008 spike: unattended seller-evidence flow for one dispute: wait for require_evidence, request seller evidence,
// wait for the evidence request, answer it with PROOF_OF_FULFILLMENT + tracking, then watch the result.
// Run: DISPUTE_ID=PP-R-OSP-10193570 npx tsx --env-file=.env scripts/spike-t008.ts
//
// 1. GET every 60 s, up to 40 min, until links has require_evidence. One line per poll: time, status, link rels.
// 2. POST require-evidence {"action":"SELLER_EVIDENCE"} to that link's href. Stop on non-2xx.
// 3. GET every 15 s, up to 10 min, until links has provide_evidence AND evidences has REQUESTED_FROM_SELLER entries.
//    Print the requested types and the disputed item's item_id and item_type.
// 4. POST provide-evidence as application/json: one PROOF_OF_FULFILLMENT with the dispute's item_id,
//    evidence_info.tracking_info [{carrier_name INDIA_POST, tracking_number EE123456789IN}] and notes.
//    On 400 (or any non-2xx): print the full error and stop. No retries, no other variants.
// 5. After a 2xx: GET every 10 s for 90 s, printing changes to status, state, evidences and links. Save the final dispute.
// Neither POST is sent unless its link is present on the most recent GET.
// Saves (redacted) under tests/fixtures/paypal/, prefixed t008-<dispute id>-: a snapshot when each wait ends, each POST's
// request and response, and the final dispute. Existing files are never overwritten: a re-run adds a timestamp.
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

const disputeId = process.env.DISPUTE_ID;
if (!disputeId) throw new Error('Set DISPUTE_ID, e.g. DISPUTE_ID=PP-R-OSP-10193570');
const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) throw new Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env');

// Names carry the dispute ID, and a re-run never overwrites (earlier spikes lost two disputes' fixtures that way).
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const save = (name: string, data: unknown) => {
  fs.mkdirSync(OUT, { recursive: true });
  const base = `t008-${disputeId}-${name}.json`;
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

// Never throws: an HTTP error is a result, and a network error during an unattended poll must not end the run.
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

// Sandbox tokens last hours, but this run can take ~52 min; refresh a minute before expiry anyway.
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
const post = async (href: string, body: unknown) => attempt(href, {
  method: 'POST', headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const rels = (d: any): string[] => (d?.links ?? []).map((l: any) => l.rel);
const link = (d: any, rel: string) => (d?.links ?? []).find((l: any) => l.rel === rel);
const requestedFromSeller = (d: any) => (d?.evidences ?? []).filter((e: any) => e.source === 'REQUESTED_FROM_SELLER');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

// Polls until done(dispute) or the time limit; returns the last good dispute and whether done was reached.
async function waitFor(label: string, everyMs: number, limitMs: number, done: (d: any) => boolean) {
  const t0 = Date.now();
  let last: any = null;
  for (;;) {
    const g = await get();
    if (g.ok) {
      last = g.body;
      console.log(`${now()} | ${label} | status ${last.status} | state ${last.dispute_state} | links ${rels(last).join(', ') || 'none'}`);
      if (done(last)) return { dispute: last, reached: true };
    } else {
      console.log(`${now()} | ${label} | GET failed: ${g.status} debug_id=${g.debug_id} ${g.text}`);
    }
    if (Date.now() - t0 + everyMs > limitMs) return { dispute: last, reached: false };
    await sleep(everyMs);
  }
}

const printPost = (label: string, r: Awaited<ReturnType<typeof attempt>>) => {
  console.log(`\n${label} → ${r.status} debug_id=${r.debug_id}`);
  console.log(r.ok ? JSON.stringify(redact(r.body), null, 2) : `full error body:\n${r.text}`);
};

console.log(`dispute ${disputeId}: waiting for require_evidence (every 60 s, up to 40 min)`);

// 1. Wait for require_evidence.
const w1 = await waitFor('wait require_evidence', 60_000, 40 * 60_000, (d) => !!link(d, 'require_evidence'));
if (w1.dispute) save('1-before-require-evidence', w1.dispute);
if (!w1.reached) {
  console.log(`\nSTOP: no require_evidence link appeared within 40 min. Nothing was sent. Last links: ${rels(w1.dispute).join(', ') || 'none (no successful GET)'}`);
  process.exit(0);
}

// 2. Request seller evidence, using the link just seen.
const reqLink = link(w1.dispute, 'require_evidence');
const reqBody = { action: 'SELLER_EVIDENCE' };
const r1 = await post(reqLink.href, reqBody);
printPost(`POST ${new URL(reqLink.href).pathname}`, r1);
save('2-require-evidence-response', { request: { method: 'POST', path: new URL(reqLink.href).pathname, body: reqBody }, response: { status: r1.status, debug_id: r1.debug_id, body: r1.body } });
if (!r1.ok) {
  console.log(`\nSTOP: require-evidence returned ${r1.status}. provide-evidence was not attempted.`);
  process.exit(0);
}

// 3. Wait for the evidence request. require-evidence applied ~25 s after its 200 on dispute 1.
console.log(`\nwaiting for provide_evidence + REQUESTED_FROM_SELLER (every 15 s, up to 10 min)`);
const w2 = await waitFor('wait provide_evidence', 15_000, 10 * 60_000, (d) => !!link(d, 'provide_evidence') && requestedFromSeller(d).length > 0);
if (w2.dispute) save('3-before-provide-evidence', w2.dispute);
if (!w2.reached) {
  const d = w2.dispute;
  console.log(`\nSTOP: within 10 min, ${link(d, 'provide_evidence') ? '' : 'no provide_evidence link'}${!link(d, 'provide_evidence') && !requestedFromSeller(d).length ? ' and ' : ''}${requestedFromSeller(d).length ? '' : 'no REQUESTED_FROM_SELLER evidences'}. provide-evidence was not sent.`);
  process.exit(0);
}
const d2 = w2.dispute;
console.log(`requested from seller: ${requestedFromSeller(d2).map((e: any) => e.evidence_type).join(', ')}`);
console.log(`seller_response_due_date: ${d2.seller_response_due_date ?? 'absent'}`);
const items = (d2.disputed_transactions ?? []).flatMap((t: any) => t.items ?? []);
for (const it of items) console.log(`disputed item: item_id ${it.item_id ?? 'absent'} | item_name ${it.item_name ?? 'absent'} | item_type ${it.item_type ?? 'absent'}`);
const itemIds = [...new Set(items.map((it: any) => it.item_id).filter(Boolean))] as string[];
// The evidence must carry the dispute's item_id; with none or several there is no single right value to send.
if (itemIds.length !== 1) {
  console.log(`\nSTOP: expected exactly one item_id on the disputed item, found ${itemIds.length}${itemIds.length ? ` (${itemIds.join(', ')})` : ''}. provide-evidence was not sent.`);
  process.exit(0);
}
if (!requestedFromSeller(d2).some((e: any) => e.evidence_type === 'PROOF_OF_FULFILLMENT')) console.log('warning: PROOF_OF_FULFILLMENT was not among the requested types');

// 4. One PROOF_OF_FULFILLMENT, JSON body, using the link just seen. No retries.
const tn = 'EE123456789IN';
const evidenceBody = {
  evidences: [{
    evidence_type: 'PROOF_OF_FULFILLMENT',
    item_id: itemIds[0],
    evidence_info: { tracking_info: [{ carrier_name: 'INDIA_POST', tracking_number: tn }] },
    notes: `Shipped with India Post, tracking number ${tn}.`,
  }],
};
const peLink = link(d2, 'provide_evidence');
console.log(`\nPOST ${new URL(peLink.href).pathname} (application/json)\nbody: ${JSON.stringify(evidenceBody)}`);
const r2 = await post(peLink.href, evidenceBody);
printPost(`POST ${new URL(peLink.href).pathname}`, r2);
save('4-provide-evidence-response', { request: { method: 'POST', path: new URL(peLink.href).pathname, content_type: 'application/json', body: evidenceBody }, response: { status: r2.status, debug_id: r2.debug_id, body: r2.body } });
const issues = (r2.body?.details ?? []).map((d: any) => d.issue).join(',');
if (!r2.ok) {
  console.log(`\nSTOP: provide-evidence returned ${r2.status}${issues ? ` (${issues})` : ''}. No retries.`);
  console.log(`DECISIONS.md row: T-008 | ${disputeId} | require-evidence ${r1.status} debug ${r1.debug_id} | provide-evidence PROOF_OF_FULFILLMENT item_id ${itemIds[0]} INDIA_POST | ${r2.status} ${issues} | debug ${r2.debug_id}`);
  process.exit(0);
}

// 5. Watch the result after the 2xx.
const snap = (d: any) => ({
  status: d.status, state: d.dispute_state,
  evidences: (d.evidences ?? []).map((e: any) => `${e.evidence_type}/${e.source}/${e.date}`),
  links: rels(d),
});
let last: any = d2;
let prev = snap(d2);
const t0 = Date.now();
while (Date.now() - t0 < 90_000) {
  await sleep(10_000);
  const g = await get();
  if (!g.ok) { console.log(`${now()} | watch | GET failed: ${g.status} debug_id=${g.debug_id}`); continue; }
  last = g.body;
  const cur = snap(last);
  const changed = (Object.keys(cur) as (keyof typeof cur)[]).filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(prev[k]));
  console.log(`${now()} | watch | ${changed.length ? changed.map((k) => `${k}: ${JSON.stringify(prev[k])} → ${JSON.stringify(cur[k])}`).join(' | ') : 'no change'}`);
  prev = cur;
}
save('5-final', last);
const fin = snap(last);
console.log(`\nfinal: status ${fin.status} | state ${fin.state} | links ${fin.links.join(', ')}`);
console.log(`evidences:\n  ${fin.evidences.join('\n  ')}`);
console.log(`\nDECISIONS.md row: T-008 | ${disputeId} | require-evidence ${r1.status} debug ${r1.debug_id} | provide-evidence PROOF_OF_FULFILLMENT item_id ${itemIds[0]} INDIA_POST | ${r2.status} debug ${r2.debug_id} | after 90s: ${fin.status} / ${fin.state} | links ${fin.links.join(', ')}`);
