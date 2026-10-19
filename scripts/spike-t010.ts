// T-010 spike: one seller write on an INQUIRY-stage dispute, chosen by STEP: message | evidence | escalate.
// Run: STEP=message DISPUTE_ID=PP-R-RAV-10193566 npx tsx --env-file=.env scripts/spike-t010.ts
// Optional: TEXT overrides the message / evidence notes / escalation note.
//
// Fresh GET first; the POST goes to that GET's link href and is not sent if the link rel is absent.
//   message:  rel send_message,     application/json {"message": TEXT}
//             (reference prose: "specify the message in the JSON request body"; only at stage INQUIRY. The schema itself lists
//             only a multipart file part "message_document".)
//   evidence: rel provide_evidence, application/json {"evidences":[{"evidence_type":"PROOF_OF_FULFILLMENT","notes":TEXT}]},
//             no item_id, no evidence_info. (Accepted at INQUIRY / WAITING_FOR_BUYER_RESPONSE on dispute 3, 2026-10-19.)
//   escalate: rel escalate,         application/json {"note": TEXT}
//             (Schema: no required fields; note 1-2000 chars; optional buyer_escalation_reason not sent; only at stage INQUIRY.)
// On any non-2xx: print the full error body and stop, without polling.
// After a 2xx: GET every 5 s for up to 60 s, printing stage, status, link rels and fund_movements on each poll.
// Saves (redacted) under tests/fixtures/paypal/, prefixed t010-<dispute id>-<step>-: the fresh GET, the request and response,
// and the final dispute. Existing files are never overwritten: a re-run adds a timestamp. PayPal errors exit 0.
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

const tn = 'EE123456789IN';
const STEPS: Record<string, { rel: string; body: (text: string) => unknown; text: string }> = {
  message: { rel: 'send_message', body: (t) => ({ message: t }), text: `Your order shipped with India Post, tracking number ${tn}.` },
  evidence: { rel: 'provide_evidence', body: (t) => ({ evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', notes: t }] }), text: `Shipped with India Post, tracking number ${tn}.` },
  escalate: { rel: 'escalate', body: (t) => ({ note: t }), text: `Item shipped with India Post, tracking number ${tn}; escalating for PayPal review.` },
};

const step = process.env.STEP ?? '';
const s = STEPS[step];
if (!s) throw new Error(`Set STEP to one of ${Object.keys(STEPS).join(', ')}`);
const disputeId = process.env.DISPUTE_ID;
if (!disputeId) throw new Error('Set DISPUTE_ID, e.g. DISPUTE_ID=PP-R-RAV-10193566');
const text = process.env.TEXT ?? s.text;
if (text.length < 1 || text.length > 2000) throw new Error(`TEXT must be 1-2000 characters (got ${text.length})`);
const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) throw new Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const save = (name: string, data: unknown) => {
  fs.mkdirSync(OUT, { recursive: true });
  const base = `t010-${disputeId}-${step}-${name}.json`;
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

// Never throws: an HTTP error is a result, and a network error during a poll must not end the run.
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

const { access_token } = await call(`${BASE}/v1/oauth2/token`, {
  method: 'POST',
  headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=client_credentials',
});
const auth = { Authorization: `Bearer ${access_token}` };
const disputeUrl = `${BASE}/v1/customer/disputes/${encodeURIComponent(disputeId)}`;
const rels = (d: any): string[] => (d?.links ?? []).map((l: any) => l.rel);
const funds = (d: any): string[] => (d?.fund_movements ?? []).map((f: any) => `${f.party} ${f.type} ${f.amount?.value} ${f.amount?.currency_code} ${f.reason}`);
const line = (label: string, d: any) =>
  `${new Date().toISOString()} | ${label} | stage ${d.dispute_life_cycle_stage} | status ${d.status} | links ${rels(d).join(', ') || 'none'} | fund_movements ${funds(d).join('; ') || 'none'}`;

// Fresh GET: the only source of the link href.
const pre = await attempt(disputeUrl, { method: 'GET', headers: auth });
save('1-before', pre.ok ? pre.body : { status: pre.status, debug_id: pre.debug_id, body: pre.body });
if (!pre.ok) { console.log(`GET → ${pre.status} debug_id=${pre.debug_id}\nfull error body:\n${pre.text}\n\nSTOP: could not read the dispute.`); process.exit(0); }
const b = pre.body;
console.log(line('before', b));
const link = (b.links ?? []).find((l: any) => l.rel === s.rel);
if (!link?.href) {
  console.log(`\nSTOP: no ${s.rel} link on the dispute. Nothing was sent.`);
  process.exit(0);
}
if ((step === 'message' || step === 'escalate') && b.dispute_life_cycle_stage !== 'INQUIRY') console.log(`warning: stage is ${b.dispute_life_cycle_stage}; the reference allows ${step} only at INQUIRY`);
if (step === 'evidence') console.log(`note: dispute status is ${b.status}`);

const body = s.body(text);
const urlPath = new URL(link.href).pathname;
console.log(`\nPOST ${urlPath} (application/json)\nbody: ${JSON.stringify(body)}`);
const r = await attempt(link.href, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
console.log(`POST ${urlPath} → ${r.status} debug_id=${r.debug_id}`);
console.log(r.ok ? JSON.stringify(redact(r.body), null, 2) : `full error body:\n${r.text}`);
save('2-response', { request: { method: 'POST', path: urlPath, content_type: 'application/json', body }, response: { status: r.status, debug_id: r.debug_id, body: r.body } });
const issues = (r.body?.details ?? []).map((d: any) => d.issue).join(',');
if (!r.ok) {
  console.log(`\nSTOP: ${s.rel} returned ${r.status}${issues ? ` (${issues})` : ''}. Not polled.`);
  console.log(`DECISIONS.md row: T-010 ${step} | ${disputeId} | ${b.dispute_life_cycle_stage}/${b.status} | ${r.status} ${issues} | debug ${r.debug_id}`);
  process.exit(0);
}

// Poll after the 2xx: earlier writes took up to ~25 s to show.
let last: any = b;
const t0 = Date.now();
while (Date.now() - t0 < 60_000) {
  await new Promise((res) => setTimeout(res, 5000));
  const g = await attempt(disputeUrl, { method: 'GET', headers: auth });
  if (!g.ok) { console.log(`${new Date().toISOString()} | poll | GET failed: ${g.status} debug_id=${g.debug_id}`); continue; }
  last = g.body;
  console.log(line(`poll +${Math.round((Date.now() - t0) / 1000)}s`, last));
}
save('3-final', last);
console.log(`\nDECISIONS.md row: T-010 ${step} | ${disputeId} | ${b.dispute_life_cycle_stage}/${b.status} → ${last.dispute_life_cycle_stage}/${last.status} | ${r.status} | debug ${r.debug_id} | links ${rels(last).join(', ')} | fund_movements ${funds(last).join('; ') || 'none'}`);
