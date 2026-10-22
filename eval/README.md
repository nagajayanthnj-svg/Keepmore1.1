# Evaluation suite (T-309)

36 invented dispute cases for the AI evaluation (`npm run eval`, T-310/T-311). 24 are for development; 12 are held out and run once at the end.

- `cases/EV-01.json` to `EV-36.json`: the inputs. Each is a sealed case file (`src/case/case-file.ts`) with an evaluation time (`asOf`) and a `split` (`dev` or `heldout`). **No answers are in them.**
- `grid.json`: how each case sits on the grid (stage, delivery, buyer text, allowed actions, amount band, deadline). Every value of every dimension appears at least twice (checked by `tests/unit/eval-cases.test.ts`).
- `labels/`: the owner's answers, one file per case. **Written by the owner, never by the model under test.**
- `generate-cases.ts`: how the cases were made (`npx tsx eval/generate-cases.ts`). Everything in them is invented: no real person, address, order or tracking number.
- `show-case.ts`: prints a case in plain words for labelling (`npx tsx eval/show-case.ts EV-07`; no argument lists all 36).

## What the grid covers, and what it does not

Covers: INQUIRY and CHARGEBACK; delivery evidence of six kinds (delivered, delivered to a neighbour, in transit, held or exception, unknown, no shipment); buyer text of five kinds (none, ordinary, contact details inside, an instruction to the model, a claim that contradicts the records); six sets of allowed actions; amounts below, at and above the policy thresholds; deadlines that are absent, normal, under 24 hours and already passed; resolved cases; a case with no seller policy.

Does not cover: dispute reasons other than "item not received" (no rules or fixtures exist for others), currencies other than USD, carriers other than India Post, files as evidence, more than two buyer messages, and signed-delivery records (the app has no such record type, so any "signature" request can only be answered as unsupported).

## Steps for the owner (T-309)

1. Read `docs/PRD.md` section 5 and fix or confirm the decision table. The labels follow it.
2. List the cases (`npx tsx eval/show-case.ts`), then read each one (`npx tsx eval/show-case.ts EV-01`). Skim the 12 held-out ones last.
3. For each case copy `labels/_template.json` to `labels/EV-NN.json` and write: the recommended action, any other acceptable action, what must never be recommended, whether approval is required, the claims the records support (with record ids), and the claims they do not support. Write from the records and the table, **not** from any model output.
4. Commit the labels on their own: `T-309: evaluation labels (frozen)`. The cases are already committed; the labels commit must come before the first eval run.
5. Record the date, the count and the hash of the label files in `docs/DECISIONS.md`. After that the labels do not change; a mistake found later is recorded as a mistake, not edited.
