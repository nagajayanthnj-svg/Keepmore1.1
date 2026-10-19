// T-003 spike: push tracking for the T-002 capture; save redacted request and response fixtures.
// Run: npx tsx --env-file=.env scripts/spike-t003.ts
// Optional: CARRIER=INDIA_POST (enum value tried first), TRACKING_NUMBER=EE123456789IN, FIXTURE=capture-usd-primary.json
// If PayPal rejects the carrier, retries once with carrier OTHER and carrier_name_other "India Post".
// A rejection is a finding: status, debug ID and body are saved and printed for DECISIONS.md; the script exits 0.
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://api-m.sandbox.paypal.com';
const OUT = path.resolve('tests/fixtures/paypal');
// account_id added after T-002: it carries the payer ID that payer_id redaction hides.
const PII = new Set(['email_address', 'payer_id', 'account_id', 'merchant_id', 'given_name', 'surname', 'full_name',
  'address_line_1', 'address_line_2', 'admin_area_1', 'admin_area_2', 'postal_code', 'national_number']);

const redact = (v: any): any =>
  Array.isArray(v) ? v.map(redact)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, PII.has(k) ? `REDACTED_${k.toUpperCase()}` : redact(x)]))
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

// Unlike call(), never throws on an HTTP error: for T-003 the error response is the result.
async function attempt(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { raw_text: text }; }
  return { status: res.status, ok: res.ok, debug_id: res.headers.get('paypal-debug-id') ?? body?.debug_id ?? null, body };
}

const fixture = process.env.FIXTURE ?? 'capture-usd-primary.json';
// Output names carry the capture's label (capture-physical-30.json → physical-30); the original run keeps its old names.
const runLabel = fixture.replace(/^capture-/, '').replace(/\.json$/, '');
const labelled = (name: string) => (runLabel === 'usd-primary' ? name : `${runLabel}-${name}`);
const carrier = process.env.CARRIER ?? 'INDIA_POST';
const trackingNumber = process.env.TRACKING_NUMBER ?? 'EE123456789IN';
const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) throw new Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env');

const captured = JSON.parse(fs.readFileSync(path.join(OUT, fixture), 'utf8'));
const orderId: string = captured.id;
const cap = captured.purchase_units?.[0]?.payments?.captures?.[0];
if (!orderId || !cap?.id) throw new Error(`No order id or capture id in ${fixture}`);
const minutes = (Date.now() - Date.parse(cap.create_time)) / 60000;
console.log(`order ${orderId} capture ${cap.id} captured ${cap.create_time} (${minutes.toFixed(0)} min ago${minutes > 60 ? ', OUTSIDE the first hour' : ''})`);

const { access_token } = await call(`${BASE}/v1/oauth2/token`, {
  method: 'POST',
  headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=client_credentials',
});
const headers = (key: string) => ({
  Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json',
  'PayPal-Request-Id': key, Prefer: 'return=representation',
});

const url = `${BASE}/v2/checkout/orders/${orderId}/track`;
const push = async (name: string, payload: Record<string, unknown>) => {
  save(`track-request-${labelled(name)}.json`, { method: 'POST', path: `/v2/checkout/orders/${orderId}/track`, body: payload });
  const r = await attempt(url, { method: 'POST', headers: headers(`spike-track-${name}-${cap.id}-${Date.now()}`), body: JSON.stringify(payload) });
  save(`track-response-${labelled(name)}.json`, { status: r.status, debug_id: r.debug_id, body: r.body });
  console.log(`\n${name}: ${r.status} debug_id=${r.debug_id}\n${JSON.stringify(redact(r.body), null, 2)}`);
  return r;
};

const base = { capture_id: cap.id, tracking_number: trackingNumber, notify_payer: false };
const first = await push(`carrier-${carrier.toLowerCase()}`, { ...base, carrier });

// Retry only when the error points at the carrier field; any other failure is recorded as is.
const carrierRejected = !first.ok && (first.body?.details ?? []).some((d: any) => /carrier/i.test(`${d.field ?? ''} ${d.description ?? ''}`));
const second = carrierRejected
  ? await push('carrier-other', { ...base, carrier: 'OTHER', carrier_name_other: 'India Post' })
  : null;

const row = (r: typeof first) => r.ok ? `${r.status} OK` : `${r.status} debug_id=${r.debug_id} ${r.body?.name ?? ''} ${(r.body?.details ?? []).map((d: any) => d.issue).join(',')}`.trim();
console.log(`\nDECISIONS.md row: T-003 | ${minutes.toFixed(0)} min after capture | carrier ${carrier}: ${row(first)}${second ? ` | carrier OTHER/India Post: ${row(second)}` : first.ok ? '' : ' | no retry (error not about carrier)'}`);
console.log('Record the exact status, debug ID and body in DECISIONS.md. Do not start T-004 until recorded.');
