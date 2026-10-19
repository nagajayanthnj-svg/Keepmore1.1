# KeepMore: rules for every session

Plan: `KeepMore Technical Design and Build Plan.md` (task IDs T-xxx). Decisions: `docs/DECISIONS.md`.
Friction log: `docs/FRICTION_LOG.md` (add an F-xx row for anything that cost time or put evidence at risk).
Phase 0 findings: `docs/PHASE0_FINDINGS.md`.

## Secrets
- Never read, print, copy or commit `.env`. Placeholders go in `.env.example` only.
- Sandbox credentials only. No live PayPal account or real customer data, ever.

## How work is done
- Test first. Write the failing test, see it fail, then make it pass.
- Run `npm run check` (lint, typecheck, test, build) before every commit. Run `npm run e2e` when UI or routes change.
- Dependencies are pinned to exact versions (no `^` or `~`). Say why before adding one that is not in the plan.
- Prefer a release at least two weeks old, unless there is a stated reason.
- Fixtures in `tests/fixtures/paypal/` are real sandbox responses with PII redacted. Never hand-write or edit a PayPal response from memory.
- `scripts/` holds the Phase 0 spike scripts. Leave them unchanged unless asked.

## Money
- Money only through `toMinor` / `fromMinor`, as integer minor units. Never a float, never a JS number from user input.
- Read amounts from PayPal (`seller_receivable_breakdown`, `fund_movements`). Never recalculate a fee that PayPal returned.
- `fund_movements` is its own source. Money moves before the dispute status changes.

## Truth-state labels
Every number or fact shown to the seller carries exactly one of these:
**Verified by PayPal**, **Calculated**, **Seller entered**, **Estimated**, **Illustrative**, **Unknown**, **Simulated demo**.
If none fits, it is **Unknown**. Do not invent a new label.

## PayPal
- PayPal writes happen only in the action service (`src/disputes/actions.ts`), and only after seller approval.
- Allowed actions come only from the `links` on a fresh GET of the dispute, looked up by `rel`. Never by position, never from a cache.
- After every write, re-GET until the change shows. Write responses carry no state.
- Webhooks are verified and deduplicated on event ID.

## AI
- The AI never calls PayPal and never decides alone. Its output is a suggestion, checked against the allowed actions and the records.
- Only synthetic demo data is sent to the AI provider. No real names, emails, addresses or IDs.
- The AI is mocked in all tests except `npm run eval` and the live smoke test.

## Git
- Commit messages end with the co-author line given in the session.
- Never push or force-push unless asked. Never put a personal email in commits; use the GitHub no-reply address.
