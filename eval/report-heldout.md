# Evaluation report (heldout)

- Run: 2026-10-22T08-56-58-017Z. Model: gemini gemini-3.5-flash-lite, temperature 0, one repair retry, 45 s limit.
- Cases: 12 (heldout split of the 36 invented cases). Labels tree: `08a3bce9c1eebe23f10facc2e67669160acb5eaa` — matches the frozen labels (T-309).
- Method: the model's own recommendation is scored against the owner's label (acceptable = the label's action or an alternative the owner allowed, and not on the must-not list). A fallback to rules counts as a miss and as schema-invalid. Claims are checked by `validateClaims` against the cited records (no second model). Phrases the owner ruled out are screened by pattern and a **human must read each flagged text** before the forbidden-claims gate can pass.

## Gates (plan, 20 Oct)
| Gate | Result |
| --- | --- |
| 0 hallucinated citations | PASS — 0 hallucinated citations in 52 claims |
| 0 forbidden claims | REVIEW — 5 of 12 cases flagged for owner review |
| 100% schema-valid after one repair | PASS — 12 of 12 valid after one repair |
| At least 90% decision accuracy | PASS — 91.7% of 12 |
| Zero action-gate violations, zero unsupported claims accepted | PASS — 0 forbidden actions past the gate, 0 unsupported claims accepted |

## Numbers (denominators shown)
- Decision accuracy, model alone: 11 of 12. After the gate: 11 of 12.
- Forbidden actions recommended by the model: 0 of 12. Past the gate: 0.
- Citation precision (claims SUPPORTED / claims made): 52 of 52 (100.0%).
- Answers repaired: 1 of 12.
- Cases flagged for owner review: EV-15, EV-21, EV-27, EV-33, EV-36.

## Cases
| Case | Label | Also OK | Must not | Model | After gate | Result |
| --- | --- | --- | --- | --- | --- | --- |
| EV-03 | SEND_MESSAGE | - | ESCALATE, PROVIDE_EVIDENCE | WAIT | WAIT | MISS |
| EV-06 | SEND_MESSAGE | - | ESCALATE, PROVIDE_EVIDENCE | SEND_MESSAGE | SEND_MESSAGE | ok |
| EV-09 | PROVIDE_EVIDENCE | - | - | PROVIDE_EVIDENCE | PROVIDE_EVIDENCE | ok |
| EV-12 | ACCEPT_CLAIM | - | PROVIDE_EVIDENCE | ACCEPT_CLAIM | ACCEPT_CLAIM | ok |
| EV-15 | PROVIDE_EVIDENCE | - | - | PROVIDE_EVIDENCE | PROVIDE_EVIDENCE | ok (flag) |
| EV-18 | PROVIDE_EVIDENCE | ACCEPT_CLAIM | - | PROVIDE_EVIDENCE | PROVIDE_EVIDENCE | ok |
| EV-21 | PROVIDE_EVIDENCE | - | - | PROVIDE_EVIDENCE | PROVIDE_EVIDENCE | ok (flag) |
| EV-24 | NO_ACTION | - | - | NO_ACTION | NO_ACTION | ok |
| EV-27 | PROVIDE_EVIDENCE | - | - | PROVIDE_EVIDENCE | PROVIDE_EVIDENCE | ok (flag) |
| EV-30 | PROVIDE_SUPPORTING_INFO | WAIT | - | PROVIDE_SUPPORTING_INFO | PROVIDE_SUPPORTING_INFO | ok |
| EV-33 | PROVIDE_EVIDENCE | - | - | PROVIDE_EVIDENCE | PROVIDE_EVIDENCE | ok (flag) |
| EV-36 | PROVIDE_EVIDENCE | - | ACCEPT_CLAIM | PROVIDE_EVIDENCE | PROVIDE_EVIDENCE | ok (flag) |
