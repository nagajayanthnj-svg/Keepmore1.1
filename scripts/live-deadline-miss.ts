// Live check: what PayPal does with a dispute after the seller misses the response deadline. READ-ONLY on PayPal
// (one GET), plus the usual local sync into dev.db. Run it after the deadline has passed (PP-R-OSP-10193570 was due
// 22 Oct 2026 18:29:59 UTC = 23 Oct 00:00 IST):
//   npx tsx --env-file=.env scripts/live-deadline-miss.ts [PP-R-OSP-10193570]
// Prints status, stage, outcome, due date, the link rels PayPal still offers and money movements. Prints no names,
// emails or addresses. The full response is saved to live-check-out/ (gitignored) only.
import fs from 'node:fs';
import { syncDispute } from '../src/disputes/sync';
import { getSyncDeps } from '../src/lib/server-deps';

const id = process.argv[2] ?? 'PP-R-OSP-10193570';
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

async function main() {
  const deps = getSyncDeps();
  if (!deps) {
    console.error('PayPal sandbox credentials are not set in the environment.');
    process.exit(1);
  }
  const res = await deps.paypal.get<unknown>(`/v1/customer/disputes/${encodeURIComponent(id)}`);
  const d = obj(res.body);
  const links = Array.isArray(d.links) ? d.links.map((l) => String(obj(l).rel)) : [];
  const due = d.seller_response_due_date ? String(d.seller_response_due_date) : null;
  console.log(`now (UTC):           ${new Date().toISOString()}`);
  console.log(`dispute:             ${id}`);
  console.log(`status / stage:      ${String(d.status)} / ${String(d.dispute_life_cycle_stage)}`);
  console.log(`outcome:             ${JSON.stringify(d.dispute_outcome ?? null)}`);
  console.log(`seller due date:     ${due ?? '(none)'}${due ? (Date.parse(due) < Date.now() ? '   <- passed' : '   <- NOT passed yet') : ''}`);
  console.log(`link rels offered:   ${links.join(', ') || '(none)'}`);
  console.log(`update_time:         ${String(d.update_time)}`);
  const offer = obj(d.offer);
  console.log(`offer present:       ${Object.keys(offer).length ? 'yes' : 'no'}`);
  const mm = obj(d.money_movements);
  const moves = Array.isArray(d.money_movements) ? d.money_movements : Array.isArray(mm.items) ? mm.items : [];
  console.log(`money movements:     ${moves.length}`);
  for (const m of moves) {
    const x = obj(m);
    console.log(`  ${String(x.affected_party)} ${String(x.type)} ${JSON.stringify(x.amount ?? null)} at ${String(x.initiated_time)}`);
  }
  const messages = Array.isArray(d.messages) ? d.messages.length : 0;
  console.log(`messages:            ${messages}`);
  console.log(`top-level keys:      ${Object.keys(d).join(', ')}`);
  fs.mkdirSync('live-check-out', { recursive: true });
  const file = `live-check-out/deadline-miss-${id}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(file, JSON.stringify(res.body, null, 1));
  console.log(`full response saved: ${file}`);
  const r = await syncDispute(deps, id);
  console.log(`local sync:          created=${r.created} changed=${r.changed}`);
}
main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e).slice(0, 300));
  process.exit(1);
});
