# KeepMore

KeepMore helps small cross-border sellers who take PayPal keep more of what they earn. It reads each order's real money trail from PayPal (gross, fee, holds and settlements), tracks shipments, and turns a PayPal dispute into a guided workbench. That workbench shows what PayPal asked for and what the seller's records can actually support, and it acts only through the actions PayPal currently allows. The seller approves every response before it is sent.

## Run locally

Requires Node 22.12 or later.

```sh
npm ci
cp .env.example .env   # then fill in your sandbox values
npm run dev
```

Open http://localhost:3000.

Other scripts: `npm run lint`, `npm run typecheck`, `npm test`, `npm run e2e` (Playwright, Chromium; first run `npx playwright install chromium`), `npm run build`, and `npm run check`, which runs lint, typecheck, test and build in that order.

**Demo video (2:29):** https://youtu.be/clzeClhPcvo

## Sandbox only

This repository uses **PayPal sandbox credentials only**. No live PayPal account, live money or real customer data is involved. The AI provider receives only synthetic demo data. Keep `.env` out of version control; `.env.example` holds placeholders only.

## Hackathon quick start (PayPal AI Hackathon 2026, judges start here)

Everything runs locally with **PayPal sandbox credentials only**. No live money, no real customer data.

1. Requires Node 22.12 or later.
2. `npm ci`
3. `cp .env.example .env`, then fill in your own **sandbox** values (see "Environment" below).
4. Create and seed the demo database:
   ```sh
   npm run db:migrate
   npm run db:seed
   ```
5. Production build and start, as used in the demo video:
   ```sh
   npm run build
   npm start -- --port 3100
   ```
   Open http://localhost:3100. (`npm run dev` also works, on http://localhost:3000.)
6. To return the demo data to its starting state at any time: `npm run db:reset-demo`.

### Environment

Set these in `.env` (placeholders are in `.env.example`; never commit `.env`):

- `DEMO_MODE=true` turns on the seeded demo cases (labelled "Simulated demo" in the app).
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_API_BASE`, `PAYPAL_WEBHOOK_ID`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`: your PayPal **sandbox** REST app.
- `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `AI_DAILY_CALL_CAP`: the runtime AI (Gemini). Without a key the app can run with `AI_PROVIDER=fixture`, which returns canned suggestions and is not used for the real AI behaviour. `npm run eval` runs the AI evaluation.
- `HMAC_SECRET`: at least 32 random bytes.
- `DATABASE_URL`, `SYNC_INTERVAL_SECONDS`.
- `NEXT_PUBLIC_AG_GRID_LICENSE_KEY`: optional AG Grid / AG Studio licence. Without it AG Studio runs in trial mode and may show a watermark.

## Tests and CI

- `npm test` runs the unit and integration tests (Vitest, 74 test files). `npm run e2e` runs the 10 browser tests (Playwright). `npm run check` runs lint, typecheck, tests and build.
- CI (`.github/workflows/ci.yml`) runs on every pull request and every push to `main`, on Node 22 and Node 24: lint, typecheck, tests, browser tests and build.
- AI evaluation (`npm run eval`): 36 invented dispute cases (24 for development, 12 held out), scored against labels the owner wrote and froze before the first run. Reports are in `eval/report.md` and `eval/report-heldout.md`. The model alone matched the labels on 33 of 36 cases (22 of 24 development, 11 of 12 held out), with 0 hallucinated citations in 111 claims checked. These are invented cases, not real disputes.

## Known issues

- PayPal's sandbox checkout window sometimes shows "Things don't appear to be working at the moment" after you click the PayPal button in the demo shop (`/store`). This message comes from PayPal's sandbox. The app's own order-creation call succeeds (HTTP 201 with an order ID). If you see it, try again later.
- The AG Studio AI assistant ("Ask the AI assistant" on the Overview page) is experimental. It works on demo data only, can take about 25 seconds, may show retried steps, and may occasionally answer "The model could not answer."
- Fee figures come from PayPal's India fees page (last updated 28 March 2024) and may be out of date.

## What is real and what is simulated

- **Real (PayPal sandbox):** orders, disputes, dispute messages and the data read back from PayPal's sandbox APIs. Items labelled "Verified by PayPal" come from these calls.
- **Simulated:** the seeded demo orders and demo disputes (for example `DEMO-ORD-0320`, `PP-DEMO-0001`, `PP-DEMO-0003`) are fabricated for the demo and are labelled "Simulated demo" in the app.
- **Money is never added across currencies.** Dollar and rupee amounts are shown separately, each with its source label.
- **Fee figures** shown for context come from PayPal's India fees page (last updated 28 March 2024) and should be rechecked before relying on them.
- **Not claimed:** KeepMore makes no claim about dispute win rates or Seller Protection eligibility. PayPal decides those.

## How AI is used

Gemini suggests a dispute reply. It does not decide what is true or what is sent. Deterministic code checks every claim against the seller's records, and the seller approves the exact payload before it is sent to PayPal. The suggestion is labelled "AI suggestion, checked". The AI provider receives only synthetic demo data.

## Built with

Next.js, React, TypeScript, Prisma, Zod, Tailwind, PayPal sandbox REST APIs (Orders v2, Disputes v1, webhooks), Google Gemini (dispute suggestions and the AG Studio assistant), **AG Grid** 36.2.0 (data tables) and **AG Studio** 3.0.0 (the Overview dashboard). The voice-over in the demo video was generated with Gemini text-to-speech in Google AI Studio.

## Contributing

- Run `npm run check` before every commit.
- CI (`.github/workflows/ci.yml`) runs on every pull request and every push to `main`, on Node 22 and Node 24. It runs lint, typecheck, unit tests, the Playwright e2e test (Chromium) and the production build.
- `main` is protected: the checks `check (Node 22)` and `check (Node 24)` must pass before a pull request can merge.
- Dependabot opens weekly grouped minor and patch updates for npm and GitHub Actions. It skips releases younger than 14 days.

### Showing that a red CI blocks a merge (T-102)

This is done on a throwaway branch, never on `main`:

1. `git switch -c ci-red-demo`
2. Add a failing test, for example `tests/unit/ci-red-demo.test.ts` containing `expect(1).toBe(2)`.
3. Commit, push the branch, and open a pull request into `main`.
4. CI runs and fails on both Node versions. The pull request shows the failed checks, and the merge button stays blocked.
5. Record the pull request link and the failed run in `docs/DECISIONS.md`.
6. Close the pull request without merging, and delete the branch, locally and on GitHub.

Status: demonstrated on 20 Oct 2026. Pull request #6 (a deliberately failing test) failed `check (Node 22)` and `check (Node 24)` at the Test step, and its merge was blocked by the `protect-main` ruleset. The pull request was closed without merging and the branch deleted.

## Licence

MIT. See [LICENSE](LICENSE).
