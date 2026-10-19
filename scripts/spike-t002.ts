// T-002 spike: create, approve, capture; save redacted fixtures.
// Optional: AMOUNT=50.00 (default 120.00) to solve percent + fixed fee from two captures.
// Optional: ITEMS=physical adds one PHYSICAL_GOODS line item (Handloom saree, SKU-1042) with item_total = AMOUNT.
// Run: RUN_LABEL=usd-primary npx tsx --env-file=.env scripts/spike-t002.ts
// Then switch the business account's primary currency to INR and run again with RUN_LABEL=inr-primary.
// Fixtures are saved per label (capture-usd-primary.json, capture-inr-primary.json).
// Use a sandbox BUSINESS account registered in India and a PERSONAL account registered in the US.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

const BASE = 'https://api-m.sandbox.paypal.com';
const OUT = path.resolve('tests/fixtures/paypal');
const PII = new Set(['email_address', 'payer_id', 'account_id', 'merchant_id', 'given_name', 'surname', 'full_name',
  'address_line_1', 'address_line_2', 'admin_area_1', 'admin_area_2', 'postal_code', 'national_number']);

const redact = (v: any): any =>
  Array.isArray(v) ? v.map(redact)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, PII.has(k) ? `REDACTED_${k.toUpperCase()}` : redact(x)]))
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

const label = process.env.RUN_LABEL ?? 'usd-primary';
const amount = process.env.AMOUNT ?? '120.00';
// ITEMS=physical sends a line item so disputes see a physical good; without items the T-005 dispute showed item_type SERVICE.
const physical = process.env.ITEMS === 'physical';
const purchaseUnit = physical
  ? {
      reference_id: 'order_1042',
      amount: { currency_code: 'USD', value: amount, breakdown: { item_total: { currency_code: 'USD', value: amount } } },
      items: [{ name: 'Handloom saree', sku: 'SKU-1042', quantity: '1', category: 'PHYSICAL_GOODS', unit_amount: { currency_code: 'USD', value: amount } }],
    }
  : { reference_id: 'order_1042', amount: { currency_code: 'USD', value: amount } };
if (process.env.ITEMS && !physical) throw new Error(`Unknown ITEMS=${process.env.ITEMS}; only ITEMS=physical is supported`);
const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) throw new Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env');

const { access_token } = await call(`${BASE}/v1/oauth2/token`, {
  method: 'POST',
  headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=client_credentials',
});
const headers = (key: string) => ({
  Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json',
  'PayPal-Request-Id': key, Prefer: 'return=representation',
});

const order = await call(`${BASE}/v2/checkout/orders`, {
  method: 'POST', headers: headers(`spike-create-${Date.now()}`),
  body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [purchaseUnit] }),
});
save(`order-created-${label}.json`, order);

const approve = order.links.find((l: any) => l.rel === 'payer-action' || l.rel === 'approve')?.href;
console.log(`\nApprove as the US sandbox PERSONAL account:\n${approve}\n`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question('Press Enter after approving...');
rl.close();

// Poll until PayPal reports APPROVED; capturing earlier fails with ORDER_NOT_APPROVED.
let status = '';
for (let i = 0; i < 30; i++) {
  const o = await call(`${BASE}/v2/checkout/orders/${order.id}`, { method: 'GET', headers: headers(`spike-poll-${order.id}-${i}`) });
  status = o.status;
  if (status === 'APPROVED') break;
  if (status !== 'CREATED') throw new Error(`Unexpected order status ${status}; expected CREATED or APPROVED`);
  console.log(`order status ${status}, waiting for approval...`);
  await new Promise((r) => setTimeout(r, 2000));
}
if (status !== 'APPROVED') throw new Error('Order not APPROVED after 60s; approve it in the browser and rerun');

const captured = await call(`${BASE}/v2/checkout/orders/${order.id}/capture`, {
  method: 'POST', headers: headers(`spike-capture-${order.id}`),
});
save(`capture-${label}.json`, captured);

const cap = captured.purchase_units?.[0]?.payments?.captures?.[0];
const b = cap?.seller_receivable_breakdown;
console.log(`\ncapture ${cap?.id} status ${cap?.status}`);
console.log(b ? `gross ${b.gross_amount?.value} fee ${b.paypal_fee?.value} net ${b.net_amount?.value} ${b.net_amount?.currency_code}` : 'seller_receivable_breakdown MISSING');
console.log(b?.exchange_rate ? `exchange_rate ${b.exchange_rate.value} ${b.exchange_rate.source_currency}->${b.exchange_rate.target_currency}` : 'exchange_rate missing (expected; FBIL fallback)');
if (b) console.log(`fee ${b.paypal_fee?.value} on ${b.gross_amount?.value} = ${(100 * Number(b.paypal_fee?.value) / Number(b.gross_amount?.value)).toFixed(3)}% of gross (page said 4.40% + 0.30 = 5.58 on 120)`);
console.log(`\nDECISIONS.md row: capture-${label} | net ${b?.net_amount?.value} ${b?.net_amount?.currency_code} | fee ${b?.paypal_fee?.value} | exchange_rate ${b?.exchange_rate ? `${b.exchange_rate.value} ${b.exchange_rate.source_currency}->${b.exchange_rate.target_currency}` : 'absent'}`);
console.log('Run both labels (usd-primary, inr-primary), record both rows, then do T-003.');
