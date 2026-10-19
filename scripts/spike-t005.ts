// T-005 spike: fetch the details of the sandbox dispute opened as the buyer; save a redacted fixture.
// Run: DISPUTE_ID=PP-R-IUT-10193562 npx tsx --env-file=.env scripts/spike-t005.ts
// Success saves tests/fixtures/paypal/dispute-details-<DISPUTE_ID>.json (the body as PayPal returned it, redacted).
// Failure saves dispute-details-error.json (status, debug ID, body) so a bad run never overwrites a good fixture.
// A 403 or other error is a finding: the full body is printed for DECISIONS.md; the script exits 0.
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

const disputeId = process.env.DISPUTE_ID;
const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) throw new Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env');
if (!disputeId) throw new Error('Set DISPUTE_ID, e.g. DISPUTE_ID=PP-R-IUT-10193562');

const { access_token } = await call(`${BASE}/v1/oauth2/token`, {
  method: 'POST',
  headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=client_credentials',
});

// Unlike call(), never throws on an HTTP error: for T-005 the error response is the result.
const res = await fetch(`${BASE}/v1/customer/disputes/${encodeURIComponent(disputeId)}`, {
  method: 'GET', headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
});
const text = await res.text();
let body: any;
try { body = JSON.parse(text); } catch { body = { raw_text: text }; }
const debugId = res.headers.get('paypal-debug-id') ?? body?.debug_id ?? null;

console.log(`GET /v1/customer/disputes/${disputeId} → ${res.status} debug_id=${debugId}`);
console.log(JSON.stringify(redact(body), null, 2));

if (!res.ok) {
  save('dispute-details-error.json', { status: res.status, debug_id: debugId, body });
  if (res.status === 403) console.log(`\n403 full error body:\n${text}`);
  console.log(`\nDECISIONS.md row: T-005 | GET dispute ${disputeId} | ${res.status} | debug ${debugId} | ${body?.name ?? ''} ${(body?.details ?? []).map((d: any) => d.issue).join(',')}`.trim());
} else {
  save(`dispute-details-${disputeId}.json`, body);
  // allowed_response_options is an object keyed by action (accept_claim, make_offer, ...), each listing its allowed types.
  const options = Object.entries(body.allowed_response_options ?? {}).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  const rels = (body.links ?? []).map((l: any) => `${l.rel} (${l.method})`);
  console.log(`\ndispute_life_cycle_stage ${body.dispute_life_cycle_stage}`);
  console.log(`status ${body.status}`);
  console.log(`reason ${body.reason ?? body.dispute_reason ?? 'MISSING'}`);
  console.log(`allowed_response_options:${options.length ? `\n  ${options.join('\n  ')}` : ' none'}`);
  console.log(`link rels:${rels.length ? `\n  ${rels.join('\n  ')}` : ' none'}`);
  console.log(`\nDECISIONS.md row: T-005 | GET dispute ${disputeId} | ${res.status} | debug ${debugId} | stage ${body.dispute_life_cycle_stage} | status ${body.status} | reason ${body.reason ?? body.dispute_reason} | options ${Object.keys(body.allowed_response_options ?? {}).join(',') || 'none'} | rels ${(body.links ?? []).map((l: any) => l.rel).join(',') || 'none'}`);
}
