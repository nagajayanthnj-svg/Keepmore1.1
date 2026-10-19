// T-007 spike: answer the seller evidence request on the T-005 dispute. One request variant per run, chosen by VARIANT.
// Run: VARIANT=1 DISPUTE_ID=PP-R-IUT-10193562 npx tsx --env-file=.env scripts/spike-t007.ts
// DISPUTE_ID is required, and tests/fixtures/paypal/dispute-details-<DISPUTE_ID>.json (from T-005) must hold that dispute.
//
// Variants (field names from PayPal's disputes OpenAPI schema: evidence, evidence_info, tracking_info):
//   0  multipart, part "input": PROOF_OF_FULFILLMENT + tracking_info INDIA_POST   (first run: 400 EVIDENCE_TYPE_IS_NOT_ALLOWED)
//   1  application/json: PROOF_OF_FULFILLMENT + tracking_info INDIA_POST
//   2  application/json: PROOF_OF_FULFILLMENT, notes only, no evidence_info
//   3  application/json: PROOF_OF_FULFILLMENT + tracking_info carrier_name OTHER (+ carrier_name_other, required by the
//      schema for OTHER), carrier named in notes
//   4  application/json: all three requested types in one call: PROOF_OF_FULFILLMENT + tracking_info INDIA_POST;
//      PROOF_OF_REFUND and PROOF_OF_DELIVERY_SIGNATURE with notes only. No refund IDs are invented.
//   5  multipart, part "input" (the sibling of the schema's "evidence-file" part, no file sent): PROOF_OF_FULFILLMENT, notes only
//
// 1. GET the dispute. Stop unless evidences has REQUESTED_FROM_SELLER entries and links has provide_evidence.
//    Print the disputed items (item_id, item_name, item_type). If the dispute has one item_id, it is added to every
//    evidence entry; with more than one, stop without sending. OMIT_ITEM_ID=1 leaves item_id out of every entry
//    (the items are still printed, and several item_ids no longer stop the run).
// 2. POST the chosen variant to that link's href. Print status, debug ID and the full body on failure.
// 3. Only after a 2xx: poll GET every 5 s for 90 s, printing changes to status, state, evidences, links and
//    allowed_response_options. Never after a 4xx/5xx: a rejected write changes nothing worth polling for.
// Saves (redacted) under tests/fixtures/paypal/: dispute-before-provide-evidence-v<N>.json, provide-evidence-response-v<N>.json,
// and after a 2xx dispute-after-provide-evidence-v<N>.json. Existing files are never overwritten: a re-run adds a timestamp.
// The script exits 0 on PayPal errors.
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

// A re-run must not destroy an earlier run's evidence (T-006 lost its first support run that way).
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const save = (name: string, data: unknown) => {
  fs.mkdirSync(OUT, { recursive: true });
  const file = fs.existsSync(path.join(OUT, name)) ? name.replace(/\.json$/, `-${stamp}.json`) : name;
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(redact(data), null, 2));
  console.log(`saved tests/fixtures/paypal/${file}`);
};

async function call(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init.method} ${url} → ${res.status} debug_id=${res.headers.get('paypal-debug-id')}\n${JSON.stringify(body, null, 2)}`);
  return body;
}

// Unlike call(), never throws on an HTTP error: for T-007 the error response is the result.
async function attempt(label: string, url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { raw_text: text }; }
  const r = { status: res.status, ok: res.ok, debug_id: res.headers.get('paypal-debug-id') ?? body?.debug_id ?? null, body };
  console.log(`${label} → ${r.status} debug_id=${r.debug_id}`);
  if (!r.ok) console.log(`full error body:\n${text}`);
  return r;
}

const tn = 'EE123456789IN';
const fulfilment = (tracking: Record<string, string> | null, notes: string) => ({
  evidence_type: 'PROOF_OF_FULFILLMENT', ...(tracking ? { evidence_info: { tracking_info: [tracking] } } : {}), notes,
});
const indiaPost = { carrier_name: 'INDIA_POST', tracking_number: tn };
const shippedNote = `Shipped with India Post, tracking number ${tn}.`;
const VARIANTS: Record<string, { label: string; multipart: boolean; evidences: Record<string, unknown>[] }> = {
  0: { label: 'multipart input, fulfilment + tracking INDIA_POST', multipart: true, evidences: [fulfilment(indiaPost, shippedNote)] },
  1: { label: 'json, fulfilment + tracking INDIA_POST', multipart: false, evidences: [fulfilment(indiaPost, shippedNote)] },
  2: { label: 'json, fulfilment notes only', multipart: false, evidences: [fulfilment(null, shippedNote)] },
  3: { label: 'json, fulfilment + tracking OTHER', multipart: false, evidences: [fulfilment(
    { carrier_name: 'OTHER', carrier_name_other: 'India Post', tracking_number: tn },
    `Shipped with India Post (carrier OTHER), tracking number ${tn}.`)] },
  4: { label: 'json, all three requested types', multipart: false, evidences: [
    fulfilment(indiaPost, shippedNote),
    { evidence_type: 'PROOF_OF_REFUND', notes: 'Not applicable: no refund / no signature available.' },
    { evidence_type: 'PROOF_OF_DELIVERY_SIGNATURE', notes: 'Not applicable: no refund / no signature available.' }] },
  5: { label: 'multipart input, fulfilment notes only', multipart: true, evidences: [fulfilment(null, shippedNote)] },
};

const variant = process.env.VARIANT ?? '';
const v = VARIANTS[variant];
if (!v) throw new Error(`Set VARIANT to one of ${Object.keys(VARIANTS).join(', ')}:\n${Object.entries(VARIANTS).map(([k, x]) => `  ${k}  ${x.label}`).join('\n')}`);
const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) throw new Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env');
const disputeId = process.env.DISPUTE_ID;
if (!disputeId) throw new Error('Set DISPUTE_ID, e.g. DISPUTE_ID=PP-R-IUT-10193562');
const detailsFile = `dispute-details-${disputeId}.json`;
const details = JSON.parse(fs.readFileSync(path.join(OUT, detailsFile), 'utf8'));
if (details.dispute_id !== disputeId) throw new Error(`${detailsFile} holds dispute ${details.dispute_id}, not ${disputeId}`);
const omitItemId = process.env.OMIT_ITEM_ID === '1';
if (process.env.OMIT_ITEM_ID && !omitItemId) throw new Error(`Unknown OMIT_ITEM_ID=${process.env.OMIT_ITEM_ID}; use OMIT_ITEM_ID=1 or leave it unset`);
console.log(`variant ${variant}: ${v.label}${omitItemId ? ' (OMIT_ITEM_ID=1: no item_id)' : ''}`);

const { access_token } = await call(`${BASE}/v1/oauth2/token`, {
  method: 'POST',
  headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=client_credentials',
});
const auth = { Authorization: `Bearer ${access_token}` };
const disputeUrl = `${BASE}/v1/customer/disputes/${encodeURIComponent(disputeId)}`;
const get = (label: string) => attempt(`GET /v1/customer/disputes/${disputeId} (${label})`, disputeUrl, { method: 'GET', headers: auth });

// 1. Preconditions, from a fresh read.
const pre = await get('before');
save(`dispute-before-provide-evidence-v${variant}.json`, pre.ok ? pre.body : { status: pre.status, debug_id: pre.debug_id, body: pre.body });
if (!pre.ok) process.exit(0);
const b = pre.body;
const requested = (b.evidences ?? []).filter((e: any) => e.source === 'REQUESTED_FROM_SELLER');
const link = (b.links ?? []).find((l: any) => l.rel === 'provide_evidence');
console.log(`before: stage ${b.dispute_life_cycle_stage} status ${b.status} state ${b.dispute_state} due ${b.seller_response_due_date ?? 'absent'}`);
console.log(`requested from seller: ${requested.map((e: any) => e.evidence_type).join(', ') || 'none'}`);
console.log(`links: ${(b.links ?? []).map((l: any) => l.rel).join(', ') || 'none'}`);
if (!requested.length || !link?.href) {
  console.log(`\nstopping, nothing sent: ${!requested.length ? 'no REQUESTED_FROM_SELLER evidences' : ''}${!requested.length && !link?.href ? ' and ' : ''}${!link?.href ? 'no provide_evidence link' : ''}`);
  process.exit(0);
}

// Disputed items live in disputed_transactions[].items[]. The T-005 dispute had one SERVICE item and no item_id.
const items = (b.disputed_transactions ?? []).flatMap((t: any) => t.items ?? []);
console.log(`disputed items:${items.length ? '' : ' none'}`);
for (const it of items) console.log(`  item_id ${it.item_id ?? 'absent'} | item_name ${it.item_name ?? 'absent'} | item_type ${it.item_type ?? 'absent'}`);
const itemIds = [...new Set(items.map((it: any) => it.item_id).filter(Boolean))] as string[];
// One evidence entry can carry one item_id; with several items, which evidence belongs to which item is a choice, not a default.
if (itemIds.length > 1 && !omitItemId) {
  console.log(`\nstopping, nothing sent: ${itemIds.length} item_ids (${itemIds.join(', ')}); choose one per evidence before sending`);
  process.exit(0);
}
const useItemId = itemIds.length > 0 && !omitItemId;
const evidences: Record<string, unknown>[] = useItemId ? v.evidences.map((e) => ({ ...e, item_id: itemIds[0] })) : v.evidences;
if (useItemId) console.log(`item_id ${itemIds[0]} added to every evidence entry`);
else if (omitItemId) console.log(`OMIT_ITEM_ID=1: item_id left out of every evidence entry${itemIds.length ? ` (dispute has ${itemIds.join(', ')})` : ''}`);

const notRequested = evidences.map((e) => e.evidence_type).filter((t) => !requested.some((e: any) => e.evidence_type === t));
if (notRequested.length) console.log(`warning: sending types PayPal did not request: ${notRequested.join(', ')}`);
console.log(`note: dispute status is ${b.status}`);

// 2. The chosen variant. For multipart, FormData sets Content-Type with the boundary itself.
const input = { evidences };
let init: RequestInit;
if (v.multipart) {
  const form = new FormData();
  form.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }));
  init = { method: 'POST', headers: auth, body: form };
} else {
  init = { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(input) };
}
const contentType = v.multipart ? 'multipart/form-data' : 'application/json';
const urlPath = new URL(link.href).pathname;
console.log(`\nPOST ${urlPath} (${contentType}${v.multipart ? ', part "input"' : ''})\nbody: ${JSON.stringify(input)}`);
const posted = await attempt(`POST ${urlPath} variant ${variant}`, link.href, init);
if (posted.ok) console.log(JSON.stringify(redact(posted.body), null, 2));
save(`provide-evidence-response-v${variant}.json`, {
  variant: Number(variant), label: v.label, omit_item_id: omitItemId,
  request: { method: 'POST', path: urlPath, content_type: contentType, ...(v.multipart ? { parts: { input } } : { body: input }) },
  response: posted,
});
const issues = (posted.body?.details ?? []).map((d: any) => d.issue).join(',');

if (!posted.ok) {
  console.log(`\nno poll: POST returned ${posted.status}`);
  console.log(`DECISIONS.md row: T-007 v${variant}${omitItemId ? " no-item_id" : ""} | ${v.label} | ${posted.status} ${posted.body?.name ?? ''} ${issues} | debug ${posted.debug_id} | not polled`);
  process.exit(0);
}

// 3. Poll after a 2xx: writes have shown up late before (require-evidence applied ~25 s after its 200).
const snap = (d: any) => ({
  status: d.status, state: d.dispute_state,
  evidences: (d.evidences ?? []).map((e: any) => `${e.evidence_type}/${e.source}/${e.date}`),
  links: (d.links ?? []).map((l: any) => l.rel),
  allowed_response_options: d.allowed_response_options ? Object.keys(d.allowed_response_options) : 'absent',
});
let last: any = b;
let prev = snap(b);
const t0 = Date.now();
while (Date.now() - t0 < 90_000) {
  await new Promise((r) => setTimeout(r, 5000));
  const g = await get(`poll +${Math.round((Date.now() - t0) / 1000)}s`);
  if (!g.ok) continue;
  last = g.body;
  const now = snap(g.body);
  for (const k of Object.keys(now) as (keyof typeof now)[])
    if (JSON.stringify(now[k]) !== JSON.stringify(prev[k])) console.log(`  changed ${k}: ${JSON.stringify(prev[k])} → ${JSON.stringify(now[k])}`);
  prev = now;
}
save(`dispute-after-provide-evidence-v${variant}.json`, last);

const final = snap(last);
console.log(`\nfinal: status ${final.status} state ${final.state} | links ${final.links.join(',')} | allowed_response_options ${JSON.stringify(final.allowed_response_options)}`);
console.log(`evidences:\n  ${final.evidences.join('\n  ')}`);
console.log(`\nDECISIONS.md row: T-007 v${variant}${omitItemId ? " no-item_id" : ""} | ${v.label} | ${posted.status} | debug ${posted.debug_id} | after 90s: ${final.status} / ${final.state} | links ${final.links.join(', ')} | evidences ${final.evidences.length}`);
