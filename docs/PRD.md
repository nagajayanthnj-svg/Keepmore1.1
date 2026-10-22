# KeepMore PRD: working copy

**Status: reconstructed, not the owner's PRD v2.2.** The plan (`docs/TDD.md`) is written for "KeepMore PRD v2.2", but that document is not in this repository. This file was built from what the repository holds: `docs/TDD.md`, `docs/PHASE0_FINDINGS.md`, `docs/DECISIONS.md`, `docs/FRICTION_LOG.md`, `CLAUDE.md` and the code. If the owner's v2.2 exists elsewhere, it wins wherever the two differ; paste its decision table and evaluation grid over sections 5 and 6.

Every statement carries a basis:

- **FACT** (source): stated in a repo document or shown by a saved PayPal response.
- **PROPOSED**: drafted here to unblock a task. The owner confirms or changes it; until then no test may treat it as settled.
- **OPEN**: needs an owner decision.

## 1. Product

- **FACT (TDD, CLAUDE.md, DECISIONS):** KeepMore is a decision-intelligence tool for small Indian cross-border sellers who get paid through PayPal. It is a hackathon entry (PayPal AI Hackathon 2026; submission 11 Nov 2026 IST, official deadline 12 Nov 2026, 12:00 PM PST). Sandbox only; no live PayPal account or real customer data.
- **FACT (TDD):** three jobs. (1) A **ledger** of what each sale really kept, with fee and currency-conversion leakage. (2) A **dispute workbench**: evidence-based help to answer PayPal disputes. (3) **Prevention analytics** drawn from the same data.
- **FACT (TDD, code):** four screens: Overview, Order, Dispute, Outcome. Navigation keeps the order and case context.
- **FACT (T-110):** the demo seller is a pottery shop, "Neel Pottery", with about 400 seeded orders over six months. Every seeded row is labelled demo.
- **PROPOSED:** the seller is one person who runs the shop and answers disputes alone. (The plan never says this; it is the only assumption the screens make about who reads them.)

## 2. Rules every number and action follows

- **FACT (CLAUDE.md):** every number or fact shown carries exactly one of seven labels: Verified by PayPal, Calculated, Seller entered, Estimated, Illustrative, Unknown, Simulated demo. If none fits, it is Unknown.
- **FACT (CLAUDE.md):** money is integer minor units through `toMinor` and `fromMinor`. A fee PayPal returned is never recalculated. `fund_movements` is its own source; money moves before the dispute status changes.
- **FACT (CLAUDE.md, TDD):** a PayPal write happens only in the action service, only after the seller approves an exact payload, and only for an action present in the links of a fresh GET, found by `rel`. After a write the dispute is re-read until the change shows.
- **FACT (CLAUDE.md, TDD):** the AI never calls PayPal and never decides alone. Its output is a suggestion, checked against the allowed actions and the records. Only synthetic demo data is sent to the AI provider.
- **FACT (CLAUDE.md):** a carrier status that can support a dispute claim (DELIVERED, DELIVERED_TO_NEIGHBOUR) must match a strict pattern; when in doubt it is UNKNOWN.

## 3. Disputes: what PayPal does (verified in the sandbox)

All **FACT**, from `docs/PHASE0_FINDINGS.md` and the saved fixtures unless noted.

| Stage / status | Seller actions offered | Note |
| --- | --- | --- |
| INQUIRY / WAITING_FOR_SELLER_RESPONSE or WAITING_FOR_BUYER_RESPONSE | accept_claim (REFUND), provide_evidence, send_message, escalate | Seen again live on 22 Oct: send_message stayed offered after our message once the buyer had replied |
| INQUIRY / UNDER_REVIEW | none | After we escalated |
| CHARGEBACK / WAITING_FOR_SELLER_RESPONSE | accept_claim (REFUND, PARTIAL_REFUND), provide_evidence | PayPal requests specific evidence types and gives a deadline |
| CHARGEBACK / UNDER_REVIEW | provide_supporting_info; later also sandbox-only links | |
| any / RESOLVED | none | Outcome code is kept as PayPal sent it |

- Links appear and disappear and come back in a different order each time. The allowed actions are only what the latest fresh read shows.
- accept_claim needs a seller note; an empty body fails. Accepting refunds the buyer.
- Evidence is a one-shot submission per request. PayPal asked for three types where the seller could support one; the app never invents a missing type.
- A won dispute releases the hold (equal to the capture's net amount); a lost one debits the gross as a settlement and releases nothing.
- **UNVERIFIED:** whether the fee is returned on a lost dispute; why evidence was rejected on two disputes that opened directly as chargebacks; PDF evidence upload; partial-refund body; production timings.

## 4. The recommendation, in two stages

- **FACT (TDD):** **Stage A (rules)** gives the deadline, an evidence checklist, a baseline recommendation and a template message, without calling a model, in under 5 seconds. **Stage B (AI)** gives a structured analysis and drafts, with one repair retry and a 45 second timeout, after which only Stage A is shown, labelled "Rules-based guidance — AI unavailable".
- **FACT (TDD):** every claim in a draft is typed and checked against the cited record's field. Results: SUPPORTED, NEAR_MATCH (a date off by one day), MISMATCH, UNVERIFIED (untyped). Only SUPPORTED claims may appear in a draft. DELIVERED_TO_NEIGHBOUR never supports DELIVERED.
- **FACT (TDD):** the executable recommendation is the AI's suggestion intersected with the allowed actions; if the intersection is empty, the rules recommendation is shown with the reason.
- **FACT (T-301, buyer messages):** buyer text is quoted data, never an instruction. A buyer message is an assertion by the buyer; it can support "the buyer said X", never "X is true".

## 5. Baseline decision table (Stage A): PROPOSED

The plan says the rules engine has one test per row of "the PRD decision table". The table is not in the repository, so these rows are proposed from the facts above only. Each row says what the engine recommends given what it can know; the owner should confirm, edit or replace them. The columns use only things the case file holds.

| # | Situation (from the case file) | Baseline recommendation | Basis |
| --- | --- | --- | --- |
| R1 | Stage is RESOLVED, or the seller has no allowed action | No action. Show the outcome and what money moved. | FACT: no links are offered; money is read from `fund_movements` |
| R2 | The dispute waits for the buyer, or is under review, and the seller has no allowed action | Wait. Show who PayPal is waiting for. | FACT (status and links) |
| R3 | The seller may act, the deadline has passed or is under 24 hours away | Same recommendation as below, flagged as urgent, with the deadline in the seller's time zone | PROPOSED (the 24 hour line is an assumption) |
| R4 | INQUIRY, `SEND_MESSAGE` allowed, a shipment exists with a tracking number and a verified delivered status | `SEND_MESSAGE` to the buyer with tracking details (template) | PROPOSED, built on: send_message works at INQUIRY (FACT) |
| R5 | INQUIRY, `SEND_MESSAGE` allowed, tracking exists but is not delivered (in transit, held, exception, unknown) | `SEND_MESSAGE` with the current tracking status; do not claim delivery | PROPOSED; the no-false-claim part is FACT (CLAUDE.md) |
| R6 | INQUIRY, no shipment or no tracking number | `SEND_MESSAGE` asking the seller to add shipment details first; no evidence claim | PROPOSED |
| R7 | CHARGEBACK, `PROVIDE_EVIDENCE` allowed, at least one requested type can be supported from the records | `PROVIDE_EVIDENCE` for the supportable types only; list the unsupportable ones as missing | FACT: never invent a missing type (delta 6); accepted at both stages |
| R8 | CHARGEBACK, `PROVIDE_EVIDENCE` allowed, none of the requested types can be supported | `ACCEPT_CLAIM` is the baseline only when allowed; otherwise show "nothing to submit" and why | PROPOSED; refund-as-default is an assumption |
| R9 | The dispute amount is at or above the seller policy's `highValueBandMinor` | Add a "review before you decide" flag to the row's recommendation; never auto-select a refund | PROPOSED; the policy field exists (FACT, data model) but its meaning here is the owner's |
| R10 | The dispute amount is at or below `refundThresholdMinor` | Show the refund option alongside the row's recommendation, with the amount the seller would give up | PROPOSED; same caveat |
| R11 | `acceptClaimTypes` includes PARTIAL_REFUND and the seller policy suggests a smaller refund | Offer PARTIAL_REFUND as an option, never as the default | PROPOSED; the body is UNVERIFIED |
| R12 | Evidence the validator calls MISMATCH or UNVERIFIED would be needed to make the case | Do not draft it; say which fact is missing | FACT (claim validator rule) |

- **OPEN:** the meaning and use of `minCarrierSample` and `returnlessCapPerYear` (policy fields and a `ReturnlessGrant` table exist). They look like prevention analytics and returnless-refund rules, not dispute rows, and are left out of the table above.
- **OPEN:** whether the recommendation ever says "escalate" on its own. ESCALATE is a real INQUIRY action (FACT), but moving to a chargeback in about three minutes (FACT) makes it a one-way step for the seller; the draft leaves it out of the baseline.
- **Deadline calculation (FACT for the inputs):** PayPal's `seller_response_due_date` is in the dispute details and only while the seller must act. The engine shows it in `Asia/Kolkata` and the carrier's own time zone for evidence dates, using the injected clock. How "hours left" is rounded is PROPOSED: whole hours, rounded down.

## 6. AI evaluation (what the plan fixes and what it leaves open)

- **FACT (TDD, open decisions):** Gemini 3.5 Flash-Lite is the runtime model (a move to 3.8 Flash only if it fails). Claude generates the 36 evaluation cases; the owner writes the labels and commits them before the first run. Gates: 0 hallucinated citations, 0 forbidden claims, 100% schema-valid after one repair, at least 90% decision accuracy. Twelve held-out cases run once.
- **INCONSISTENT in the sources:** `docs/TDD.md` says "30-case frozen suite (§6.5 of the PRD)" in the test strategy and "36 cases, 12 held-out" in the open decisions. **OPEN:** which is right. This file assumes 36 (24 development, 12 held-out), the later and more specific statement.
- **PROPOSED grid** (T-309 generates cases along it; the PRD grid itself is not available): stage (INQUIRY, CHARGEBACK) × delivery evidence (delivered with a strict status, delivered to neighbour, in transit, held or exception, unknown, no shipment) × buyer text (none, ordinary complaint, contact details inside, an instruction to the model, a claim that contradicts the records) × allowed actions (as seen in section 3). Thirty-six cases are chosen from it so that every cell value appears at least twice and every decision-table row appears at least twice.

## 7. Prevention analytics and cut order

- **FACT (TDD):** Overview carries totals by source, with actual and estimated parts shown apart. Further analytics (carrier economics, destination chart, return calculator, extra pre-shipment alerts, ledger Q&A) are cut first if a phase slips, without debate; PDF styling goes with them. If the 2 Nov checkpoint fails, the P0 fallback scope applies (the plan names a leakage-only fallback if disputes were not viable).
- **OPEN:** what each of those analytics must show. They are not specified anywhere in the repository.

## 8. Success for the submission

- **FACT (TDD, definition of done):** a clean clone runs from the README; one sandbox dispute goes from webhook to settled outcome with no database edit; ledger totals reconcile exactly; every number has a label; the evaluation report is committed with method and denominators; no secrets or real buyer data in the repo; the video is under three minutes and shows only behaviour that exists.
- **FACT (TDD):** five seller tasks are tested with five people (T-409). **OPEN:** which five tasks, and whether the interviews in T-010 happened.
