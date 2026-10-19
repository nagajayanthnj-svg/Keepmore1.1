# KeepMore

KeepMore helps small cross-border sellers who take PayPal keep more of what they earn. It reads each order's real money trail from PayPal (gross, fee, holds and settlements), tracks shipments, and turns a PayPal dispute into a guided workbench. That workbench shows what PayPal asked for and what the seller's records can actually support, and it acts only through the actions PayPal currently allows. The seller approves every response before it is sent.

## Run locally

Requires Node 20 or later.

```sh
npm ci
cp .env.example .env   # then fill in your sandbox values
npm run dev
```

Open http://localhost:3000.

Other scripts: `npm run lint`, `npm run typecheck`, `npm test`, `npm run e2e` (Playwright, Chromium; first run `npx playwright install chromium`), `npm run build`, and `npm run check`, which runs lint, typecheck, test and build in that order.

## Sandbox only

This repository uses **PayPal sandbox credentials only**. No live PayPal account, live money or real customer data is involved. The AI provider receives only synthetic demo data. Keep `.env` out of version control; `.env.example` holds placeholders only.

## Contributing

- Run `npm run check` before every commit.
- CI (`.github/workflows/ci.yml`) runs on every pull request and every push to `main`, on Node 20 and Node 24. It runs lint, typecheck, unit tests, the Playwright e2e test (Chromium) and the production build.
- `main` is protected: the checks `check (Node 20)` and `check (Node 24)` must pass before a pull request can merge.
- Dependabot opens weekly grouped minor and patch updates for npm and GitHub Actions. It skips releases younger than 14 days.

### Showing that a red CI blocks a merge (T-102)

This is done on a throwaway branch, never on `main`:

1. `git switch -c ci-red-demo`
2. Add a failing test, for example `tests/unit/ci-red-demo.test.ts` containing `expect(1).toBe(2)`.
3. Commit, push the branch, and open a pull request into `main`.
4. CI runs and fails on both Node versions. The pull request shows the failed checks, and the merge button stays blocked.
5. Record the pull request link and the failed run in `docs/DECISIONS.md`.
6. Close the pull request without merging, and delete the branch, locally and on GitHub.

Status: not yet demonstrated. The owner does this once branch protection is on.

## Licence

MIT. See [LICENSE](LICENSE).
