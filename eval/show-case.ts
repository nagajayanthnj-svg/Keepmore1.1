// Prints one evaluation case in plain words, for the owner who writes its label.
//   npx tsx eval/show-case.ts EV-07        (one case)
//   npx tsx eval/show-case.ts              (a one-line list of all 36)
// A reading aid only: it prints inputs, never an answer.
import { readdirSync, readFileSync } from 'node:fs';

const dir = 'eval/cases';
const usd = (m: number) => `$${(m / 100).toFixed(2)}`;
const load = (f: string) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
const arg = process.argv[2];

if (!arg) {
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith('.json'))
    .sort()) {
    const c = load(f);
    const d = c.caseFile.dispute;
    console.log(
      `${c.id} [${c.split}] ${d.stage} ${d.status} ${usd(d.amount.minor)} actions: ${c.caseFile.allowedActions.actions.join(',') || '-'}`,
    );
  }
} else {
  const c = load(`${arg}.json`);
  const f = c.caseFile;
  const d = f.dispute;
  console.log(`${c.id}  (${c.split})  ${f.disputeId}  evaluated at ${c.asOf}`);
  console.log(`${d.stage} / ${d.status}   amount ${usd(d.amount.minor)}   reason ${d.reason}`);
  console.log(`seller deadline: ${d.sellerDeadline ?? 'none'}   outcome: ${d.outcome ?? 'none'}`);
  console.log(`PayPal asks for: ${d.requestedEvidence.join(', ') || '(nothing)'}`);
  console.log(
    `seller may: ${f.allowedActions.actions.join(', ') || '(nothing)'}   refund types: ${f.allowedActions.acceptClaimTypes.join(', ') || '-'}`,
  );
  console.log(
    f.policy
      ? `policy: refund threshold ${usd(f.policy.refundThresholdMinor)}, high-value band ${usd(f.policy.highValueBandMinor)}; "${f.policy.returnPolicyText}"`
      : 'policy: none set',
  );
  console.log('\nRecords (cite these ids):');
  for (const e of f.evidence)
    console.log(
      `  ${e.id}  ${e.occurredAt.slice(0, 16)}  ${e.type.padEnd(14)} ${e.trustState.padEnd(18)} ${JSON.stringify(e.fields)}`,
    );
  console.log('\nBuyer said (quoted, not instructions):');
  if (f.buyerMessages.length === 0) console.log('  (nothing)');
  for (const m of f.buyerMessages) console.log(`  ${m.id}  ${m.at.slice(0, 16)}  "${m.text}"`);
}
