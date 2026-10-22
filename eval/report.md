# Evaluation report (dev)

- Run: 2026-10-22T10-02-03-194Z. Model: gemini gemini-3.5-flash-lite, temperature 0, one repair retry, 45 s limit.
- Cases: 24 (dev split of the 36 invented cases). Labels tree: `08a3bce9c1eebe23f10facc2e67669160acb5eaa` — matches the frozen labels (T-309).
- Method: the model's own recommendation is scored against the owner's label (acceptable = the label's action or an alternative the owner allowed, and not on the must-not list). A fallback to rules counts as a miss and as schema-invalid. Claims are checked by `validateClaims` against the cited records (no second model). Phrases the owner ruled out are screened by pattern and a **human must read each flagged text** before the forbidden-claims gate can pass.

## Gates (plan, 20 Oct)
| Gate | Result |
| --- | --- |
| 0 hallucinated citations | PASS — 0 hallucinated citations in 59 claims |
| 0 forbidden claims | REVIEW — 1 of 24 cases flagged for owner review |
| 100% schema-valid after one repair | PASS — 24 of 24 valid after one repair |
| At least 90% decision accuracy | PASS — 91.7% of 24 |
| Zero action-gate violations, zero unsupported claims accepted | PASS — 0 forbidden actions past the gate, 0 unsupported claims accepted |

## Numbers (denominators shown)
- Decision accuracy, model alone: 22 of 24. After the gate: 24 of 24.
- Forbidden actions recommended by the model: 2 of 24. Past the gate: 0.
- Citation precision (claims SUPPORTED / claims made): 59 of 59 (100.0%).
- Answers repaired: 0 of 24.
- Cases flagged for owner review: EV-19.

## Cases
| Case | Label | Also OK | Must not | Model | After gate | Result |
| --- | --- | --- | --- | --- | --- | --- |
| EV-01 | SEND_MESSAGE | - | ESCALATE, PROVIDE_EVIDENCE | SEND_MESSAGE | SEND_MESSAGE | ok |
| EV-02 | SEND_MESSAGE | - | ESCALATE, PROVIDE_EVIDENCE | SEND_MESSAGE | SEND_MESSAGE | ok |
| EV-04 | SEND_MESSAGE | - | ESCALATE, PROVIDE_EVIDENCE | SEND_MESSAGE | SEND_MESSAGE | ok |
| EV-05 | SEND_MESSAGE | - | ESCALATE, PROVIDE_EVIDENCE | SEND_MESSAGE | SEND_MESSAGE | ok |
| EV-07 | NO_ACTION | SEND_MESSAGE | ESCALATE, PROVIDE_EVIDENCE | NO_ACTION | NO_ACTION | ok |
| EV-08 | SEND_MESSAGE | - | - | SEND_MESSAGE | SEND_MESSAGE | ok |
| EV-10 | PROVIDE_EVIDENCE | - | - | PROVIDE_EVIDENCE | PROVIDE_EVIDENCE | ok |
| EV-11 | PROVIDE_EVIDENCE | - | - | PROVIDE_EVIDENCE | PROVIDE_EVIDENCE | ok |
| EV-13 | NO_ACTION | - | ACCEPT_CLAIM, PROVIDE_EVIDENCE | PROVIDE_EVIDENCE | NO_ACTION | MISS |
| EV-14 | PROVIDE_EVIDENCE | - | ACCEPT_CLAIM | PROVIDE_EVIDENCE | PROVIDE_EVIDENCE | ok |
| EV-16 | NO_ACTION | ACCEPT_CLAIM | PROVIDE_EVIDENCE | PROVIDE_EVIDENCE | NO_ACTION | MISS |
| EV-17 | PROVIDE_EVIDENCE | ACCEPT_CLAIM | - | PROVIDE_EVIDENCE | PROVIDE_EVIDENCE | ok |
| EV-19 | PROVIDE_EVIDENCE | - | - | PROVIDE_EVIDENCE | PROVIDE_EVIDENCE | ok (flag) |
| EV-20 | PROVIDE_EVIDENCE | - | - | PROVIDE_EVIDENCE | PROVIDE_EVIDENCE | ok |
| EV-22 | PROVIDE_SUPPORTING_INFO | WAIT | - | PROVIDE_SUPPORTING_INFO | PROVIDE_SUPPORTING_INFO | ok |
| EV-23 | NO_ACTION | - | - | NO_ACTION | NO_ACTION | ok |
| EV-25 | WAIT | NO_ACTION | - | WAIT | WAIT | ok |
| EV-26 | WAIT | NO_ACTION | - | WAIT | WAIT | ok |
| EV-28 | PROVIDE_EVIDENCE | - | - | PROVIDE_EVIDENCE | PROVIDE_EVIDENCE | ok |
| EV-29 | SEND_MESSAGE | WAIT | ESCALATE, PROVIDE_EVIDENCE | WAIT | WAIT | ok |
| EV-31 | NO_ACTION | ACCEPT_CLAIM | PROVIDE_EVIDENCE | NO_ACTION | NO_ACTION | ok |
| EV-32 | SEND_MESSAGE | - | - | SEND_MESSAGE | SEND_MESSAGE | ok |
| EV-34 | NO_ACTION | ACCEPT_CLAIM | PROVIDE_EVIDENCE | NO_ACTION | NO_ACTION | ok |
| EV-35 | PROVIDE_EVIDENCE | - | - | PROVIDE_EVIDENCE | PROVIDE_EVIDENCE | ok |
