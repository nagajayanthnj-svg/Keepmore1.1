# Phase 0 findings: PayPal disputes in sandbox

Written 2026-10-20 for the product owner. It covers the Phase 0 sandbox spike on 2026-10-19 (build plan T-001 to T-008).
Every fact comes from a saved PayPal response or webhook in `tests/fixtures/paypal/`. The detail, with the file for each fact, is in `docs/DECISIONS.md` ("Phase 0 close-out"). Surprises are logged in `docs/FRICTION_LOG.md` (F-xx).
Times are UTC. Money is USD.

## 1. Go / no-go for the disputes feature: **GO**

1. **We took real disputes from opening to closing through the API, with both outcomes.**
   - Dispute 3 was **won**: RESOLVED_SELLER_FAVOUR, and the 47.34 hold came back.
   - Dispute 1 was **lost** by accepting the claim: RESOLVED_BUYER_FAVOUR, and 120.00 was refunded.
2. **Every seller action we tried worked when PayPal offered it:**
   - send a message
   - submit evidence, at both the inquiry and the chargeback stage
   - escalate
   - add supporting information
   - accept the claim, with a note
   - require-evidence and adjudicate, which are sandbox-only
3. **The app can track the money and the status without guessing.**
   - Each dispute's hold equals the order's net amount.
   - A win shows a "hold released" line; a loss shows a settlement debit.
   - Signed webhooks arrived for dispute created, updated and resolved, and for the refund.
   - The CUSTOMER.DISPUTE.RESOLVED webhook arrived for both closed disputes, so the app can listen for closure.

**The one limit: evidence on disputes that open directly as chargebacks.** PayPal rejected evidence on both of them (disputes 1 and 2) for a reason we couldn't find. For those, evidence submission is shown as a labelled **"Simulated demo"** (Decision 5). On disputes that start as an inquiry and are escalated, it works.

## 2. What is verified and what is assumed

**Verified (a saved PayPal response shows it):**

| Fact | Where |
|---|---|
| The dispute hold equals the capture's net amount (114.12, 28.27, 47.34) | captures and dispute fund_movements |
| A win adds HOLD_RELEASED for the full hold; a loss adds SELLER DEBIT of the gross as DISPUTE_SETTLEMENT, with no hold release | disputes 3 and 1, final state |
| Money lines appear before the status changes (dispute 3: 69.6 s earlier) | dispute 3, final state |
| Seller actions are exactly the links on the latest read; they appear and disappear, and their order is shuffled | dispute 3, every read |
| Evidence (PROOF_OF_FULFILLMENT, notes only) is accepted at the inquiry stage and after escalation, and rejected on direct chargebacks | disputes 1, 2 and 3 |
| Accept-claim needs a note: an empty body fails | dispute 1 |
| An inquiry moved itself to chargeback 2 min 47 s after we escalated | dispute 3 |
| Adjudicate links appeared 27.9–28.5 min after review began | dispute 3 |
| Resolved and refund webhooks arrive, signed, after the money moves | 2 resolved webhooks, 1 refund webhook |
| The refund webhook shows paypal_fee 0.00 on a 120.00 refund | refund webhook |
| PayPal's sandbox fee fits about 4.6% + $0.36 (exact on 3 of 4 captures, 1 cent off on the 4th) | 4 captures |
| seller_protection is ELIGIBLE on all 4 captures | captures |

**Assumed or unverified:**

| Assumption | Why it isn't verified |
|---|---|
| The fee is not returned on a lost dispute | No balance or transaction record was saved. The refund's paypal_fee 0.00 points that way. |
| A lost dispute costs the seller exactly the fee (−5.88 on 120.00) | A calculation. It assumes the 114.12 hold is used up by the settlement, which no response shows. |
| A webhook can be delivered twice with the same event ID | Seen in the listener's console; the saved file can't show it |
| The FBIL rate for INR | The sandbox refuses INR as the main currency, so no PayPal exchange rate could be observed |
| Production timings match the sandbox's (a 3-minute escalation, a 28-minute adjudicate link) | Sandbox only. In production, PayPal staff decide. |
| Why evidence fails on direct chargebacks | Not found (see section 6) |

## 3. Dispute state machine (from dispute 3)

"Who" says whether we caused the change or PayPal did on its own. The PayPal-triggered rows are the ones the sync job must expect without having made a call.

| # | Time | Stage / status | Seller actions available (links) | Trigger | Who |
|---|---|---|---|---|---|
| 1 | 16:07 | INQUIRY / not saved | not saved | Buyer opens "item not received". 47.34 hold placed at 16:11. | buyer, then PayPal (hold) |
| 2 | 17:40 | INQUIRY / WAITING_FOR_BUYER_RESPONSE | accept_claim, provide_evidence, send_message, escalate | Seller messages the buyer in PayPal's website at 17:39. PayPal also asks the seller for proof of fulfilment. | we (website); the status link is likely, not proven |
| 3 | 17:56 | INQUIRY / WAITING_FOR_BUYER_RESPONSE (no change) | the same | API send_message | we |
| 4 | 17:59 | INQUIRY / WAITING_FOR_BUYER_RESPONSE | accept_claim, send_message, escalate (**provide_evidence gone**) | API provide_evidence | we |
| 5 | 18:05 | INQUIRY / UNDER_REVIEW | none (self only) | API escalate | we |
| 6 | 18:08 | **CHARGEBACK** / WAITING_FOR_SELLER_RESPONSE, due 29 Oct | accept_claim (REFUND, PARTIAL_REFUND), provide_evidence | **Moved to chargeback by itself**, 2 min 47 s after escalate. It requested 3 evidence types. | **PayPal** |
| 7 | 18:16 | CHARGEBACK / UNDER_REVIEW | provide_supporting_info | API provide_evidence (1 of 3 types) | we |
| 8 | 18:44 | CHARGEBACK / UNDER_REVIEW (no change) | + require_evidence, accept_claim, adjudicate | **Links appear by themselves, 27.9–28.5 min** after review began | **PayPal** |
| 9 | 18:45 | (no change yet) | | API adjudicate SELLER_FAVOR. This is a sandbox stand-in for PayPal's decision. | we (sandbox); PayPal in production |
| 10 | 18:46 | (no change yet) | | Money: HOLD_RELEASED 47.34 | **PayPal** |
| 11 | 18:47 | CHARGEBACK / RESOLVED, RESOLVED_SELLER_FAVOUR | none | Status catches up, 69.6 s after the money. The RESOLVED webhook arrives at 18:47:24. | **PayPal** |

**Lost path, for comparison (dispute 1):**
- Accept-claim with a note: SELLER DEBIT 120.00 and BUYER CREDIT 120.00 in the same second.
- UNDER_REVIEW immediately.
- RESOLVED / RESOLVED_BUYER_FAVOUR 1 min 44 s later.
- The RESOLVED webhook 31 s after that.

**No webhook was captured** for the PayPal-triggered link change in row 8 or the money in row 10, so the sync job has to poll as well as listen.

## 4. Money rules for the ledger

1. **Hold = the capture's net amount,** not the gross: 114.12 on a 120.00 sale, 47.34 on 50.00.
2. **Won dispute:** HOLD_RELEASED returns the full hold.
3. **Lost dispute:**
   - A settlement debit of the **gross** (SELLER DEBIT 120.00 DISPUTE_SETTLEMENT).
   - The hold is **not** released.
   - No fee-return line appears in fund_movements.
   - The refund shows paypal_fee 0.00.

   Expected seller effect: received 114.12, refunded 120.00, net **−5.88**, which is the fee. That figure is a calculation, not shown by PayPal (see section 6).
4. **Money moves before the status changes** (69.6 s on dispute 3). The money and the status must not be tied together.
5. **Read `fund_movements` as its own source of truth.** Record each line with its own time, and don't infer money from status, outcome or webhooks.

## 5. Design deltas for the Technical Design and PRD

Task IDs are from `KeepMore Technical Design and Build Plan.md`. The PRD column is left for the product owner.

| # | Change | Why (evidence) | Tasks affected | PRD |
|---|---|---|---|---|
| 1 | Make the fee table configurable and label fees **Estimated** | The sandbox fee is about 4.6% + $0.36, 1 cent off on one capture, and differs from the published India rate (F-05) | T-108, T-109, T-406 | to update |
| 2 | Take `seller_protection` from the capture response | All 4 capture fixtures carry seller_protection ELIGIBLE | T-108, T-111, T-301 | to update |
| 3 | Seller actions come **only** from the links on a fresh GET, looked up by `rel` | Links appear and disappear (F-32, F-39) and their order is shuffled (F-37) | T-204, T-210, T-306, T-401 | to update |
| 4 | Poll the dispute after every PayPal write until the change shows | Write responses carry no state, only a link, in two shapes (F-36); changes can lag (about 26 s after require-evidence on dispute 1, per the T-006 row; that fixture was overwritten) | T-205, T-210, T-211 | to update |
| 5 | accept_claim needs a seller note and an approval screen | An empty body fails (F-33); accepting refunds the buyer in full | T-209, T-211, T-401 | to update |
| 6 | Evidence view shows what PayPal requested against what the seller can support, and **never fabricates** missing types | Dispute 3 asked for 3 types; we could support 1. The submit is one-shot (F-32) | T-207, T-301, T-304, T-401 | to update |
| 7 | Deduplicate webhooks on **event ID** | A redelivery reuses the event ID (F-38) | T-202 | to update |
| 8 | INQUIRY and CHARGEBACK are **different workbench modes** | Different actions: message and escalate only at INQUIRY. Different evidence requests, due dates and refund types (F-29, F-31) | T-203, T-204, T-401, T-506 | to update |
| 9 | The demo needs a **pre-seeded resolved case** or a clearly labelled simulated "resolve" step | The adjudicate/resolve link takes 25–30 min to appear (F-39) | T-402, T-506, T-603 | to update |
| 10 | `OrderItem.sku` must be **letters and digits only** | PayPal's evidence item_id rejects "SKU-1042" (F-27) | T-103, T-110, T-111 | to update |
| 11 | Treat the INR rate (FBIL) as an **assumption** and label it Estimated | The sandbox rejects INR as the primary currency (F-04) | T-109 | to update |
| 12 | The ledger reads `fund_movements` independently of the status | Money moves before the status; a loss has no hold release (F-34, F-35) | T-108, T-403, T-406 | to update |

## 6. Open questions

| Question | Cheapest way to answer |
|---|---|
| **Why was evidence rejected on disputes 1 and 2? The cause is still unknown.** | Open one inquiry and escalate it without sending evidence first, then submit at chargeback. That separates "earlier inquiry evidence" from "reached chargeback by escalation". Optionally, a PayPal developer support ticket with the debug IDs in DECISIONS. |
| Is the fee returned on a lost dispute? | Read the sandbox business account's activity for 19 Oct in the PayPal website, or one Transaction Search API call. No new dispute needed. |
| What happens to the 114.12 hold on dispute 1? Is it used up by the settlement or released later? | The same activity or Transaction Search check |
| What does dispute 2 do after its due date (22 Oct, 18:29:59Z) passes with no seller response? | One GET of PP-R-OSP-10193570 after 22 Oct |
| How long do escalation and review take in production? | Seller interviews (T-010) and PayPal's published dispute timelines; the sandbox can't show it |
| Does PayPal send a webhook when actions become available or money moves? | Leave the listener running across one more full dispute and compare its events with polled reads |
| Does a PDF evidence file work (`evidence-file` part)? | One provide-evidence call with a small PDF on the next inquiry dispute |
| Does a hyphen-free SKU pass as `item_id`? | One order with SKU `SKU1042`, a dispute, and one evidence call |
| When does `make_offer` appear? | Not seen on 3 disputes; look for it on the next inquiry dispute |
