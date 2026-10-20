// T-202 live check, part 2: what the webhook receiver stored. Reads only the app database (dev.db); calls nothing.
// Run after you have caused PayPal events (steps in the PR / chat):
//   npx tsx --env-file=.env scripts/live-t202.ts
// Prints each stored event (id, type, verified, result, seconds from received to processed) and the dispute's last sync.
// Expected for a real dispute event: verified true, result SYNCED or similar. For a simulator event: verified false, UNVERIFIED.
// Saves a copy to live-check-out/ (gitignored) only. Event ids are not secret; no bodies or headers are stored by the app.
import fs from 'node:fs';
import { getDb } from '../src/lib/server-deps';

async function main() {
  const db = getDb();
  const events = await db.webhookEvent.findMany({ orderBy: { receivedAt: 'asc' } });
  console.log(`stored webhook events: ${events.length}`);
  const rows = events.map((e) => ({
    eventId: e.eventId,
    type: e.type,
    verified: e.verified,
    result: e.result,
    received: e.receivedAt.toISOString(),
    secondsToProcess: e.processedAt ? (e.processedAt.getTime() - e.receivedAt.getTime()) / 1000 : null,
  }));
  for (const r of rows) {
    console.log(`  ${r.received}  ${r.type}  verified=${r.verified}  result=${r.result}  processed in ${r.secondsToProcess ?? '?'} s  id=${r.eventId}`);
  }
  const byResult = new Map<string, number>();
  for (const r of rows) byResult.set(`${r.verified ? 'verified' : 'UNVERIFIED'} ${r.result ?? '?'}`, (byResult.get(`${r.verified ? 'verified' : 'UNVERIFIED'} ${r.result ?? '?'}`) ?? 0) + 1);
  console.log('summary:', JSON.stringify(Object.fromEntries(byResult)));
  const cases = await db.disputeCase.findMany({ orderBy: { paypalDisputeId: 'asc' } });
  for (const c of cases) console.log(`  case ${c.paypalDisputeId}  ${c.status}  last synced ${c.lastSyncedAt.toISOString()}`);
  fs.mkdirSync('live-check-out', { recursive: true });
  fs.writeFileSync('live-check-out/t202-events.json', `${JSON.stringify(rows, null, 2)}\n`);
  console.log('saved: live-check-out/t202-events.json (gitignored)');
}

main().catch((e) => {
  console.log(`CRASHED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
