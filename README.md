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

## Licence

MIT. See [LICENSE](LICENSE).
