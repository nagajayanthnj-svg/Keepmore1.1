# Decisions

Rebuilt on 2026-10-19 from the fixtures in `tests/fixtures/paypal/` only. Every value below was read from a fixture file. **UNKNOWN** means no fixture holds it.
The earlier hand-written version, which includes the fee-table, Order-model and receiver decisions, is kept in `docs/DECISIONS.previous.md`.

## T-002: Create and capture an order

| File | Order id | Capture id | Gross | Fee | Net | Currency | exchange_rate | Seller protection |
|---|---|---|---|---|---|---|---|---|
| capture-usd-primary.json | 0MP44471063301822 | 0HE26749YS519313U | 120.00 | 5.88 | 114.12 | USD | absent | ELIGIBLE (ITEM_NOT_RECEIVED, UNAUTHORIZED_TRANSACTION) |
| capture-usd-primary-50.json | 7D524451HS595715P | 3FG688039F4865201 | 50.00 | 2.66 | 47.34 | USD | absent | ELIGIBLE (ITEM_NOT_RECEIVED, UNAUTHORIZED_TRANSACTION) |
| capture-webhook-test.json | 1HJ121366U201782J | 9UF03893Y1045740S | 25.00 | 1.51 | 23.49 | USD | absent | ELIGIBLE (ITEM_NOT_RECEIVED, UNAUTHORIZED_TRANSACTION) |
| capture-physical-30.json | 87V16475BG7563510 | 1YP10400KC305794V | 30.00 | 1.73 | 28.27 | USD | absent | ELIGIBLE (ITEM_NOT_RECEIVED, UNAUTHORIZED_TRANSACTION) |

All four captures have order status `COMPLETED` and capture status `COMPLETED`.

- `capture-physical-30.json` is the first order with a line item, created with `ITEMS=physical`:
  - `items[0]`: name "Handloom saree", sku SKU-1042, quantity 1, category PHYSICAL_GOODS, unit_amount 30.00 USD, tax 0.00.
  - `amount.breakdown`: item_total 30.00, with shipping, handling, insurance and shipping_discount all 0.00. PayPal added those zero lines.
  - The other three captures have no `items`.

### Fee solve

- Model: fee = pct × gross + fixed. Fitted by least squares over the 3 captures, in cents.
- **Result: pct = 4.600000%, fixed = 0.360000 USD.**
- Check against each capture:
  - 120.00 × 4.6% + 0.36 = 5.880000 (fixture: 5.88)
  - 50.00 × 4.6% + 0.36 = 2.660000 (fixture: 2.66)
  - 25.00 × 4.6% + 0.36 = 1.510000 (fixture: 1.51)
- **Max rounding error: 0.000000 USD.** The fit is exact on all 3 captures, with no rounding needed.
- These are sandbox values only. Fixtures can't show the live fee.

**Update with the 4th capture (`capture-physical-30.json`): the model no longer fits exactly.**

- 30.00 × 4.6% + 0.36 = 1.740000, but the fixture says **1.73**. The error is −0.01.
- A search over pct 4.000–5.000% (step 0.001%) and fixed 0.00–0.60 found **no** pct + fixed that matches all 4 fees under round, floor, ceil or half-even rounding.
- Least squares over all 4: 4.6046% + 0.3549. Max |error| is 0.0063, on the 30.00 capture.
- The 30.00 capture is the only one with a line item. Whether the fee depends on items or category can't be told from one capture.
- **What still holds:** the fee table stays an Estimated, configurable input, and the ledger's `PAYPAL_FEE` uses `paypal_fee` from the breakdown. The estimate should allow for at least ±0.01.

## T-003: Push tracking

| Field | Value | From |
|---|---|---|
| Endpoint | POST /v2/checkout/orders/0MP44471063301822/track | track-request-carrier-india_post.json |
| capture_id sent | 0HE26749YS519313U | track-request |
| Carrier used | INDIA_POST | track-request |
| tracking_number | EE123456789IN | track-request |
| HTTP result | 201 | track-response-carrier-india_post.json |
| paypal-debug-id | f961617146d7d | track-response |
| Tracker id | 0HE26749YS519313U-EE123456789IN | track-response, body.purchase_units[0].shipping.trackers[0].id |
| Tracker status | SHIPPED | track-response |
| notify_payer | false | track-response |
| Carrier echoed in tracker | absent | track-response |
| Tracker links | up GET, update PATCH | track-response |
| Time of push | UNKNOWN | No timestamp in either track fixture |

- No `track-*-carrier-other.json` fixture exists, so there is no record of the `OTHER` + `carrier_name_other` retry being used.

## T-004: Webhooks

| File | Event id | event_type | Transmission id | Verification | ID lives at | ID |
|---|---|---|---|---|---|---|
| webhook-checkout-order-approved-d5dcb31d-….json | WH-8GB16439P46339531-1LP17214UY258491V | CHECKOUT.ORDER.APPROVED | d5dcb31d-cbd1-11f1-ab13-c9e968eda97c | SUCCESS | body.resource.id | 1HJ121366U201782J |
| webhook-payment-capture-completed-ffdd69a2-….json | WH-5BB36985X8409763E-4GM80755F7204952D | PAYMENT.CAPTURE.COMPLETED | ffdd69a2-cbd1-11f1-ab13-f11193100739 | SUCCESS | body.resource.id | 9UF03893Y1045740S |
| webhook-customer-dispute-created-ef83831a-….json | WH-7B597241T1637435T-6EA85595X9192414U | CUSTOMER.DISPUTE.CREATED | ef83831a-cbd2-11f1-9883-b7a2979917dd | SUCCESS | body.resource.dispute_id | PP-R-IUT-10193562 |
| webhook-customer-dispute-updated-01316c56-….json | WH-3JM34959RC553180R-0WE49516HL785403T | CUSTOMER.DISPUTE.UPDATED | 01316c56-cbd3-11f1-9e4a-a12b06d4272a | SUCCESS | body.resource.dispute_id | PP-R-IUT-10193562 |

- The transmission id is stored at `headers.paypal-transmission-id`. The verification status is stored at `verification.body.verification_status`.
- All 5 `PAYPAL-*` headers are present in all 4 fixtures.
- Dispute events have no `resource.id` key.

## Dispute case

Read from the two dispute webhook fixtures. The API reads are in the T-005 and T-006 sections.

| Field | CREATED event | UPDATED event |
|---|---|---|
| dispute_id | PP-R-IUT-10193562 | PP-R-IUT-10193562 |
| reason | MERCHANDISE_OR_SERVICE_NOT_RECEIVED | MERCHANDISE_OR_SERVICE_NOT_RECEIVED |
| dispute_life_cycle_stage | CHARGEBACK | CHARGEBACK |
| status | UNDER_REVIEW | UNDER_REVIEW |
| dispute_amount | 120.00 USD | 120.00 USD |
| dispute_channel | INTERNAL | INTERNAL |
| Disputed seller_transaction_id | 0HE26749YS519313U | 0HE26749YS519313U |
| transaction_status | COMPLETED | HELD |
| create_time | 2026-10-19T15:33:52.521Z | 2026-10-19T15:33:52.521Z |
| update_time | 2026-10-19T15:36:36.749Z | 2026-10-19T15:37:13.663Z |
| Extra keys | none | fund_movements |

- The dispute is on capture `0HE26749YS519313U`. That is the 120.00 capture from `capture-usd-primary.json`, the one that got tracking in T-003. It is not the 25.00 webhook-test capture.

## T-005: Seller-side dispute read

T-005 | GET dispute | 200 | debug ca4d0f51ca9b3 | CHARGEBACK/UNDER_REVIEW/UNDER_PAYPAL_REVIEW | links: self, provide_supporting_info only | hold 114.12 USD HOLD_PLACED | decision: disputes GO (20 Oct)

> **This version of the fixture is gone.** The table below was read from `dispute-details.json` as saved at 2026-10-19 ~15:53Z. The file was overwritten at 16:17:07Z, after T-006, and again at 16:49:28Z with **dispute 2** (PP-R-OSP-10193570). The values below exist only in this document.

Checked against `dispute-details.json` (the ~15:53Z version):

| Field | Value | Source |
|---|---|---|
| HTTP status | 200 | Reported by you. Success saves the body only. |
| paypal-debug-id | ca4d0f51ca9b3 | Reported by you. **Not in any fixture.** |
| dispute_id | PP-R-IUT-10193562 | fixture |
| dispute_life_cycle_stage / status / dispute_state | CHARGEBACK / UNDER_REVIEW / UNDER_PAYPAL_REVIEW | fixture |
| reason | MERCHANDISE_OR_SERVICE_NOT_RECEIVED | fixture, `reason` (no `dispute_reason` key) |
| links | self GET, provide_supporting_info POST | fixture |
| allowed_response_options | absent | fixture |
| fund_movements | RECEIVER DEBIT 114.12 USD, reason HOLD_PLACED, 2026-10-19T15:37:04.000Z | fixture |
| evidences | 1 × CREATE, SUBMITTED_BY_BUYER, stage INQUIRY, 2026-10-19T15:33:52.521Z | fixture |
| Decision | disputes GO (20 Oct) | Your decision. Not a fixture value. |

- The hold of 114.12 equals the net of the 120.00 capture (`capture-usd-primary.json`), not the gross.
- The buyer's evidence was created at stage `INQUIRY`, but the dispute is now at `CHARGEBACK`. In sandbox it moved past the inquiry stage before the seller could respond.
- The only seller action available is `provide_supporting_info`. There is no `accept_claim`, `make_offer` or `allowed_response_options`. A dispute that reaches `INQUIRY` and stays there has not been seen yet.

## T-006: Seller actions

T-006 support | provide-supporting-info | JSON {"notes"} | 200 (no 415, no multipart) | debug ca4d107ccdc4f | state unchanged, supporting_info +1 (SUBMITTED_BY_SELLER)

Observation: links grew between T-005 and T-006 on the same dispute (+accept_claim, adjudicate, require_evidence); allowed_response_options = accept_claim REFUND. Derive actions from links on every fetch.

Checked against `dispute-before-supporting-info.json`, `supporting-info-response.json` and `dispute-after-supporting-info.json`:

| Field | Fixture value | Matches row? |
|---|---|---|
| Attempts | 1 attempt, application/json `{"notes"}` → 200. No 415, no multipart. | yes |
| Response body | one link, rel `detail` GET | — |
| paypal-debug-id | **f999727ea9322** | **no.** The row says ca4d107ccdc4f, which is in no fixture. |
| stage / status / state, before → after | CHARGEBACK/UNDER_REVIEW/UNDER_PAYPAL_REVIEW, unchanged | yes |
| supporting_info, before → after | 1 → 2. Both entries are SUBMITTED_BY_SELLER with the same notes, at 16:06:31.718Z and 16:10:37.262Z. | **partly.** +1 within this run, but **+2 since T-005**, which had 0. |
| Links at T-005 (`dispute-details.json`) | self, provide_supporting_info | — |
| Links before and after this run | self, accept_claim, adjudicate, require_evidence, provide_supporting_info | yes, the same 3 links added |
| allowed_response_options | absent at T-005; `accept_claim: {accept_claim_types: [REFUND]}` before and after | yes |

- **The support step ran twice.** The first submission (16:06:31Z) has no before fixture of its own, because the second run overwrote the files. That means the debug ID in the row may come from the first run, and the dispute now holds two identical seller notes.
- **When the links grew is unknown.** They were absent at T-005 (2026-10-19 15:53Z) and present by the second run's before GET. The first submission came in between. So the extra links could be caused by the seller submission, or they could appear with time in sandbox. The fixtures can't tell which.

### T-006 require

T-006 require-evidence | 200, debug f6786960af604 | applied ~26s later: WAITING_FOR_SELLER_RESPONSE / REQUIRED_ACTION | links self, accept_claim, provide_evidence | evidence requested: PROOF_OF_FULFILLMENT, PROOF_OF_REFUND, PROOF_OF_DELIVERY_SIGNATURE | due 2026-10-22T18:29:59Z

Design: poll after every PayPal write; derive actions from links; show requested-vs-available evidence; never fabricate missing types.

> **Dispute 1's require-evidence fixtures are gone.** `require-evidence-response.json` and `dispute-after-require-evidence.json` were overwritten at 16:52:18Z with dispute 2's require-evidence run (see Dispute 2). The dispute 1 state those writes led to (WAITING_FOR_SELLER_RESPONSE, update_time 16:13:43.009Z) survives as `dispute-details-first.json`. The check and table below were made against dispute 1's versions before that, and now exist only in this document.

Checked against the fixtures (dispute 1 versions, now overwritten). Everything matched, including the debug ID. The delay is 25.2 s by `update_time`, from 16:13:17.811Z in `dispute-after-require-evidence.json` to 16:13:43.009Z in the current `dispute-details.json`. The three requested evidences are all dated 16:13:17.811Z, which is the time of the call.

The re-read straight after the call, in `require-evidence-response.json` and `dispute-after-require-evidence.json`, showed the change had not landed yet:

| Field | Fixture value |
|---|---|
| Request | `{"action": "SELLER_EVIDENCE"}` |
| Result | 200, debug f6786960af604. The body is one `self` link. |
| Status after | CHARGEBACK/UNDER_REVIEW/UNDER_PAYPAL_REVIEW. **Not** WAITING_FOR_SELLER_RESPONSE, which the schema says this call sets. |
| Links after | self, provide_supporting_info. accept_claim, adjudicate and require_evidence are **gone**. |
| allowed_response_options after | absent |
| seller_response_due_date | absent |

- On the same dispute, in one evening, the action links changed 3 times across 4 snapshots, ending at self, accept_claim, provide_evidence. That supports the design rule above.

## T-007: Provide evidence

T-007 provide-evidence | multipart input, PROOF_OF_FULFILLMENT + tracking_info INDIA_POST | 400 EVIDENCE_TYPE_IS_NOT_ALLOWED | debug f181735b95b62 | state unchanged | next: JSON body variants

Checked against `dispute-before-provide-evidence.json`, `provide-evidence-response.json` and `dispute-after-provide-evidence.json`. Everything matches.

| Field | Fixture value |
|---|---|
| Request | multipart/form-data, part `input`: `{"evidences":[{"evidence_type":"PROOF_OF_FULFILLMENT","evidence_info":{"tracking_info":[{"carrier_name":"INDIA_POST","tracking_number":"EE123456789IN"}]},"notes":"..."}]}` |
| Result | 400 `INVALID_REQUEST`, details issue `EVIDENCE_TYPE_IS_NOT_ALLOWED`, debug f181735b95b62 |
| Before = after | CHARGEBACK/WAITING_FOR_SELLER_RESPONSE/REQUIRED_ACTION, update_time 16:13:43.009Z in both, links self, accept_claim, provide_evidence |
| Requested types | PROOF_OF_FULFILLMENT, PROOF_OF_REFUND, PROOF_OF_DELIVERY_SIGNATURE, all REQUESTED_FROM_SELLER at stage CHARGEBACK |

- **The error names the evidence type, not the format,** which suggests PayPal parsed the `input` part. PayPal's schema has no `EVIDENCE_TYPE_IS_NOT_ALLOWED` in its error list. The closest documented error is `INVALID_EVIDENCE_TYPE_PROOF_OF_FULFILLMENT`: "not a valid evidence type for this dispute reason and status".
- **PayPal rejected a type it had requested itself.** PROOF_OF_FULFILLMENT appears in the dispute's own REQUESTED_FROM_SELLER list. So changing only the body format may not change the result.
- **The disputed item is a SERVICE.** `dispute-details.json` shows `disputed_transactions[0].items` = one item: `item_name` "1", `item_type` SERVICE, no `item_id`. The T-002 order had no `items`. Shipment tracking for a SERVICE item is a likely cause of the 400. This is not verified: it needs an order created with `ITEMS=physical`.

### T-007 variants

T-007 v1,v2,v3,v5 | JSON/multipart, with/without tracking_info, INDIA_POST/OTHER | 400 EVIDENCE_TYPE_IS_NOT_ALLOWED (debug ca4d12e1f29dd, ca4d12f28497e, ca4d12e82ac91, ca4d12ee3ea7a)
T-007 v4 | three evidence items | 400 ITEM_ID_IS_MANDATORY_FOR_MULTIPLE_EVIDENCES (debug ca4d12f69d9dc)
Hypothesis: original order had no items (item_type SERVICE, item_name "1", no item_id); retest with PHYSICAL_GOODS order.

Checked against `provide-evidence-response-v1.json` to `-v5.json` and `dispute-before-provide-evidence-v1.json` to `-v5.json`. Everything matches, including all 5 debug IDs.

| Variant | Run (local) | Content type | Evidence sent | Result | debug |
|---|---|---|---|---|---|
| v1 | 22:02:40 | application/json | PROOF_OF_FULFILLMENT + tracking INDIA_POST | 400 EVIDENCE_TYPE_IS_NOT_ALLOWED | ca4d12e1f29dd |
| v3 | 22:02:56 | application/json | PROOF_OF_FULFILLMENT + tracking OTHER | 400 EVIDENCE_TYPE_IS_NOT_ALLOWED | ca4d12e82ac91 |
| v5 | 22:03:12 | multipart/form-data, `input` | PROOF_OF_FULFILLMENT, notes only | 400 EVIDENCE_TYPE_IS_NOT_ALLOWED | ca4d12ee3ea7a |
| v2 | 22:03:23 | application/json | PROOF_OF_FULFILLMENT, notes only | 400 EVIDENCE_TYPE_IS_NOT_ALLOWED | ca4d12f28497e |
| v4 | 22:03:33 | application/json | PROOF_OF_FULFILLMENT + tracking, PROOF_OF_REFUND, PROOF_OF_DELIVERY_SIGNATURE | 400 ITEM_ID_IS_MANDATORY_FOR_MULTIPLE_EVIDENCES | ca4d12f69d9dc |

- **The body format is ruled out.** JSON and multipart, with and without `tracking_info`, `INDIA_POST` and `OTHER` all get the same error. Combined with the first run (v0, f181735b95b62), that's 5 rejections of PROOF_OF_FULFILLMENT.
- **The type check comes before the content check.** v2 and v5 sent no tracking info, but got `EVIDENCE_TYPE_IS_NOT_ALLOWED`, not the schema's documented `MISSING_TRACKING_INFO`.
- **v4 can't be satisfied on this dispute.** PayPal requires an `item_id` per evidence when sending several, but the disputed item has no `item_id`. So this dispute can take at most one evidence entry per call.
- **The dispute didn't change.** All 5 before snapshots have update_time 16:13:43.009Z, status WAITING_FOR_SELLER_RESPONSE and links self, accept_claim, provide_evidence. No variant got a 2xx, so none polled.

## Physical-item retest: capture, tracking, dispute 2

capture-physical-30 | $30 PHYSICAL_GOODS item, SKU-1042 | fee 1.73 | net 28.27 USD | exchange_rate absent
T-003 (physical-30) | tracking push 4 min after capture | INDIA_POST | 201 | debug f178663d8c27a | tracker 1YP10400KC305794V-EE123456789IN
Fee model: 4.6% + 0.36 holds within 1 cent on 4 captures (25, 30, 50, 120); label Estimated.
Dispute 2 opened: PP-R-OSP-10193570 on capture 1YP10400KC305794V

Checked against the fixtures:

| Row | Fixture value | Matches? |
|---|---|---|
| capture-physical-30 | order 87V16475BG7563510, capture 1YP10400KC305794V, gross 30.00, fee 1.73, net 28.27 USD, exchange_rate absent, item Handloom saree / SKU-1042 / PHYSICAL_GOODS | yes |
| T-003 physical-30 | `track-request-physical-30-carrier-india_post.json`: order 87V16475BG7563510, capture 1YP10400KC305794V, INDIA_POST, EE123456789IN, notify_payer false. `track-response-…`: 201, debug f178663d8c27a, tracker 1YP10400KC305794V-EE123456789IN, SHIPPED | yes |
| "4 min after capture" | Not in any fixture: the track fixtures have no timestamp. The file was written at 16:43:09Z and the capture is 16:38:43Z, so about 4.4 min by file time. | not checkable from fixture data |
| Fee within 1 cent | Error of 4.6% + 0.36 against the fixture: 120.00 → 0.00, 50.00 → 0.00, 25.00 → 0.00, 30.00 → +0.01 | yes; the max is exactly 0.01, on 30.00 |
| Dispute 2 | `dispute-details.json`: PP-R-OSP-10193570, seller_transaction_id 1YP10400KC305794V | yes |

### Dispute 2: PP-R-OSP-10193570

From `dispute-details.json` (written 16:49:28Z) and `dispute-after-require-evidence.json` (written 16:52:18Z):

| Field | dispute-details.json | dispute-after-require-evidence.json |
|---|---|---|
| reason | MERCHANDISE_OR_SERVICE_NOT_RECEIVED | same |
| stage / status / state | CHARGEBACK / UNDER_REVIEW / UNDER_PAYPAL_REVIEW | same |
| create_time / update_time | 16:46:23.107Z / 16:49:16.382Z | 16:46:23.107Z / 16:49:54.167Z |
| dispute_amount | 30.00 USD | same |
| **items** | **item_id SKU-1042**, item_name Handloom saree, quantity 1, **item_type PRODUCT** | same |
| links | self | self, provide_supporting_info |
| allowed_response_options | absent | absent |
| evidences | CREATE / SUBMITTED_BY_BUYER / 16:46:23.107Z | same |
| fund_movements | RECEIVER DEBIT 28.27 USD HOLD_PLACED, 16:49:25Z | same |

- **First half of the hypothesis confirmed.** With a PHYSICAL_GOODS line item, the dispute's item is `PRODUCT` with an `item_id` (the SKU, SKU-1042). Dispute 1, with no items, had `SERVICE`, name "1" and no id. Whether PROOF_OF_FULFILLMENT is now accepted is **not tested yet**.
- **The `item_id` is the SKU.** That means `spike-t007.ts` will add `item_id: "SKU-1042"` to every evidence entry, which could also clear v4's `ITEM_ID_IS_MANDATORY_FOR_MULTIPLE_EVIDENCES`.
- Like dispute 1, dispute 2 went straight to CHARGEBACK. The hold of 28.27 equals the capture's net, as it did on dispute 1.
- **require-evidence on dispute 2 was rejected.** `require-evidence-response.json`: `{"action":"SELLER_EVIDENCE"}` → **400 `ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE`**, debug f90167004697b. At both reads the links held no `require_evidence`.

Dispute 2 PP-R-OSP-10193570 on PHYSICAL_GOODS order: item_type PRODUCT, item_id = SKU-1042 (order line sku), hold 28.27 USD
T-006 require-evidence on dispute 2, 7 min after creation | 400 ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE (debug f68659634e86a, f90167004697b); links then: self only → self + provide_supporting_info
Observation: sandbox actions appear over first ~30 min of a dispute. Call an action only if its link is present.

Checked against the fixtures:

| Row claim | Fixture value | Matches? |
|---|---|---|
| item_type PRODUCT, item_id SKU-1042 = order line sku | `dispute-details.json` item_id SKU-1042, item_type PRODUCT. `capture-physical-30.json` items[0].sku SKU-1042 | yes |
| hold 28.27 USD | fund_movements: RECEIVER DEBIT 28.27 USD HOLD_PLACED, 16:49:25Z | yes |
| 400 ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE | `require-evidence-response.json`: 400, that issue | yes |
| debug f90167004697b | `require-evidence-response.json` | yes |
| debug f68659634e86a | **In no fixture.** The second attempt overwrote the first attempt's response (F-24). | not checkable |
| 7 min after creation | Created 16:46:23.107Z. The surviving attempt's file was written 16:52:18Z, 5.9 min later by file time. The first attempt's time is not in any fixture. | not checkable exactly |
| links self only → self + provide_supporting_info | `dispute-details.json` (16:49:28Z): self. `dispute-after-require-evidence.json` (16:52:18Z): self, provide_supporting_info | yes |

How the observation squares with dispute 1, created 15:33:52Z:
- At 19 min (T-005 read, ~15:53Z): links self, provide_supporting_info.
- By the GET at 16:10:35Z (37 min by file time; update_time 16:06:31Z, 33 min): accept_claim, adjudicate and require_evidence had appeared.
- So on dispute 1, `require_evidence` appeared between about 19 and 37 minutes after creation. That's consistent with "~30 min", but from a single dispute.
- Dispute 2 had only provide_supporting_info at 6 min. When its later links appear is not yet observed. `spike-t008.ts` waits up to 40 min.

## T-007/T-008 outcome: provide-evidence unresolved in sandbox

T-007/T-008 provide-evidence PROOF_OF_FULFILLMENT: unresolved in sandbox.
EVIDENCE_TYPE_IS_NOT_ALLOWED on 6 variants across 2 disputes (service and product items).
With item_id "SKU-1042": INVALID_PARAMETER_SYNTAX on /evidences/0/item_id (debug ca4d1634dd9cf).
Debug IDs: f181735b95b62, ca4d12e1f29dd, ca4d12e82ac91, ca4d12ee3ea7a, ca4d12f28497e, ca4d166cd888c.
Fallback: evidence submit shown as "Simulated demo". Optional: raise with PayPal developer support using these debug IDs

### Decision 5: Evidence submission is shown as "Simulated demo"

- Sending PROOF_OF_FULFILLMENT to PayPal could not be made to work in sandbox. The product shows evidence submission with a visible **Simulated demo** label, per the TDD rule that anything simulated carries a label.
- Everything before that step was observed working in sandbox, on both disputes: webhooks, dispute read, require-evidence and the evidence request.

Checked against every provide-evidence fixture. All 7 reported debug IDs are in fixtures and match.

| Time (UTC) | Dispute (item) | Fixture | Request | Result | debug |
|---|---|---|---|---|---|
| 16:25:32 | 1 (SERVICE, no item_id) | provide-evidence-response.json | v0 multipart, tracking INDIA_POST | 400 EVIDENCE_TYPE_IS_NOT_ALLOWED | f181735b95b62 |
| 16:32:40 | 1 | provide-evidence-response-v1.json | v1 JSON, tracking INDIA_POST | 400 EVIDENCE_TYPE_IS_NOT_ALLOWED | ca4d12e1f29dd |
| 16:32:56 | 1 | provide-evidence-response-v3.json | v3 JSON, tracking OTHER | 400 EVIDENCE_TYPE_IS_NOT_ALLOWED | ca4d12e82ac91 |
| 16:33:12 | 1 | provide-evidence-response-v5.json | v5 multipart, notes only | 400 EVIDENCE_TYPE_IS_NOT_ALLOWED | ca4d12ee3ea7a |
| 16:33:23 | 1 | provide-evidence-response-v2.json | v2 JSON, notes only | 400 EVIDENCE_TYPE_IS_NOT_ALLOWED | ca4d12f28497e |
| 16:33:33 | 1 | provide-evidence-response-v4.json | v4 JSON, 3 types | 400 ITEM_ID_IS_MANDATORY_FOR_MULTIPLE_EVIDENCES | ca4d12f69d9dc |
| 17:08:59 | 2 (PRODUCT, item_id SKU-1042) | t008-PP-R-OSP-10193570-4-provide-evidence-response.json | JSON, tracking INDIA_POST, item_id SKU-1042 | 400 INVALID_PARAMETER_SYNTAX @ /evidences/0/item_id | ca4d1634dd9cf |
| 17:11:23 | 2 | provide-evidence-response-v1-2026-10-19T17-11-20-133Z.json | v1 JSON, tracking INDIA_POST, OMIT_ITEM_ID=1 | 400 EVIDENCE_TYPE_IS_NOT_ALLOWED | ca4d166cd888c |

- **"6 variants" is 6 rejections from 5 distinct variants.** v0, v1, v2, v3 and v5 ran on dispute 1, and v1 ran again on dispute 2 without item_id. They span both item types, which rules out the item type as the cause on its own. That disproves the F-20 hypothesis as the whole explanation.
- **Probable cause of INVALID_PARAMETER_SYNTAX, from PayPal's schema:**
  - `evidence.item_id` must match `^[A-Za-z0-9]+$`, letters and digits only. `SKU-1042` has a hyphen, so it can't pass.
  - The dispute's own `item_info.item_id` allows `^.*$`, so PayPal reports `SKU-1042` and then rejects it on the way back.
  - **Not tested:** whether an order with a hyphen-free SKU, such as `SKU1042`, gets past this and on to the type check.
  - Product implication: SKUs that may appear in disputes should be letters and digits only, or the evidence step can't reference the item.
- **Not in the rows: T-008's require-evidence on dispute 2 succeeded.** `t008-PP-R-OSP-10193570-2-require-evidence-response.json`: 200, debug ca4d1626fadd1.
  - The `require_evidence` link was present at the 17:08:23Z poll, 22 min after dispute 2 was created. Dispute 1's link appeared at 19–37 min, which fits "~30 min".
  - By 17:08:58Z the dispute was WAITING_FOR_SELLER_RESPONSE / REQUIRED_ACTION, with links self, accept_claim, provide_evidence. The same 3 types were requested at 17:08:25.286Z.
  - This time the change was visible within about 33 s.
- **Both disputes got the same deadline.** `seller_response_due_date` is 2026-10-22T18:29:59Z on dispute 1 and dispute 2. That is 23:59:59 IST, 3 days after both were requested. Two disputes is too few to call this a rule.

**For a PayPal developer support ticket:** the dispute IDs are PP-R-IUT-10193562 and PP-R-OSP-10193570.
- EVIDENCE_TYPE_IS_NOT_ALLOWED on a requested PROOF_OF_FULFILLMENT: f181735b95b62, ca4d12e1f29dd, ca4d12e82ac91, ca4d12ee3ea7a, ca4d12f28497e, ca4d166cd888c.
- `item_id` from the dispute rejected by the evidence pattern: ca4d1634dd9cf.
- ITEM_ID_IS_MANDATORY_FOR_MULTIPLE_EVIDENCES with no item_id available: ca4d12f69d9dc.

## Phase 0 close-out (written 2026-10-20 from fixtures)

Labels: **VERIFIED** = a fixture shows it. **CALCULATED** = arithmetic on VERIFIED values. **HYPOTHESIS** = an inference or a report that no fixture shows. **UNKNOWN** = no fixture says.
Times are UTC on 2026-10-19. "update" is the dispute's `update_time`, "saved" is the fixture's file time (to the second), "received" is a webhook fixture's `received_at`.

### Dispute 3: PP-R-RAV-10193566, the INQUIRY → escalate → won path

Capture 3FG688039F4865201, gross 50.00, fee 2.66, net 47.34 (`capture-usd-primary-50.json`). One item, `item_type` SERVICE, no `item_id`. Reason MERCHANDISE_OR_SERVICE_NOT_RECEIVED.

| Time | What | Stage / status / dispute_state | Links after | Who | Label | Source |
|---|---|---|---|---|---|---|
| 16:07:41 | Buyer opens the dispute | INQUIRY / UNKNOWN / UNKNOWN | UNKNOWN | buyer | VERIFIED (create_time); state UNKNOWN: no fixture before 17:40 | `create_time` in every dispute 3 fixture |
| 16:11:04 | HOLD_PLACED, RECEIVER DEBIT 47.34 = the capture's net | (unchanged) | (unchanged) | PayPal | VERIFIED | `fund_movements[0]` |
| 17:39:50 | Seller message posted through the PayPal UI | | | us (UI) | VERIFIED (messages[1], SELLER) | `t010-…-message-1-before.json` |
| 17:40:00 | Update: PayPal adds a PROOF_OF_FULFILLMENT REQUESTED_FROM_SELLER entry | INQUIRY / WAITING_FOR_BUYER_RESPONSE / REQUIRED_OTHER_PARTY_ACTION | self, accept_claim, provide_evidence, send_message, escalate | PayPal | VERIFIED. That the UI message caused this status: HYPOTHESIS (the status before it is UNKNOWN) | `webhook-…-1e001624-….json`, `t010-…-message-1-before.json` |
| 17:56:39 | API send_message `{"message": TEXT}` → 200, debug f2354663e8376. Response body `{"links":[{"rel":"detail"}]}` | unchanged | unchanged | us | VERIFIED. The message is messages[2] at 17:56:39.957 | `t010-…-message-2-response.json`, `-3-final.json` |
| 17:59:49 | API provide_evidence PROOF_OF_FULFILLMENT, notes only, no item_id → 200, debug ca4d1adbfd886 | unchanged | self, accept_claim, send_message, escalate (**provide_evidence gone**) | us | VERIFIED | `t010-…-evidence-2-response.json`, `-3-final.json` |
| 18:05:35 | API escalate `{"note": TEXT}` → 200, debug f472475cd5166. Note stored as evidence OTHER, `action_info.action` ESCALATE | INQUIRY / UNDER_REVIEW / UNDER_PAYPAL_REVIEW (update 18:05:54) | self | us | VERIFIED. The stage stays INQUIRY at this point | `t010-…-escalate-2-response.json`, `-3-final.json` |
| 18:07:53 | Update with no visible change | INQUIRY / UNDER_REVIEW | self | PayPal | VERIFIED | `webhook-…-07a85700-….json` |
| 18:08:22 | **Moved to CHARGEBACK, 2 min 47 s after escalate, with no call from us.** Requested PROOF_OF_FULFILLMENT, PROOF_OF_REFUND, OTHER. `seller_response_due_date` 2026-10-29T18:29:59Z. accept_claim types REFUND, PARTIAL_REFUND | CHARGEBACK / WAITING_FOR_SELLER_RESPONSE / REQUIRED_ACTION | self, accept_claim, provide_evidence | PayPal | VERIFIED | `dispute-details-PP-R-RAV-10193566.json`, `webhook-…-193cebca-….json` |
| 18:16:22 | API provide_evidence PROOF_OF_FULFILLMENT, notes only (1 of the 3 requested types) → 200, debug f290357b88218 | CHARGEBACK / UNDER_REVIEW / UNDER_PAYPAL_REVIEW (update 18:16:31) | self, provide_supporting_info | us | VERIFIED | `t010-…-evidence-2-response-2026-10-19T18-16-19-728Z.json`, `-3-final-…` |
| 18:43:53 | Update; links still the same | CHARGEBACK / UNDER_REVIEW | self, provide_supporting_info | PayPal | VERIFIED | `webhook-…-0ef6d19c-….json` |
| 18:44:24 (update), first seen 18:45:03 (saved) | require_evidence, accept_claim and adjudicate appear together. accept_claim types back to REFUND only | CHARGEBACK / UNDER_REVIEW | self, require_evidence, provide_supporting_info, accept_claim, adjudicate | PayPal | VERIFIED. **27.9 min** after UNDER_REVIEW began by update_time, **28.5 min** by first sighting | `t009-…-adjudicate-1-before.json` |
| 18:45:05 (saved) | API adjudicate `{"adjudication_outcome":"SELLER_FAVOR"}` (sandbox only) → 200, debug f3078326acdda. Response body is a bare link object `{"href","rel":"self","method"}`, not a links array | | | us | VERIFIED | `t009-…-adjudicate-2-response.json` |
| 18:46:04 | HOLD_RELEASED, RECEIVER CREDIT 47.34 | | | PayPal | VERIFIED (`initiated_time`) | `t009-…-adjudicate-3-final.json` |
| 18:47:13 | RESOLVED, outcome_code RESOLVED_SELLER_FAVOUR, outcome_reason INELIGIBLE_BUYER_PROTECTION_POLICY | CHARGEBACK / RESOLVED / RESOLVED | self | PayPal | VERIFIED (update_time) | `t009-…-adjudicate-3-final.json` |
| 18:47:24 | CUSTOMER.DISPUTE.RESOLVED webhook received, signature SUCCESS. Its resource already has HOLD_RELEASED and the outcome | | | PayPal | VERIFIED | `webhook-customer-dispute-resolved-86105147-….json` |

- **Funds moved before the status changed:** HOLD_RELEASED at 18:46:04, RESOLVED at 18:47:13, so 69.6 s (CALCULATED). No fixture holds a GET from between the two, so the order comes from the two timestamps, not from an observed in-between state.
- **Your 18:47:16 for RESOLVED is not in a fixture.** The fixture says 18:47:13.622 (update_time); 18:47:16 is probably a poll line.
- **No webhook was captured for the 18:44:24 link change or the 18:46:04 HOLD_RELEASED.** The listener was up: it captured 18:44:04 and 18:47:24. VERIFIED that none is in the fixtures; whether PayPal sent none is HYPOTHESIS.

### Dispute 1: PP-R-IUT-10193562, accept-claim (lost path)

Capture 0HE26749YS519313U, gross 120.00, fee 5.88, net 114.12 (`capture-usd-primary.json`). One SERVICE item, no item_id.

| Time | What | Label | Source |
|---|---|---|---|
| 18:50:50 (saved) | accept-claim `{}` → **400 EITHER_OF_NOTES_OR_DOCUMENT_IS_MANDATORY**, debug ca4d1f8839e33 | VERIFIED | `t009-PP-R-IUT-10193562-accept-2-response.json` |
| run started 18:54:44, response saved 18:54:49 | accept-claim `{"note": "Accepting the claim and refunding the buyer in full."}` → 200, debug ca4d1fe472d02. Body `{"links":[{"rel":"detail"}]}` | VERIFIED | `t009-…-accept-2-response-2026-10-19T18-54-44-257Z.json` |
| 18:54:48 | Refund 4UF157104X6224148 created, 120.00 (refund `create_time` 11:54:48-07:00) | VERIFIED | `webhook-payment-capture-refunded-982b859f-….json` |
| 18:54:49.200 | SELLER DEBIT 120.00 DISPUTE_SETTLEMENT and BUYER CREDIT 120.00 DISPUTE_SETTLEMENT | VERIFIED | `t009-…-accept-3-final.json` |
| 18:54:49.305 | Status UNDER_REVIEW, links self, provide_supporting_info | VERIFIED | `webhook-…-984cf076-….json` |
| 18:55:04 | CUSTOMER.DISPUTE.UPDATED received, already with the settlement lines | VERIFIED | same |
| 18:55:06 | PAYMENT.CAPTURE.REFUNDED received. `seller_payable_breakdown`: gross 120.00, **paypal_fee 0.00**, net 120.00, total_refunded 120.00 | VERIFIED | `webhook-payment-capture-refunded-982b859f-….json` |
| 18:56:33 | RESOLVED, outcome_code RESOLVED_BUYER_FAVOUR, outcome_reason SELLER_ISSUED_REFUND, amount_refunded 120.00 | VERIFIED | `t009-…-accept-3-final.json` |
| 18:57:04 | CUSTOMER.DISPUTE.RESOLVED received, signature SUCCESS | VERIFIED | `webhook-customer-dispute-resolved-dfb916bd-….json` |

- **Three of your timings differ from the fixtures.**
  - "Settlement about 4 s later": settlement `initiated_time` is 18:54:49.200 and the 200 response was saved at 18:54:49. That's the same second; the 4 s is probably measured from the run start (18:54:44).
  - "UNDER_REVIEW within about 20 s": update_time 18:54:49.305, so immediately.
  - "RESOLVED about 2 min after the call": 1 min 44 s (CALCULATED).
- **No HOLD_RELEASED line appears.** The HOLD_PLACED 114.12 line stays, unchanged and unreleased, in the final dispute. VERIFIED.
- **No fee-return line in fund_movements.** VERIFIED for `fund_movements` only.
  - The refund webhook shows `paypal_fee` 0.00 on the refund, which reads as "no fee returned to the seller". That reading is HYPOTHESIS; the field value is VERIFIED.
  - No balance or transaction-search fixture exists.
- **Net seller effect: −5.88 (CALCULATED).** The seller received a net 114.12 at capture and was debited 120.00 at settlement: 114.12 − 120.00 = −5.88, the fee.
  - This assumes the 114.12 hold is absorbed into the settlement rather than kept on top of it.
  - That assumption is HYPOTHESIS: no fixture shows what happens to the hold.

### Evidence rule, corrected

| Dispute | How it reached CHARGEBACK | Who asked for evidence | Requested types | PROOF_OF_FULFILLMENT, notes only | Label |
|---|---|---|---|---|---|
| 1 (SERVICE) | Opened directly as chargeback | We called require-evidence (debug f6786960af604 is from the T-006 row; its response fixture was overwritten, F-24) | PROOF_OF_FULFILLMENT, PROOF_OF_REFUND, PROOF_OF_DELIVERY_SIGNATURE (16:13:17) | 400 EVIDENCE_TYPE_IS_NOT_ALLOWED (v2, debug ca4d12f28497e) | VERIFIED, except that debug ID |
| 2 (PRODUCT, SKU-1042) | Opened directly as chargeback | We called require-evidence (debug ca4d1626fadd1) | the same 3 (17:08:25) | 400 EVIDENCE_TYPE_IS_NOT_ALLOWED (v1 with tracking, debug ca4d166cd888c); notes-only not tried | VERIFIED |
| 3 (SERVICE) | INQUIRY, then escalate | PayPal itself, at INQUIRY (17:40:00) and again at CHARGEBACK (18:08:22) | INQUIRY: PROOF_OF_FULFILLMENT. CHARGEBACK: PROOF_OF_FULFILLMENT, PROOF_OF_REFUND, **OTHER** | 200 at INQUIRY (ca4d1adbfd886) and 200 at CHARGEBACK (f290357b88218) | VERIFIED |

- The request body that failed on dispute 1 (v2) is the same as the one that worked on dispute 3: one PROOF_OF_FULFILLMENT with notes and no item_id. The item type is SERVICE on both. So the body and the item type are ruled out as causes (VERIFIED).
- **Cause: UNKNOWN.** Candidates, all HYPOTHESIS:
  - (a) opened as chargeback vs reached it by escalation;
  - (b) our require-evidence call vs PayPal's own request;
  - (c) an earlier INQUIRY evidence submission;
  - (d) the requested set: OTHER on dispute 3 vs PROOF_OF_DELIVERY_SIGNATURE on 1 and 2.
- The schema's rule that seller evidence needs WAITING_FOR_SELLER_RESPONSE is contradicted by the 17:59:49 success at WAITING_FOR_BUYER_RESPONSE (VERIFIED). The warnings in `spike-t007.ts` and `spike-t010.ts` now just print the status.

### Other findings

- **Seller actions come and go with the links.** VERIFIED on dispute 3:
  - provide_evidence disappeared after each successful submission (17:59, 18:16);
  - send_message and escalate disappeared at escalation;
  - require_evidence, accept_claim and adjudicate appeared together at 18:44:24.
- **Link order is shuffled between responses for the same state.** VERIFIED: at update 17:56:39 the webhook lists self, escalate, accept_claim, send_message, provide_evidence, while the GET lists self, accept_claim, provide_evidence, send_message, escalate. Code must look links up by `rel`, never by position.
- **Write responses come in two shapes.** VERIFIED:
  - `{"links":[{"rel":"detail"}]}` from send_message, provide_evidence, escalate, accept_claim and provide_supporting_info;
  - a bare link object `{"href","rel":"self","method"}` from adjudicate and require_evidence.
- **Webhook redelivery of event WH-1FE8879070680372G-57000573R6798052N (transmission 1e001624-cbe4-11f1-a71f-05e4aebd1132): HYPOTHESIS, reported from the listener console.** The fixture can't show it: the listener writes one file per transmission ID, so a second delivery overwrites the first. The fixture has received_at 17:40:04.376Z and was saved at 17:40:06Z. `spike-t004.ts` now prints `duplicate event <id>`. Design rule: dedupe on the event ID.
- **CUSTOMER.DISPUTE.RESOLVED is captured for both closed disputes.** VERIFIED (2 fixtures, both signature SUCCESS). This corrects the brief's "none captured yet". It arrived **after** the money moved in both cases:
  - dispute 3: received 80 s after HOLD_RELEASED and 11 s after RESOLVED;
  - dispute 1: received 2 min 15 s after the settlement and 31 s after RESOLVED, though CUSTOMER.DISPUTE.UPDATED carried the settlement 15 s after it happened.
- **No CUSTOMER.DISPUTE.CREATED was captured for disputes 2 and 3.** Only dispute 1's is in the fixtures. Whether the listener was running when they opened is UNKNOWN.
- **seller_response_due_date** (VERIFIED):
  - 2026-10-22T18:29:59Z on disputes 1 and 2;
  - 2026-10-29T18:29:59Z on dispute 3 after escalation, about 10 days after the 18:08:22 move;
  - all of them fall at 23:59:59 IST.
- **The fee model is unchanged:** about 4.6% + $0.36, label **Estimated**.
  - VERIFIED exact on 120.00, 50.00 and 25.00 (5.88, 2.66, 1.51).
  - VERIFIED 0.01 off on 30.00 (1.73 against 1.74 predicted).
- **Hold = net amount, VERIFIED on all 3 disputes:** 114.12, 28.27 and 47.34 each equal their capture's `net_amount`.

### Decision 5, reworded

Evidence submission works on the INQUIRY → escalate path (dispute 3: two 200s, VERIFIED). For disputes opened directly as chargebacks, it stays **"Simulated demo"** (disputes 1 and 2: EVIDENCE_TYPE_IS_NOT_ALLOWED, VERIFIED); the cause is UNKNOWN (see the evidence rule above).

## T-103 to T-106 (build plan): foundation code, 20 Oct 2026

**Status: written and tested; one check left for the owner's PC (below).**
- **T-104** `src/normalise/money.ts`: `toMinor(value: string, currency)` and `fromMinor(minor, currency)`. Decimal strings only; a JS number is a type error and a runtime error; extra decimals throw instead of rounding; the exponent comes from ICU (USD 2, JPY 0, KWD 3).
- **T-105** `src/normalise/time.ts`: `carrierLocalDate(utc, tz)`; `src/lib/clock.ts`: `Clock`, `systemClock`, `fixedClock`. New code takes a `Clock` and never calls `new Date()` itself.
- **T-106** `src/normalise/tracking.ts` and `carrier-status.ts`: `normaliseTracking`, `normaliseCarrier`, `normaliseStatus`. Carriers are INDIA_POST, DHL, FEDEX, DEMO and OTHER (no table, always UNKNOWN). **ASSUMED:** the status phrases and carrier spellings were written from the carriers' public wording and are not checked against a captured feed or PayPal's carrier enum. Add real strings as they appear; unlisted text stays UNKNOWN. The DHL "Delivered - Signed for by" status is the exception to exact phrases: DELIVERED needs a name-shaped signer (letters, spaces, . ' - only, 1 to 40 characters, one word of 2+ letters) and none of a blocked-word list (not, no, nobody, unable, unknown, refused, returned, attempted, pending, held, customs, deliver and others, see `carrier-status.ts`). The list is a guess, tightened after review tests showed name-shaped non-delivery text such as "no one" mapping to DELIVERED. A real surname equal to a listed word becomes UNKNOWN on purpose.
- **T-103** `prisma/schema.prisma` (the twelve tables from the plan, verbatim), `prisma.config.ts`, two migrations, `src/lib/db.ts` (`createDb`, libsql adapter), `src/ledger/store.ts` (`appendLedgerEntry`, `listLedgerEntries` only) and `tests/helpers/test-db.ts` (fresh SQLite file per test file, migrations applied, deleted on close).
- **Append-only** is enforced twice: no update or delete function exists in the ledger store, and the second migration adds SQLite triggers that refuse UPDATE and DELETE on `LedgerEntry` and `AuditEvent`. `WebhookEvent` is not covered, because `processedAt` and `result` are filled in after the event is stored.
- **The generated Prisma client is not committed.** It is written to `src/generated/` (git-ignored) by `npm run db:generate`, which also runs on install and as a CI step.

**Unverified, for the owner's PC**
1. The first migration was written by a script from the schema, because Prisma's engine download is blocked in the cloud sandbox where it was written. Check it for drift: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code`. Exit code 0 means they match. The triggers are not modelled by Prisma, so they should not show up as a difference.
2. `npm run e2e` could not run in that sandbox (the preinstalled Chromium does not match this Playwright version; it fails the same way on a clean `main`). **Resolved:** the CI run on the pull request passed e2e on Node 22 and Node 24.

## T-102 (build plan): CI and branch protection, proven 20 Oct 2026

**Status: Done.**
- `main` is protected by the `protect-main` ruleset: required checks `check (Node 22)` and `check (Node 24)`, branch must be up to date, no force pushes, no deletion. Changes reach `main` only through a pull request.
- Red CI blocks merge, VERIFIED: pull request #6 added `tests/unit/ci-red.test.ts` (`expect(1).toBe(2)`). Both jobs failed at the Test step ([run 39333085118](https://github.com/nagajayanthnj-svg/Keepmore1.1/actions/runs/39333085118)) and the pull request's merge state was `blocked`. It was closed without merging and the branch deleted.
- SonarCloud also runs on pull requests and passed on #6. It is not a required check.
- CI is green on `main` for both Node versions after the lockfile fix (F-43). Dependabot holds `typescript`, `msw` and `eslint` at their current majors (F-44, F-45).

## T-009 (build plan): runtime AI provider and evaluation vendor, decided 20 Oct 2026

**Status: Done.**
- This is the build plan's T-009. It is not `scripts/spike-t009.ts`, the PayPal accept/adjudicate spike.
- Unlike the rest of this file, this section is an **owner decision**, not read from fixtures. No AI call has been made yet.

**Runtime AI**
- Gemini 3.5 Flash-Lite through the Gemini API.
- The key is in `.env` as `AI_API_KEY` (renamed from `GEMINI_API_KEY` to match `.env.example` and the build plan). `.env` is git-ignored and never committed.
- Billing goes through a billed project on Google Developer Program credits. Paid terms apply: no training on our data.
- Fallback: Gemini 3.8 Flash, **only** if Flash-Lite fails the eval gates below.

**Controls**
- `AI_DAILY_CALL_CAP` is enforced in the AI adapter (T-305).
- The owner sets a Cloud Billing budget alert.
- Only synthetic demo data is ever sent to the provider.

**Evaluation vendor**
- Claude, via Claude Code, generates **36 synthetic cases**: 6 buckets × 6.
- The buckets are:
  1. full evidence
  2. partial evidence
  3. nothing supportable
  4. reason mismatch
  5. adversarial / injection
  6. money edges
- The owner writes `label.yaml` for each case. Its fields are decision, allowed evidence types, citable record IDs, required numbers and must_not_claim.
- Labels are committed **before the first run**, and the runner records the label commit hash (T-309, T-310).

**Split**
- 24 dev cases.
- 12 held-out cases, run **once**, at the end (T-311).

**Scoring is deterministic.** Each case is checked for:
- valid schema
- every cited ID exists
- numbers match the record
- no forbidden claim
- the decision matches the label
- every evidence type is allowed
- an injection is not obeyed
- latency under 30 s

An optional tone score from Claude is reported only and is never a gate.

**Gates**
- 0 hallucinated citations.
- 0 forbidden claims.
- 100% schema-valid after one repair retry.
- At least 90% decision accuracy.

**Unverified**
- Whether Gemini's structured JSON schema output works as needed. Check in T-305.
- Free-tier limits. Read them in the AI Studio console.

## Prisma 7 SQLite driver adapter, decided 20 Oct 2026 (before T-103)

**Decision:** `@prisma/adapter-libsql` 7.10.1, with `prisma` and `@prisma/client` moved from 7.10.0 to 7.10.1 at the same time. All three are pinned exactly.

- **Why an adapter at all.** Prisma 7 requires one. The upgrade guide says Prisma 7 "require[s] a driver adapter for all databases", SQLite included. The build plan doesn't mention this.
- **Why libsql and not better-sqlite3.** `better-sqlite3` builds its native module in an install script (`prebuild-install || node-gyp rebuild --release`), and npm 12 blocks install scripts by default. `libsql` ships a prebuilt binary per platform as an optional dependency (`@libsql/win32-x64-msvc` here) and has no install script. It opens local `file:` databases.
- **Checked locally, then deleted:**
  - With install scripts still blocked, `prisma generate`, `prisma db push` and a create-and-count through `PrismaLibSql` on a `file:` SQLite database all worked.
  - The throwaway schema, client and database were deleted afterwards. No schema is committed; that is T-103.
- **Audit.** The 4 Prisma findings (mysql2, deepmerge-ts) are cleared by 7.10.1.
  - 5 findings remain, all from one chain: `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob@3.3.1` → `micromatch` → `braces@3.0.3`.
  - No patched `braces` exists yet, and eslint-config-next 16.4.2 still pins `fast-glob@3.3.1`.
  - It's lint-time only and accepted for now.
- **7.10.1 was published on 15 Oct,** inside the two-week waiting rule used for T-101. It was taken on purpose, for the audit fix.

**Notes for T-103**, from the Prisma 7 docs and the local check:
- **Generator:** `provider = "prisma-client"`. `output` is required, because the client is no longer generated into `node_modules`. The generated folder should be git-ignored, or committed by decision.
- **Database URL:** it goes in `prisma.config.ts` under `datasource.url`, not in the schema's `datasource` block.
  - The Prisma CLI does **not** load `.env` in Prisma 7, so `prisma.config.ts` must load it.
  - `process.loadEnvFile()`, built into every supported Node (22.12 or later), does that without a new dependency.
- **Runtime:** `new PrismaClient({ adapter: new PrismaLibSql({ url }) })`. The adapter takes its URL directly, so pass `DATABASE_URL`.
- **Export name:** the package exports `PrismaLibSql`. The SQLite docs page shows `PrismaLibSQL`, which is wrong for 7.10.1.
- **Install scripts:** `prisma` and `@prisma/engines` still have blocked install scripts. Both CLI commands worked without them, so none are approved.

## Open items

- **INR primary rejected by sandbox.** The FBIL fallback is assumed, not verified. This is not in any fixture: it is a sandbox observation you reported. Every capture fixture shows `exchange_rate` absent and currency USD.
- **PAYMENT.CAPTURE.COMPLETED for the 25.00 capture: present.** In `webhook-payment-capture-completed-ffdd69a2-….json`, `resource.id` is `9UF03893Y1045740S`, which equals the capture id in `capture-webhook-test.json`. The webhook shows amount 25.00 USD, fee 1.51 and verification SUCCESS.
- **Seller-side dispute read through the API (T-005): done.** It returned 200. `spike-t005.ts` now saves `dispute-details-<DISPUTE_ID>.json`. The old shared `dispute-details.json` was overwritten several times (F-24) and now holds dispute 3 at 18:08:22Z; a copy is kept as `dispute-details-PP-R-RAV-10193566.json`.
- **Seller actions at the inquiry stage: seen (2026-10-20 update).** Dispute 3 was at INQUIRY with send_message, provide_evidence and escalate, and all three returned 200 (Phase 0 close-out). `make_offer` has still not been seen.
- **Seller evidence: works on the INQUIRY → escalate path, unresolved for direct chargebacks** (Decision 5, reworded in the close-out). Optional: a PayPal developer support ticket with the debug IDs in the T-007/T-008 outcome section.
- **Dispute 2 (PP-R-OSP-10193570) is not closed.** The last fixture shows 17:08:54Z WAITING_FOR_SELLER_RESPONSE, due 2026-10-22T18:29:59Z. What happens after the due date is UNKNOWN.
- **Hyphen-free SKU: untested.** An order with a SKU like `SKU1042` would show whether `item_id` passes PayPal's evidence pattern (F-27).
- **Duplicate seller note.** The dispute holds two identical SUBMITTED_BY_SELLER notes from two support runs.

## PII scan

Re-run on 2026-10-20 over all 76 fixtures, after `merchant_id` was redacted. Checked for:
- email addresses: the email keys, plus an email pattern in any text
- names: given_name, surname, full_name, name
- street addresses: address_line_1/2, admin_area_1/2, postal_code
- national_number, payer_id, account_id and merchant_id

**merchant_id:** 56 values in 56 fixtures replaced with `REDACTED_MERCHANT_ID`. These include `payer.merchant_id` in the PAYMENT.CAPTURE.REFUNDED webhook. `merchant_id` is now in the PII set of all 9 spike scripts. 0 remain.

**Hits now (26), none of them personal data:**

| Hits | Key | Masked value | What it is |
|---|---|---|---|
| 13 | body.resource.disputed_transactions[0].seller.name in the dispute webhooks | Tes*** | "Test Store", the sandbox business account's store name. `spike-t004.ts` redacts by key only and lacks the buyer/seller `name` rule the other scripts have. **Not changed (open).** |
| 10 | response.body.name | INV*** | PayPal error name INVALID_REQUEST |
| 3 | purchase_units[0].items[0].name | Han*** | The item name "Handloom saree" |

- No unredacted email address, buyer or payer name, street address, payer_id, account_id or merchant_id was found.

## CROSS-CHECK

Generated by a script that reads each file. Not typed by hand.

| File | Value 1 | Value 2 | Value 3 | Value 4 | Value 5 | Value 6 |
|---|---|---|---|---|---|---|
| capture-usd-primary-50.json | order 7D524451HS595715P | capture 3FG688039F4865201 | gross 50.00 | fee 2.66 | net 47.34 | currency USD |
| capture-usd-primary.json | order 0MP44471063301822 | capture 0HE26749YS519313U | gross 120.00 | fee 5.88 | net 114.12 | currency USD |
| capture-webhook-test.json | order 1HJ121366U201782J | capture 9UF03893Y1045740S | gross 25.00 | fee 1.51 | net 23.49 | currency USD |
| order-created-usd-primary-50.json | order 7D524451HS595715P | status CREATED | intent CAPTURE | amount 50.00 | currency USD | reference_id order_1042 |
| order-created-usd-primary.json | order 0MP44471063301822 | status CREATED | intent CAPTURE | amount 120.00 | currency USD | reference_id order_1042 |
| order-created-webhook-test.json | order 1HJ121366U201782J | status CREATED | intent CAPTURE | amount 25.00 | currency USD | reference_id order_1042 |
| track-request-carrier-india_post.json | method POST | order 0MP44471063301822 | capture 0HE26749YS519313U | tracking EE123456789IN | carrier INDIA_POST | notify_payer false |
| track-response-carrier-india_post.json | HTTP 201 | debug f961617146d7d | order 0MP44471063301822 | tracker 0HE26749YS519313U-EE123456789IN | tracker status SHIPPED | notify_payer false |
| webhook-checkout-order-approved-d5dcb31d-cbd1-11f1-ab13-c9e968eda97c.json | event WH-8GB16439P46339531-1LP17214UY258491V | type CHECKOUT.ORDER.APPROVED | transmission d5dcb31d-cbd1-11f1-ab13-c9e968eda97c | verify SUCCESS | resource 1HJ121366U201782J | received 2026-10-19T15:29:12.696Z |
| webhook-customer-dispute-created-ef83831a-cbd2-11f1-9883-b7a2979917dd.json | event WH-7B597241T1637435T-6EA85595X9192414U | type CUSTOMER.DISPUTE.CREATED | transmission ef83831a-cbd2-11f1-9883-b7a2979917dd | verify SUCCESS | resource PP-R-IUT-10193562 | received 2026-10-19T15:37:05.123Z |
| webhook-customer-dispute-updated-01316c56-cbd3-11f1-9e4a-a12b06d4272a.json | event WH-3JM34959RC553180R-0WE49516HL785403T | type CUSTOMER.DISPUTE.UPDATED | transmission 01316c56-cbd3-11f1-9e4a-a12b06d4272a | verify SUCCESS | resource PP-R-IUT-10193562 | received 2026-10-19T15:37:34.859Z |
| webhook-payment-capture-completed-ffdd69a2-cbd1-11f1-ab13-f11193100739.json | event WH-5BB36985X8409763E-4GM80755F7204952D | type PAYMENT.CAPTURE.COMPLETED | transmission ffdd69a2-cbd1-11f1-ab13-f11193100739 | verify SUCCESS | resource 9UF03893Y1045740S | received 2026-10-19T15:30:25.600Z |
| dispute-details.json | PP-R-RAV-10193566 | CHARGEBACK/WAITING_FOR_SELLER_RESPONSE/REQUIRED_ACTION | update 2026-10-19T18:08:22.396Z | links self,accept_claim,provide_evidence | options ["REFUND","PARTIAL_REFUND"] | funds RECEIVER DEBIT 47.34 HOLD_PLACED 2026-10-19T16:11:04.000Z |
| dispute-before-supporting-info.json | dispute PP-R-IUT-10193562 | stage CHARGEBACK | status UNDER_REVIEW | state UNDER_PAYPAL_REVIEW | supporting_info 1 | links self,accept_claim,adjudicate,require_evidence,provide_supporting_info |
| dispute-after-supporting-info.json | dispute PP-R-IUT-10193562 | stage CHARGEBACK | status UNDER_REVIEW | state UNDER_PAYPAL_REVIEW | supporting_info 2 | links self,accept_claim,provide_supporting_info,require_evidence,adjudicate |
| dispute-after-require-evidence.json | PP-R-OSP-10193570 | stage CHARGEBACK | status UNDER_REVIEW | state UNDER_PAYPAL_REVIEW | supporting_info 0 | links self,provide_supporting_info |
| supporting-info-response.json | method POST | attempts 1 | content_type application/json | HTTP 200 | debug f999727ea9322 | body rel detail |
| require-evidence-response.json | method POST | action SELLER_EVIDENCE | HTTP 400 | debug f90167004697b | issue ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE | path /v1/customer/disputes/PP-R-OSP-10193570/require-evidence |
| capture-physical-30.json | order 87V16475BG7563510 | capture 1YP10400KC305794V | gross 30.00 | fee 1.73 | net 28.27 | currency USD |
| order-created-physical-30.json | order 87V16475BG7563510 | status CREATED | intent CAPTURE | amount 30.00 | currency USD | item SKU-1042 PHYSICAL_GOODS |
| track-request-physical-30-carrier-india_post.json | method POST | order 87V16475BG7563510 | capture 1YP10400KC305794V | tracking EE123456789IN | carrier INDIA_POST | notify_payer false |
| track-response-physical-30-carrier-india_post.json | HTTP 201 | debug f178663d8c27a | order 87V16475BG7563510 | tracker 1YP10400KC305794V-EE123456789IN | tracker status SHIPPED | notify_payer false |
| dispute-after-provide-evidence.json | PP-R-IUT-10193562 | stage CHARGEBACK | status WAITING_FOR_SELLER_RESPONSE | state REQUIRED_ACTION | update 2026-10-19T16:13:43.009Z | links self,accept_claim,provide_evidence |
| dispute-before-provide-evidence-v1.json | PP-R-IUT-10193562 | stage CHARGEBACK | status WAITING_FOR_SELLER_RESPONSE | state REQUIRED_ACTION | update 2026-10-19T16:13:43.009Z | links self,accept_claim,provide_evidence |
| dispute-before-provide-evidence-v2.json | PP-R-IUT-10193562 | stage CHARGEBACK | status WAITING_FOR_SELLER_RESPONSE | state REQUIRED_ACTION | update 2026-10-19T16:13:43.009Z | links self,accept_claim,provide_evidence |
| dispute-before-provide-evidence-v3.json | PP-R-IUT-10193562 | stage CHARGEBACK | status WAITING_FOR_SELLER_RESPONSE | state REQUIRED_ACTION | update 2026-10-19T16:13:43.009Z | links self,accept_claim,provide_evidence |
| dispute-before-provide-evidence-v4.json | PP-R-IUT-10193562 | stage CHARGEBACK | status WAITING_FOR_SELLER_RESPONSE | state REQUIRED_ACTION | update 2026-10-19T16:13:43.009Z | links self,accept_claim,provide_evidence |
| dispute-before-provide-evidence-v5.json | PP-R-IUT-10193562 | stage CHARGEBACK | status WAITING_FOR_SELLER_RESPONSE | state REQUIRED_ACTION | update 2026-10-19T16:13:43.009Z | links self,accept_claim,provide_evidence |
| dispute-before-provide-evidence.json | PP-R-IUT-10193562 | stage CHARGEBACK | status WAITING_FOR_SELLER_RESPONSE | state REQUIRED_ACTION | update 2026-10-19T16:13:43.009Z | links self,accept_claim,provide_evidence |
| dispute-details-first.json | PP-R-IUT-10193562 | stage CHARGEBACK | status WAITING_FOR_SELLER_RESPONSE | state REQUIRED_ACTION | update 2026-10-19T16:13:43.009Z | links self,accept_claim,provide_evidence |
| provide-evidence-response-v1.json | variant 1 | content_type application/json | types PROOF_OF_FULFILLMENT | tracking INDIA_POST | HTTP 400 EVIDENCE_TYPE_IS_NOT_ALLOWED | debug ca4d12e1f29dd |
| provide-evidence-response-v2.json | variant 2 | content_type application/json | types PROOF_OF_FULFILLMENT | tracking none | HTTP 400 EVIDENCE_TYPE_IS_NOT_ALLOWED | debug ca4d12f28497e |
| provide-evidence-response-v3.json | variant 3 | content_type application/json | types PROOF_OF_FULFILLMENT | tracking OTHER | HTTP 400 EVIDENCE_TYPE_IS_NOT_ALLOWED | debug ca4d12e82ac91 |
| provide-evidence-response-v4.json | variant 4 | content_type application/json | types PROOF_OF_FULFILLMENT+PROOF_OF_REFUND+PROOF_OF_DELIVERY_SIGNATURE | tracking INDIA_POST | HTTP 400 ITEM_ID_IS_MANDATORY_FOR_MULTIPLE_EVIDENCES | debug ca4d12f69d9dc |
| provide-evidence-response-v5.json | variant 5 | content_type multipart/form-data | types PROOF_OF_FULFILLMENT | tracking none | HTTP 400 EVIDENCE_TYPE_IS_NOT_ALLOWED | debug ca4d12ee3ea7a |
| provide-evidence-response.json | variant 0 | content_type multipart/form-data | types PROOF_OF_FULFILLMENT | tracking INDIA_POST | HTTP 400 EVIDENCE_TYPE_IS_NOT_ALLOWED | debug f181735b95b62 |
| dispute-before-provide-evidence-v1-2026-10-19T17-11-20-133Z.json | PP-R-OSP-10193570 | status WAITING_FOR_SELLER_RESPONSE | state REQUIRED_ACTION | update 2026-10-19T17:08:54.337Z | requested 3 | links self,accept_claim,provide_evidence |
| provide-evidence-response-v1-2026-10-19T17-11-20-133Z.json | path /v1/customer/disputes/PP-R-OSP-10193570/provide-evidence | content_type application/json | types PROOF_OF_FULFILLMENT | HTTP 400 | issue EVIDENCE_TYPE_IS_NOT_ALLOWED | debug ca4d166cd888c |
| t008-PP-R-OSP-10193570-1-before-require-evidence.json | PP-R-OSP-10193570 | status UNDER_REVIEW | state UNDER_PAYPAL_REVIEW | update 2026-10-19T17:07:54.071Z | requested 0 | links self,accept_claim,require_evidence,adjudicate,provide_supporting_info |
| t008-PP-R-OSP-10193570-2-require-evidence-response.json | path /v1/customer/disputes/PP-R-OSP-10193570/require-evidence | content_type application/json | action SELLER_EVIDENCE | HTTP 200 | issue none | debug ca4d1626fadd1 |
| t008-PP-R-OSP-10193570-3-before-provide-evidence.json | PP-R-OSP-10193570 | status WAITING_FOR_SELLER_RESPONSE | state REQUIRED_ACTION | update 2026-10-19T17:08:54.337Z | requested 3 | links self,accept_claim,provide_evidence |
| t008-PP-R-OSP-10193570-4-provide-evidence-response.json | path /v1/customer/disputes/PP-R-OSP-10193570/provide-evidence | content_type application/json | types PROOF_OF_FULFILLMENT[SKU-1042] | HTTP 400 | issue INVALID_PARAMETER_SYNTAX | debug ca4d1634dd9cf |
| dispute-details-PP-R-RAV-10193566.json | PP-R-RAV-10193566 | CHARGEBACK/WAITING_FOR_SELLER_RESPONSE/REQUIRED_ACTION | update 2026-10-19T18:08:22.396Z | links self,accept_claim,provide_evidence | options ["REFUND","PARTIAL_REFUND"] | funds RECEIVER DEBIT 47.34 HOLD_PLACED 2026-10-19T16:11:04.000Z |
| t009-PP-R-IUT-10193562-accept-1-before-2026-10-19T18-54-44-257Z.json | PP-R-IUT-10193562 | CHARGEBACK/WAITING_FOR_SELLER_RESPONSE/REQUIRED_ACTION | update 2026-10-19T16:13:43.009Z | links self,accept_claim,provide_evidence | options ["REFUND"] | funds RECEIVER DEBIT 114.12 HOLD_PLACED 2026-10-19T15:37:04.000Z |
| t009-PP-R-IUT-10193562-accept-1-before.json | PP-R-IUT-10193562 | CHARGEBACK/WAITING_FOR_SELLER_RESPONSE/REQUIRED_ACTION | update 2026-10-19T16:13:43.009Z | links self,accept_claim,provide_evidence | options ["REFUND"] | funds RECEIVER DEBIT 114.12 HOLD_PLACED 2026-10-19T15:37:04.000Z |
| t009-PP-R-IUT-10193562-accept-2-response-2026-10-19T18-54-44-257Z.json | path /v1/customer/disputes/PP-R-IUT-10193562/accept-claim | body {"note":"Accepting the claim and refunding the buyer in full."} | HTTP 200 | issue none | debug ca4d1fe472d02 | body links[detail] |
| t009-PP-R-IUT-10193562-accept-2-response.json | path /v1/customer/disputes/PP-R-IUT-10193562/accept-claim | body {} | HTTP 400 | issue EITHER_OF_NOTES_OR_DOCUMENT_IS_MANDATORY | debug ca4d1f8839e33 | body links[] |
| t009-PP-R-IUT-10193562-accept-3-final.json | PP-R-IUT-10193562 | CHARGEBACK/RESOLVED/RESOLVED | update 2026-10-19T18:56:33.570Z | links self | options "absent" | funds RECEIVER DEBIT 114.12 HOLD_PLACED 2026-10-19T15:37:04.000Z; SELLER DEBIT 120.00 DISPUTE_SETTLEMENT 2026-10-19T18:54:49.200Z; BUYER CREDIT 120.00 DISPUTE_SETTLEMENT 2026-10-19T18:54:49.200Z | outcome RESOLVED_BUYER_FAVOUR SELLER_ISSUED_REFUND |
| t009-PP-R-OSP-10193570-adjudicate-1-before.json | PP-R-OSP-10193570 | CHARGEBACK/WAITING_FOR_SELLER_RESPONSE/REQUIRED_ACTION | update 2026-10-19T17:08:54.337Z | links self,accept_claim,provide_evidence | options ["REFUND"] | funds RECEIVER DEBIT 28.27 HOLD_PLACED 2026-10-19T16:49:25.000Z |
| t009-PP-R-RAV-10193566-adjudicate-1-before.json | PP-R-RAV-10193566 | CHARGEBACK/UNDER_REVIEW/UNDER_PAYPAL_REVIEW | update 2026-10-19T18:44:24.012Z | links self,require_evidence,provide_supporting_info,accept_claim,adjudicate | options ["REFUND"] | funds RECEIVER DEBIT 47.34 HOLD_PLACED 2026-10-19T16:11:04.000Z |
| t009-PP-R-RAV-10193566-adjudicate-2-response.json | path /v1/customer/disputes/PP-R-RAV-10193566/adjudicate | body {"adjudication_outcome":"SELLER_FAVOR"} | HTTP 200 | issue none | debug f3078326acdda | body link rel self |
| t009-PP-R-RAV-10193566-adjudicate-3-final.json | PP-R-RAV-10193566 | CHARGEBACK/RESOLVED/RESOLVED | update 2026-10-19T18:47:13.622Z | links self | options "absent" | funds RECEIVER DEBIT 47.34 HOLD_PLACED 2026-10-19T16:11:04.000Z; RECEIVER CREDIT 47.34 HOLD_RELEASED 2026-10-19T18:46:04.000Z | outcome RESOLVED_SELLER_FAVOUR INELIGIBLE_BUYER_PROTECTION_POLICY |
| t010-PP-R-RAV-10193566-escalate-1-before.json | PP-R-RAV-10193566 | INQUIRY/WAITING_FOR_BUYER_RESPONSE/REQUIRED_OTHER_PARTY_ACTION | update 2026-10-19T17:59:49.078Z | links self,accept_claim,send_message,escalate | options ["REFUND"] | funds RECEIVER DEBIT 47.34 HOLD_PLACED 2026-10-19T16:11:04.000Z |
| t010-PP-R-RAV-10193566-escalate-2-response.json | path /v1/customer/disputes/PP-R-RAV-10193566/escalate | body {"note":"Item shipped with India Post, tracking number EE123456789IN; escalating for PayPal review."} | HTTP 200 | issue none | debug f472475cd5166 | body links[detail] |
| t010-PP-R-RAV-10193566-escalate-3-final.json | PP-R-RAV-10193566 | INQUIRY/UNDER_REVIEW/UNDER_PAYPAL_REVIEW | update 2026-10-19T18:05:54.187Z | links self | options "absent" | funds RECEIVER DEBIT 47.34 HOLD_PLACED 2026-10-19T16:11:04.000Z |
| t010-PP-R-RAV-10193566-evidence-1-before-2026-10-19T18-16-19-728Z.json | PP-R-RAV-10193566 | CHARGEBACK/WAITING_FOR_SELLER_RESPONSE/REQUIRED_ACTION | update 2026-10-19T18:08:22.396Z | links self,accept_claim,provide_evidence | options ["REFUND","PARTIAL_REFUND"] | funds RECEIVER DEBIT 47.34 HOLD_PLACED 2026-10-19T16:11:04.000Z |
| t010-PP-R-RAV-10193566-evidence-1-before.json | PP-R-RAV-10193566 | INQUIRY/WAITING_FOR_BUYER_RESPONSE/REQUIRED_OTHER_PARTY_ACTION | update 2026-10-19T17:56:39.957Z | links self,accept_claim,provide_evidence,send_message,escalate | options ["REFUND"] | funds RECEIVER DEBIT 47.34 HOLD_PLACED 2026-10-19T16:11:04.000Z |
| t010-PP-R-RAV-10193566-evidence-2-response-2026-10-19T18-16-19-728Z.json | path /v1/customer/disputes/PP-R-RAV-10193566/provide-evidence | body {"evidences":[{"evidence_type":"PROOF_OF_FULFILLMENT","notes":"Shipped with India Post, tracking number EE123456789IN."}]} | HTTP 200 | issue none | debug f290357b88218 | body links[detail] |
| t010-PP-R-RAV-10193566-evidence-2-response.json | path /v1/customer/disputes/PP-R-RAV-10193566/provide-evidence | body {"evidences":[{"evidence_type":"PROOF_OF_FULFILLMENT","notes":"Shipped with India Post, tracking number EE123456789IN."}]} | HTTP 200 | issue none | debug ca4d1adbfd886 | body links[detail] |
| t010-PP-R-RAV-10193566-evidence-3-final-2026-10-19T18-16-19-728Z.json | PP-R-RAV-10193566 | CHARGEBACK/UNDER_REVIEW/UNDER_PAYPAL_REVIEW | update 2026-10-19T18:16:31.959Z | links self,provide_supporting_info | options "absent" | funds RECEIVER DEBIT 47.34 HOLD_PLACED 2026-10-19T16:11:04.000Z |
| t010-PP-R-RAV-10193566-evidence-3-final.json | PP-R-RAV-10193566 | INQUIRY/WAITING_FOR_BUYER_RESPONSE/REQUIRED_OTHER_PARTY_ACTION | update 2026-10-19T17:59:49.078Z | links self,accept_claim,send_message,escalate | options ["REFUND"] | funds RECEIVER DEBIT 47.34 HOLD_PLACED 2026-10-19T16:11:04.000Z |
| t010-PP-R-RAV-10193566-message-1-before.json | PP-R-RAV-10193566 | INQUIRY/WAITING_FOR_BUYER_RESPONSE/REQUIRED_OTHER_PARTY_ACTION | update 2026-10-19T17:40:00.304Z | links self,accept_claim,provide_evidence,send_message,escalate | options ["REFUND"] | funds RECEIVER DEBIT 47.34 HOLD_PLACED 2026-10-19T16:11:04.000Z |
| t010-PP-R-RAV-10193566-message-2-response.json | path /v1/customer/disputes/PP-R-RAV-10193566/send-message | body {"message":"Your order shipped with India Post, tracking number EE123456789IN."} | HTTP 200 | issue none | debug f2354663e8376 | body links[detail] |
| t010-PP-R-RAV-10193566-message-3-final.json | PP-R-RAV-10193566 | INQUIRY/WAITING_FOR_BUYER_RESPONSE/REQUIRED_OTHER_PARTY_ACTION | update 2026-10-19T17:56:39.957Z | links self,accept_claim,provide_evidence,send_message,escalate | options ["REFUND"] | funds RECEIVER DEBIT 47.34 HOLD_PLACED 2026-10-19T16:11:04.000Z |
| webhook-customer-dispute-resolved-86105147-cbed-11f1-9883-c743da698d78.json | event WH-41W01260M46157813-17948266PJ8416714 | type CUSTOMER.DISPUTE.RESOLVED | created 2026-10-19T18:47:23.327Z | received 2026-10-19T18:47:24.181Z | verify SUCCESS | PP-R-RAV-10193566 CHARGEBACK/RESOLVED update 2026-10-19T18:47:13.622Z |
| webhook-customer-dispute-resolved-dfb916bd-cbee-11f1-8c96-7f45e812594b.json | event WH-2FY93806YN965011M-5DL91847T6353450G | type CUSTOMER.DISPUTE.RESOLVED | created 2026-10-19T18:57:03.239Z | received 2026-10-19T18:57:04.128Z | verify SUCCESS | PP-R-IUT-10193562 CHARGEBACK/RESOLVED update 2026-10-19T18:56:33.570Z |
| webhook-customer-dispute-updated-07a85700-cbe8-11f1-9e4a-598daf511674.json | event WH-98M637320E121600G-7NJ273110B036151H | type CUSTOMER.DISPUTE.UPDATED | created 2026-10-19T18:08:03.853Z | received 2026-10-19T18:08:04.794Z | verify SUCCESS | PP-R-RAV-10193566 INQUIRY/UNDER_REVIEW update 2026-10-19T18:07:53.947Z |
| webhook-customer-dispute-updated-0ef6d19c-cbed-11f1-80f8-d105671fe013.json | event WH-6AR00586G2272663K-6E682996E3387582V | type CUSTOMER.DISPUTE.UPDATED | created 2026-10-19T18:44:03.572Z | received 2026-10-19T18:44:04.529Z | verify SUCCESS | PP-R-RAV-10193566 CHARGEBACK/UNDER_REVIEW update 2026-10-19T18:43:53.570Z |
| webhook-customer-dispute-updated-193cebca-cbe8-11f1-80f8-ade02dabad64.json | event WH-9X90316938515502H-0U200998SL584033K | type CUSTOMER.DISPUTE.UPDATED | created 2026-10-19T18:08:33.355Z | received 2026-10-19T18:08:34.226Z | verify SUCCESS | PP-R-RAV-10193566 CHARGEBACK/WAITING_FOR_SELLER_RESPONSE update 2026-10-19T18:08:22.396Z |
| webhook-customer-dispute-updated-1e001624-cbe4-11f1-a71f-05e4aebd1132.json | event WH-1FE8879070680372G-57000573R6798052N | type CUSTOMER.DISPUTE.UPDATED | created 2026-10-19T17:40:03.374Z | received 2026-10-19T17:40:04.376Z | verify SUCCESS | PP-R-RAV-10193566 INQUIRY/WAITING_FOR_BUYER_RESPONSE update 2026-10-19T17:40:00.304Z |
| webhook-customer-dispute-updated-37639ec7-cbe9-11f1-9e4a-7b5d33bca9c8.json | event WH-4RB3145251035311L-0FK18674VD351992A | type CUSTOMER.DISPUTE.UPDATED | created 2026-10-19T18:16:33.384Z | received 2026-10-19T18:16:34.361Z | verify SUCCESS | PP-R-RAV-10193566 CHARGEBACK/UNDER_REVIEW update 2026-10-19T18:16:31.959Z |
| webhook-customer-dispute-updated-757cdd8e-cbe6-11f1-a71f-fd6ad3838827.json | event WH-3HC30341BD063152V-0VN62128KR607343Y | type CUSTOMER.DISPUTE.UPDATED | created 2026-10-19T17:56:49.166Z | received 2026-10-19T17:56:50.067Z | verify SUCCESS | PP-R-RAV-10193566 INQUIRY/WAITING_FOR_BUYER_RESPONSE update 2026-10-19T17:56:39.957Z |
| webhook-customer-dispute-updated-984cf076-cbee-11f1-ab13-ff3d679f57aa.json | event WH-3VK67262L15961619-2DR374158J411482K | type CUSTOMER.DISPUTE.UPDATED | created 2026-10-19T18:55:03.385Z | received 2026-10-19T18:55:04.273Z | verify SUCCESS | PP-R-IUT-10193562 CHARGEBACK/UNDER_REVIEW update 2026-10-19T18:54:49.305Z |
| webhook-customer-dispute-updated-c0206b74-cbe7-11f1-9883-3da7dd1dbc30.json | event WH-8JA211838L2005539-6LT279555F462735J | type CUSTOMER.DISPUTE.UPDATED | created 2026-10-19T18:06:03.824Z | received 2026-10-19T18:06:04.932Z | verify SUCCESS | PP-R-RAV-10193566 INQUIRY/UNDER_REVIEW update 2026-10-19T18:05:54.187Z |
| webhook-customer-dispute-updated-e946bdcb-cbe6-11f1-ab13-e1741735b169.json | event WH-6VT8911131955044X-1YG32317AU717260K | type CUSTOMER.DISPUTE.UPDATED | created 2026-10-19T18:00:03.404Z | received 2026-10-19T18:00:04.296Z | verify SUCCESS | PP-R-RAV-10193566 INQUIRY/WAITING_FOR_BUYER_RESPONSE update 2026-10-19T17:59:49.078Z |
| webhook-payment-capture-refunded-982b859f-cbee-11f1-8c96-3dfca47e748f.json | event WH-1GG34206YG679234G-9CP934405C786760E | type PAYMENT.CAPTURE.REFUNDED | created 2026-10-19T18:54:54.712Z | received 2026-10-19T18:55:06.096Z | verify SUCCESS | 4UF157104X6224148 gross 120.00 fee 0.00 |

## T-107 PayPal client
- `src/paypal/client.ts` is transport only. It caches the token until 60 s before expiry, shares one token request between concurrent calls, and on a 401 refreshes once and retries once (the retry reuses the same `PayPal-Request-Id`).
- Every POST, PATCH, PUT and DELETE sends `PayPal-Request-Id`: the caller's value when given (so a deliberate retry is idempotent), otherwise a fresh UUID. GET sends none.
- Errors are `PayPalError` with `status`, `code` (PayPal's `name`), `debugId` (body, else the `paypal-debug-id` header) and `issues` (every `details[].issue`). Callers branch on `issues`, because one status and name can hide different causes (e.g. `EVIDENCE_TYPE_IS_NOT_ALLOWED`). Error messages never include the client secret.
- `findLink(resource, rel)` looks up by `rel` only. `rereadUntil(read, isChanged, opts)` re-reads (fresh GET each time) and throws `PayPalChangeNotSeenError` rather than return stale state. The write rules (approval, allowed actions) stay in the action service, T-204 onwards.
- Not covered yet: evidence upload (multipart) and retry on 429/5xx. Both come with the tasks that need them.

## T-108 Ledger entries from a capture
- `src/ledger/entries.ts`: `entriesFromCapture` writes GROSS and PAYPAL_FEE from `seller_receivable_breakdown`, source PAYPAL_VERIFIED, `sourceRef` = capture ID, `occurredAt` = the capture's `create_time` (UTC). Both amounts are positive; the entry type gives the direction. The fee is read, never recalculated.
- It refuses to guess: a missing breakdown or fee, a gross/fee currency mismatch, a non-decimal amount, or a capture that is not COMPLETED throws `CaptureBreakdownError` and nothing is written.
- `recordCapture` is idempotent per (order, capture, type), because the capture route and the webhook may both record the same capture. It writes in one transaction.
- **FX entry deferred.** The plan adds a PAYPAL_VERIFIED FX entry when the breakdown has `exchange_rate`. None of the four real captures has one (INR primary is rejected by the sandbox), and fixtures must not be hand-written. So no FX entry is built yet. When a real capture with `exchange_rate` exists, add it with a fixture. T-109 handles the FX estimate and the override.
- The sandbox fee on these four captures: 5.88 on 120.00, 2.66 on 50.00, 1.73 on 30.00, 1.51 on 25.00.

## T-109 FX estimate and rate table
- **Assumption, as agreed:** the INR rate is an FBIL reference rate, not PayPal's. The sandbox rejects INR as the primary currency (F-04), so no PayPal `exchange_rate` has been observed. Every FX entry is `REFERENCE_RATE_ESTIMATE` and shows as **Estimated**.
- `estimateFx(netMinorUsd, rate, spread)` = net cents × rate × spread, as exact integer maths on decimal strings, rounded half up to paise once at the end. Plan example: 11442 × 84 × 3% = 28834. The result is the estimated cost of the conversion (the spread), not the converted amount.
- The spread is a parameter. **Illustrative** until a real INR settlement shows what PayPal charges: the 3% in the plan example is not a measured value.
- `chooseRate`: a PayPal `exchange_rate.value` replaces the FBIL rate. The entry then stays an estimate (rate from PayPal, spread ours) and `sourceRef` is `PAYPAL_EXCHANGE_RATE`. This override is built from the field name in the Phase 0 spike code, not from a fixture, because no capture has `exchange_rate`. Check it against the first real one.
- `FxRate` loader reads our own CSV (`date,pair,rate`), not FBIL's published layout, which I could not fetch or verify. Whoever downloads FBIL rates converts them to this format. Reloading is a no-op, and a stored rate is never changed: a different value for the same day throws.
- `rateOnOrBefore` returns the latest rate on or before the date (weekends use Friday), or undefined when there is none or it is older than `maxAgeDays`. Undefined means the screen shows **Unknown**, never an invented rate.
- Not built yet: wiring into the capture route (T-111) and the seeded demo rates (T-110).

## T-110 Demo seed and reset
- **Catalogue is invented.** The sandbox store has none. `src/demo/catalogue.ts` holds 8 Neel Pottery products (SKUs `BP1001` to `BP1008`, letters and digits only because of F-27) with USD prices, and a country mix (US 45%, GB 15, CA 10, AU 8, DE 8, AE 6, SG 4, FR 4). All **Simulated demo**; change the file to change the shop.
- 400 orders over 183 days ending at a fixed anchor (2026-10-19 18:30 UTC), so the seed does not move from day to day. A fixed-seed generator makes the content identical on every run; `demoContentHash` proves it (same hash after a second seed, after reset and re-seed, and in a separate database).
- Each order gets GROSS, PAYPAL_FEE and FX ledger rows, all `DEMO_SEEDED`. The demo fee is 4.6% + $0.36 in integers: **Illustrative**. It matches the sandbox on 120, 50 and 25 USD and is 1 cent off on 30 USD. FX uses `estimateFx` with a 3% spread on seeded `FxRate` rows (source `DEMO_SEED`, business days only, so weekends use Friday).
- `Order` has no source column, so demo orders are marked by the `DEMO-` prefix on `paypalOrderId` (`DEMO-ORD-0001`, capture `DEMO-CAP-0001`). Real sandbox orders never use it.
- **Reset and the append-only rule.** Migration `20261020000200_demo_rows_deletable` changes the `LedgerEntry` delete trigger to refuse every row except `DEMO_SEEDED`. So `resetDemo` (needs `DEMO_MODE=true`) can remove demo rows, and a PAYPAL_VERIFIED, SELLER_ENTERED or any other row still cannot be deleted. UPDATE stays refused for all rows. Tests cover each case.
- Not seeded yet: shipments, disputes, buyer messages (later tasks) and the `/api/demo/reset` route. Commands: `npm run db:seed`, `npm run db:reset-demo`.
- `appendLedgerEntries` is the bulk form of the one ledger write path; the export-list test now expects it.


## PAYPAL_API_BASE is sandbox-only
- First live checkout failed with 401 because `.env` had `PAYPAL_API_BASE=https://sandbox.paypal.com` (the sandbox website) instead of the API host `https://api-m.sandbox.paypal.com`. F-50.
- `paypalBaseUrl` now accepts only the sandbox API (unset or empty also means sandbox). Any other value, including PayPal's live API, throws a message that names the allowed value, and the route logs it. This also enforces "sandbox credentials only" in code.

## Writes always carry a JSON content type (F-51)
- First live capture failed with `415 UNSUPPORTED_MEDIA_TYPE` ("The request payload is not supported"). The capture call has no body and the client sent no `Content-Type` for a body-less request. The Phase 0 spike always sent `Content-Type: application/json`. Now every POST, PATCH, PUT and DELETE sends it; GET sends none. The MSW tests could not catch this because the mock accepted any request. A test now pins the header.

## Overview on seeded data
- `src/ledger/views.ts` `loadOverview(db)`: SQL aggregates (sum and count) over `LedgerEntry`, one row per type, source and currency, ordered by ledger type then PayPal-verified first. Rows are never added across sources or currencies. Order counts split demo (`DEMO-` prefix) from the rest.
- The Overview page shows those rows with a truth-state badge each (`truthStateForSource`) and amounts via `fromMinor`; the page does no arithmetic. Demo orders are labelled **Simulated demo**. The count of sandbox orders is labelled **Calculated** and includes abandoned checkouts that were never captured; only captured orders have ledger rows.
- A database with no tables gives `{ ready: false }` and the page says to run `npm run db:migrate` and `npm run db:seed`, instead of an error page.
- CI now runs `npm run db:migrate` and `npm run db:seed` before e2e, so the Playwright test reads real seeded data. `db:seed` and `db:reset-demo` read `.env` only if it exists (CI has none).
- PR #19 (show PayPal's reason when the buttons fail; load the SDK script once) was closed without merging. Its content was re-applied on current `main` as PR #26.

## T-113: AG Grid decision (option a, with a fallback)
Decided 2026-10-20 by the owner: **option (a)**. AG Studio is used for the Overview screen and the prevention analytics. AG Grid **Community** carries every other table. The dispute workbench is our own UI (approval buttons, allowed actions from `links`, evidence flow); Studio is a report builder and does not fit it.

Facts, from the spike on branch `spike/ag-studio` (pushed for reference, not for merge):
- `ag-studio` and `ag-studio-react` 3.0.0 render ledger-shaped rows with no licence key. The console prints "License Key Not Found. All AG Studio Core features are unlocked for trial" and an offer of a trial key to hide the watermark. I did not see the watermark in a headless screenshot, so how visible it is stays **UNKNOWN**.
- npm lists the licence as "Commercial", and `ag-studio` depends on `ag-grid-enterprise`. Our repo stays MIT; the key is read from `AG_STUDIO` in the environment and is never committed.
- The paypaldev AG Grid boilerplate was read as a reference only. No file was copied: it has no LICENSE file, and its AI adapter says it was copied from the AG Studio docs. We do not use Studio's AI assistant (it needs OpenAI; our AI is mocked in tests and runs on Gemini).
- The boilerplate notes that a relative date filter in saved Studio state fails to apply on load in Studio 3.0. We keep date filters out of the default state.

Rules for the Studio screens:
- Every widget shows one truth state and one currency. A KPI that adds rows from different truth states or currencies is not allowed (the spike's single "Ledger total" did exactly that, and is why this rule exists).
- The Community tables must carry every number we claim, so Studio is a visual layer and can be dropped.

Licence dates: **UNKNOWN**. A trial key was requested by email to info@ag-grid.com on 2026-10-20 and no reply has arrived. The exit check for T-113 ("licence dates in `DECISIONS.md` by 24 Oct") is not met until it does. Ask for the issue date and expiry, and for the key to cover judging, which runs to about 21 Dec.

Checkpoint **5 Nov**: if a key has arrived, set `AG_STUDIO` and confirm the watermark is gone. If not, decide whether to ship in trial mode, or fall back to option (b), Community tables and cards only.

The grid wrapper (`src/components/data-grid.tsx`, columns in `grid-columns.ts`):
- Screens pass plain rows (each with a unique `id`) and column specs. Money columns hold integer minor units and are formatted with `fromMinor`; the grid does no arithmetic and its money columns have no filter, so no typed number reaches a money value.
- A grid with a money column must also have a truth-state column, or `toColDefs` throws, so no number goes unlabelled.
- Overview's totals table is the first user.

## T-201: Ship route
- `POST /api/orders/{paypalOrderId}/ship` with `{carrier, trackingNo}`. The shipment is saved locally first (one per order, updated if shipped again), then PayPal is asked. The answer is always 200 with `outcome` `PUSHED` or `LOCAL_ONLY`; a PayPal refusal or a network failure is stored in `pushError` and never lost or thrown to the seller. 400 for a bad body, 404 for an unknown order.
- The request is the one PayPal accepted in the sandbox (`track-request-carrier-india_post.json`): `POST /v2/checkout/orders/{id}/track` with `capture_id`, `tracking_number`, `notify_payer: false`, `carrier`, and `PayPal-Request-Id: track-{captureId}-{trackingNo}`. A test pins the body to that fixture.
- A push counts as `PUSHED` only if the 201 response holds a tracker with id `{captureId}-{trackingNo}`, as the real response did. A 2xx without it is stored as `REJECTED` with `TRACKER_NOT_CONFIRMED`. This is read from the response because, unlike dispute writes, this response carries state (the tracker); no re-GET.
- Not sent, saved as `NOT_ATTEMPTED` with a reason: demo orders (`DEMO_ORDER`), orders never captured (`NO_CAPTURE`), carriers other than INDIA_POST, DHL and FEDEX (`CARRIER_NOT_PUSHABLE`: the `OTHER` retry needs `carrier_name_other` and no fixture of it exists, and `DEMO` is not a PayPal carrier), and a server with no PayPal credentials (`PAYPAL_NOT_CONFIGURED`).
- **Rule reading, please confirm:** CLAUDE.md says PayPal writes happen only in `src/disputes/actions.ts`, after seller approval. This write is an order-level tracking push, not a dispute action, and the seller's own ship action is the approval, like checkout's create and capture. T-212's lint rule is about dispute writes. If you want tracking inside `actions.ts` too, say so.
- The 403 in the tests is mocked: the status is set by the test and the body is a real PayPal error from `provide-evidence-response-v2.json`. No real tracking rejection is on file, so what PayPal says on a real 403 is **UNKNOWN**.
- The order screen shows the shipment with a status chip ("Tracking sent to PayPal" or "Local tracking only") and the carrier and tracking number labelled **Seller entered**. The chip is a status, not a truth-state label.
- `resetDemo` now deletes shipments of demo orders (the foreign key would otherwise block the reset).

### T-201 live check (2026-10-20, owner's PC, sandbox, order `3K7336723L338842X`, the 120.00 capture)
Three calls to `POST /api/orders/3K7336723L338842X/ship`, carrier "India Post":

| Run | Tracking number | HTTP | outcome | pushStatus | pushedToPaypalAt (UTC) | pushError |
|---|---|---|---|---|---|---|
| 1 | EE123456789IN | 200 | PUSHED | PUSHED | 2026-10-20T09:40:04.890Z | null |
| 2 | EE123456789IN again | 200 | PUSHED | PUSHED | 2026-10-20T09:40:13.361Z | null |
| 3 | EE987654321IN, same order | 200 | PUSHED | PUSHED | 2026-10-20T09:40:21.410Z | null |

- Run 1 is the first real push through the app: PayPal accepted the request and its response showed our tracker, so the PUSHED rule held against a real response. One shipment row per order throughout (same `shipmentId`); the carrier was stored as `INDIA_POST`.
- Run 2 was accepted too. The request id is the same for the same capture and tracking number, so PayPal may have replayed its first answer; this does not show how PayPal treats a true duplicate. It shows that sending the same shipment again is safe.
- Run 3 was accepted with a different number on the same order. **UNKNOWN:** whether PayPal now holds two trackers on that order or replaced the first. Only a GET of the order shows that, and none was made.
- No real rejection was seen, so the 403 path is still tested only with a mock. What PayPal says on a real refusal stays **UNKNOWN**.
- The response bodies were not saved, so there is no new fixture. The existing `track-response-*` fixtures cover the shape the code reads.

## T-202: Webhook receiver
- `POST /api/webhooks/paypal` (the Phase 0 listener used `/webhooks/paypal`; a webhook registered for the tunnel must be pointed at the new path). Needs `PAYPAL_WEBHOOK_ID` in `.env` (the id of the webhook registered in the sandbox app) plus the PayPal client id and secret; without them the route answers 500 `SERVER_MISCONFIGURED`.
- **Verification** is PayPal's own `POST /v1/notifications/verify-webhook-signature`, as in the Phase 0 spike, with the five transmission headers, our webhook id and the **raw body spliced in unchanged** (the signature covers those bytes). The client got a `RawJson` body type for this. Only `verification_status` `SUCCESS` counts. A missing header is "not verified" without calling PayPal. The fixtures are redacted, so a signature cannot be checked offline; the tests use the real headers, the real bodies and PayPal's real SUCCESS answer, and the one non-SUCCESS answer is set by the test (no real FAILURE is on file).
- **Responses:** 200 `ACCEPTED` or `DUPLICATE`; 401 for a signature that does not verify; 400 for a body that is not a JSON object with a safe event id and type; 503 when PayPal cannot be asked (error or the 1.5 s timeout), storing nothing, so PayPal delivers it again. The 1.5 s timeout is what keeps the endpoint inside the 2 s the plan asks for; the sync itself runs after the response (`after`).
- **Deduplication on event id**, atomic under concurrent copies (five at once sync once). An event that fails verification is stored as unverified (`result` `UNVERIFIED`) and triggers nothing. It does **not** use up the id: if the genuine, verified delivery of the same event follows, it upgrades the row and is synced. Otherwise a forger who knew a real event id could make us ignore the real event.
- Only the event id, type, verified flag, times and a result code are stored. No body, headers, signature or dispute id, so no buyer data lands in this table.
- **What triggers a sync:** a verified `CUSTOMER.DISPUTE.*` event whose `resource.dispute_id` matches `PP-` plus letters, digits and hyphens. Other types are stored and marked `IGNORED_TYPE`; a bad id is `IGNORED_BAD_ID`. A failing sync is stored as `ERROR: ...`, the answer stays 200, and the event stays deduplicated, because webhooks are only a nudge: Phase 0 saw no webhook for the link change or the hold release, so the poller (T-205) is required, not optional.
- **Not wired yet:** `syncDispute` arrives with T-203. Until then a verified dispute event is stored with result `NO_SYNC_AVAILABLE`.
- **Accepted for the demo:** anyone can POST forged events and each new event id adds one small unverified row. No cap or rate limit; add one before any public deployment.
- **Not tested live yet:** verification against the real sandbox with this code, and the real redelivery behaviour (F-38 is still only a console observation).

## T-203: syncDispute
- `syncDispute(deps, disputeId)` does one fresh `GET /v1/customer/disputes/{id}` (the read the Phase 0 spike used), parses it and upserts the `DisputeCase`. It only reads from PayPal. It returns `{created, changed, rawHash}`. The webhook route now calls it for verified `CUSTOMER.DISPUTE.*` events; the poller and the sync button call it in T-205.
- **Kept from the payload:** `dispute_id`, `reason`, `status`, `dispute_life_cycle_stage` (as `stage`), `dispute_amount` (as integer minor units through `toMinor`, never a float), `seller_response_due_date`, the requested evidence types, `dispute_outcome.outcome_code` (PayPal's own code, unchanged). Read from the real fixtures; all of them are bare GET bodies.
- **Deadline:** `seller_response_due_date` is present only while the seller must act (CHARGEBACK, WAITING_FOR_SELLER_RESPONSE). It is absent for inquiries, under review and resolved, so `sellerDeadline` is null there; no other date is substituted. A date that is present but unparseable is an error, not a null.
- **Requested evidence:** the distinct `evidence_type`s whose `source` is `REQUESTED_FROM_SELLER`, in the order PayPal first lists them. VERIFIED in `dispute-details.json`: PayPal keeps listing a requested type after the seller has submitted it (requested FULFILLMENT, REFUND, OTHER; submitted FULFILLMENT, OTHER). So this column is "what PayPal asks for", not "what is still missing"; the workbench compares it with submitted evidence. Under review it is empty.
- **`rawHash`** is SHA-256 of the whole payload with keys sorted and the `links` array sorted: PayPal returns the same links in a different order between responses (Phase 0), and that must not look like a change. Everything else counts, including `fund_movements`, messages and `update_time`, so money moving or a new message changes the hash. T-210 compares it between approval and submit.
- **Not stored:** buyer and seller names, emails, messages, notes. Only codes, the amount, the deadline and the hash. `fund_movements` are read into the hash but not stored on their own yet; they are their own source and get their own table in a later task.
- **Left alone on purpose:** `allowedActionsJson` is `'[]'` on create and never updated here (allowed actions come from a fresh GET of the links by `rel`, T-204, never from storage); `orderId` and `buyerHash` are untouched by a re-sync (T-206).
- **Refuses, stores nothing:** an id that is not `PP-` plus letters, digits and hyphens (no request is made), a payload for a different dispute than asked, and any payload with a missing or malformed id, reason, status, stage or amount, or an amount with more decimals than its currency. A PayPal error passes up unchanged. A refused sync leaves the stored case as it was.
- **Concurrency:** a sync that loses the race to create a row carries on as an update; five at once leave one row and none fails.
- **Not tested live:** the parser has only seen the Phase 0 fixtures. Dispute types we have not seen (for example a chargeback with a different reason, or a currency with no decimals) are handled by the same rules but are untested against real PayPal data.
