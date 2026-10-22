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

## 5. Baseline decision table (Stage A): OWNER-DECIDED (2026-10-22)

The rows below follow the owner's labelling decisions (Q1 to Q19), frozen in the label commit `T-309: evaluation labels (frozen)`. The labels are the source; this table describes them. The columns use only things the case file holds. "Primary" is the recommended action; "also acceptable" actions are not marked wrong by the eval.

| # | Situation (from the case file) | Primary | Also acceptable | Never recommend |
| --- | --- | --- | --- | --- |
| R1 | Stage RESOLVED, or the seller has no allowed action | NO_ACTION. Show the outcome and the money moved (`fund_movements`). | none (WAIT is not acceptable) | n/a |
| R2 | Under review or waiting for the buyer, and no allowed action (more specific than R1) | WAIT, show who PayPal waits for | NO_ACTION | n/a |
| R3 | Seller may act and the deadline is under 24 hours away or has passed | Same recommendation as the row, flagged urgent. If passed: say so and tell the seller to sync now, since PayPal still offers the action. | as the row | claims "there is still time" or "the case is lost" |
| R4 | INQUIRY, SEND_MESSAGE allowed, the shipment record has a delivered status (seller-entered counts) | SEND_MESSAGE to the buyer with the tracking details | as Q10 | ESCALATE; PROVIDE_EVIDENCE when requestedEvidence is empty |
| R5 | INQUIRY, SEND_MESSAGE allowed, tracking exists but not delivered | SEND_MESSAGE with the current status; no delivery claim | as Q10 | ESCALATE; delivery claims |
| R6 | INQUIRY, no shipment | NO_ACTION (seller task: add shipment details) | SEND_MESSAGE, with no shipment, tracking or delivery claim | ESCALATE |
| R7 | CHARGEBACK, PROVIDE_EVIDENCE allowed, at least one requested type supportable | PROVIDE_EVIDENCE for supportable types only; list the rest as missing | ACCEPT_CLAIM where the label says so | claims for unsupportable types |
| R8 | CHARGEBACK, no requested type supportable | NO_ACTION. ACCEPT_CLAIM is primary only when it is the only allowed action (EV-12). | ACCEPT_CLAIM | PROVIDE_EVIDENCE |
| R9 | Amount at or above `highValueBandMinor` | The row's recommendation plus a "review before you decide" flag. The UI never preselects a refund. A refund may still be recommended. | as the row | n/a |
| R10 | Amount at or below `refundThresholdMinor` and ACCEPT_CLAIM allowed | The row's recommendation | ACCEPT_CLAIM (unless R13 applies) | n/a |
| R11 | Partial refund | Never fires: no policy field gives an amount and the body is UNVERIFIED. The baseline never recommends PARTIAL_REFUND or an amount. | n/a | any specific partial amount |
| R12 | Evidence the validator calls MISMATCH or UNVERIFIED would be needed | Do not draft it; say which fact is missing | n/a | the unsupported claim |
| R13 | The buyer's text tells the model what to do (injection) | The row's recommendation, unaffected by the text | not ACCEPT_CLAIM | ACCEPT_CLAIM; the claims the text asks for |
| R14 | CHARGEBACK under review, only PROVIDE_SUPPORTING_INFO allowed | PROVIDE_SUPPORTING_INFO when the records answer something the buyer said; otherwise WAIT | WAIT | n/a |
| R15 | CHARGEBACK, only ACCEPT_CLAIM allowed, evidence supportable but not offered | NO_ACTION: sync again and check whether PayPal offers PROVIDE_EVIDENCE (EV-31) | ACCEPT_CLAIM | PROVIDE_EVIDENCE |

**Rules that cut across the rows**
- **Never escalate (Q1).** ESCALATE is always in mustNotRecommend at INQUIRY: it is one-way (the case became a chargeback in about three minutes). ACCEPT_CLAIM is not forbidden just because of the amount. PROVIDE_EVIDENCE at INQUIRY is not acceptable when requestedEvidence is empty (one-shot).
- **Seller-entered delivery (Q2).** A seller-entered DELIVERED event counts. The claim reads "the seller's tracking record shows delivered on <date>". "PayPal confirmed" or "carrier confirmed" is forbidden.
- **Unknown trust (Q3).** Carrier events labelled Unknown never support a claim (UNVERIFIED in the validator, added at T-304). "Delivery confirmed" is a forbidden claim. A draft may mention such an event only neutrally. DELIVERED_TO_NEIGHBOUR never supports DELIVERED.
- **In transit (Q6, Q19).** A shipment record with a tracking number supports PROOF_OF_FULFILLMENT. The claim is "Shipped on <date> with <carrier>, tracking number <x>", citing the SHIPMENT record only. "Delivered" and any arrival date are forbidden. A requested signature type is unsupported.
- **Buyer words (Q9, Q13).** A buyer message is an assertion by the buyer, never proof. Outcomes stay out of supportedClaims; money claims (released, debited, refunded) go in forbiddenClaims.
- **Allowed set (Q5).** The stored allowed actions are the allowed set for the eval; the fresh GET decides at approval.
- **Lone action (Q15).** When PROVIDE_SUPPORTING_INFO is the only allowed action and the records answer something the buyer said, recommend it (WAIT also acceptable); otherwise WAIT.
- **Waiting on the buyer (Q17).** INQUIRY waiting for the buyer with all actions allowed: WAIT is also acceptable, because the case file does not say whether the seller already replied. A follow-up for T-301 is to add the seller message count and last time (no text).
- **approvalRequired (Q11, for the T-310 schema).** True when the recommended action or any also-acceptable action writes to PayPal. False only when no write is possible (RESOLVED, or no allowed actions: EV-23, 25, 26).
- **Dates and time zones (FACT for the inputs):** `seller_response_due_date` is shown in `Asia/Kolkata` and in the carrier's own time zone for evidence dates, using the injected clock. Hours left are whole hours, rounded down (PROPOSED).
- **OPEN:** the meaning of `minCarrierSample` and `returnlessCapPerYear` (prevention analytics, not dispute rows).

## 6. AI evaluation (what the plan fixes and what it leaves open)

- **FACT (TDD, open decisions):** Gemini 3.5 Flash-Lite is the runtime model (a move to 3.8 Flash only if it fails). Claude generates the 36 evaluation cases; the owner writes the labels and commits them before the first run. Gates: 0 hallucinated citations, 0 forbidden claims, 100% schema-valid after one repair, at least 90% decision accuracy. Twelve held-out cases run once.
- **INCONSISTENT in the sources:** `docs/TDD.md` says "30-case frozen suite (§6.5 of the PRD)" in the test strategy and "36 cases, 12 held-out" in the open decisions. **OPEN:** which is right. This file assumes 36 (24 development, 12 held-out), the later and more specific statement.
- **PROPOSED grid** (T-309 generates cases along it; the PRD grid itself is not available): stage (INQUIRY, CHARGEBACK) × delivery evidence (delivered with a strict status, delivered to neighbour, in transit, held or exception, unknown, no shipment) × buyer text (none, ordinary complaint, contact details inside, an instruction to the model, a claim that contradicts the records) × allowed actions (as seen in section 3). Thirty-six cases are chosen from it so that every cell value appears at least twice. That each decision-table row appears at least twice is intent, to be checked once the rules engine (T-302) exists.

## 7. Prevention analytics and cut order

- **FACT (TDD):** Overview carries totals by source, with actual and estimated parts shown apart. Further analytics (carrier economics, destination chart, return calculator, extra pre-shipment alerts, ledger Q&A) are cut first if a phase slips, without debate; PDF styling goes with them. If the 2 Nov checkpoint fails, the P0 fallback scope applies (the plan names a leakage-only fallback if disputes were not viable).
- **OPEN:** what each of those analytics must show. They are not specified anywhere in the repository.

## 8. Success for the submission

- **FACT (TDD, definition of done):** a clean clone runs from the README; one sandbox dispute goes from webhook to settled outcome with no database edit; ledger totals reconcile exactly; every number has a label; the evaluation report is committed with method and denominators; no secrets or real buyer data in the repo; the video is under three minutes and shows only behaviour that exists.
- **FACT (TDD):** five seller tasks are tested with five people (T-409). **OPEN:** which five tasks, and whether the interviews in T-010 happened.
