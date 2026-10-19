// T-004 spike: receive PayPal webhooks, save redacted event + transmission headers, verify the signature.
// Run: npx tsx --env-file=.env scripts/spike-t004.ts   (optional PORT=3000)
// Then expose it over HTTPS (e.g. `ngrok http 3000`), register https://<tunnel>/webhooks/paypal in the sandbox app
// with PAYMENT.CAPTURE.COMPLETED, put that webhook's ID in .env as PAYPAL_WEBHOOK_ID, restart, and trigger a capture
// (RUN_LABEL=webhook npx tsx --env-file=.env scripts/spike-t002.ts).
// Each request is saved as tests/fixtures/paypal/webhook-<event-type>-<transmission-id>.json, then updated with the verify result.
// A FAILURE or an error from the verify call is a finding: status, debug ID and body are saved and printed.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const BASE = 'https://api-m.sandbox.paypal.com';
const OUT = path.resolve('tests/fixtures/paypal');
const PII = new Set(['email_address', 'payer_id', 'account_id', 'merchant_id', 'given_name', 'surname', 'full_name',
  'address_line_1', 'address_line_2', 'admin_area_1', 'admin_area_2', 'postal_code', 'national_number']);
const HEADERS = ['paypal-transmission-id', 'paypal-transmission-time', 'paypal-transmission-sig', 'paypal-cert-url', 'paypal-auth-algo'] as const;

const redact = (v: any): any =>
  Array.isArray(v) ? v.map(redact)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, PII.has(k) ? `REDACTED_${k.toUpperCase()}` : redact(x)]))
  : v;

const save = (name: string, data: unknown) => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(redact(data), null, 2));
  console.log(`saved tests/fixtures/paypal/${name}`);
};

const port = Number(process.env.PORT ?? 3000);
const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret, PAYPAL_WEBHOOK_ID: webhookId } = process.env;
if (!id || !secret) throw new Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env');
if (!webhookId) throw new Error('Set PAYPAL_WEBHOOK_ID in .env (the ID of the webhook registered for the tunnel URL)');

// Sandbox tokens last hours; refresh a minute before expiry so a long-running listener keeps working.
let token = { value: '', expiresAt: 0 };
async function accessToken() {
  if (Date.now() < token.expiresAt) return token.value;
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`POST /v1/oauth2/token → ${res.status} debug_id=${res.headers.get('paypal-debug-id')}\n${JSON.stringify(body, null, 2)}`);
  token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
  return token.value;
}

// The signature covers the raw bytes, so webhook_event is spliced in as the raw body rather than re-serialised.
async function verify(raw: string, h: Record<string, string | null>) {
  const fields = JSON.stringify({
    auth_algo: h['paypal-auth-algo'], cert_url: h['paypal-cert-url'], transmission_id: h['paypal-transmission-id'],
    transmission_sig: h['paypal-transmission-sig'], transmission_time: h['paypal-transmission-time'], webhook_id: webhookId,
  });
  const res = await fetch(`${BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: `${fields.slice(0, -1)},"webhook_event":${raw}}`,
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { raw_text: text }; }
  return { status: res.status, ok: res.ok, debug_id: res.headers.get('paypal-debug-id') ?? body?.debug_id ?? null, body };
}

// Event IDs handled in this run. A redelivery keeps its event ID, so a repeat is reported.
const seen = new Set<string>();

async function handle(raw: string, h: Record<string, string | null>) {
  let event: any = null;
  try { event = JSON.parse(raw); } catch { /* saved as raw_text below */ }
  const tid = h['paypal-transmission-id'] ?? `no-transmission-id-${Date.now()}`;
  const name = `webhook-${(event?.event_type ?? 'unparsed').toLowerCase().replace(/\./g, '-')}-${tid}.json`;
  const fixture: Record<string, unknown> = { received_at: new Date().toISOString(), headers: h, body: event ?? { raw_text: raw } };
  save(name, fixture);

  // Dispute events carry their ID in resource.dispute_id; order and capture events use resource.id.
  const resourceId = event?.resource?.dispute_id ?? event?.resource?.id ?? '?';
  console.log(`\nevent ${event?.id ?? '?'} type ${event?.event_type ?? '?'} resource ${resourceId} transmission ${tid}`);
  if (event?.id && seen.has(event.id)) console.log(`duplicate event ${event.id}`);
  if (event?.id) seen.add(event.id);
  const missing = HEADERS.filter((k) => !h[k]);
  if (missing.length) console.log(`missing headers: ${missing.join(', ')}`);
  if (!event) return console.log('body is not JSON; verify skipped');

  const r = await verify(raw, h);
  save(name, { ...fixture, verification: r });
  console.log(r.ok
    ? `verification_status ${r.body?.verification_status}`
    : `verify call failed: ${r.status} debug_id=${r.debug_id}\n${JSON.stringify(r.body, null, 2)}`);
  console.log(`DECISIONS.md row: T-004 | ${event.event_type} | resource ${resourceId} | verify ${r.ok ? r.body?.verification_status : `${r.status} debug ${r.debug_id}`}`);
}

http.createServer((req, res) => {
  if (req.url?.split('?')[0] !== '/webhooks/paypal') { res.writeHead(404).end(); return; }
  if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return; }
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    // Answer before saving or verifying so PayPal never times out and retries.
    res.writeHead(200).end();
    const raw = Buffer.concat(chunks).toString('utf8');
    const h = Object.fromEntries(HEADERS.map((k) => [k, (req.headers[k] as string | undefined) ?? null]));
    handle(raw, h).catch((e) => console.error(`handler error: ${e instanceof Error ? e.message : e}`));
  });
}).listen(port, () => console.log(`listening on http://localhost:${port}/webhooks/paypal`));
