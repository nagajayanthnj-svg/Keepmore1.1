# KeepMore Technical Design and Build Plan

Oct 19, 2026 · @Naga

## How to use this document

This is the technical design for KeepMore PRD v2.2 and a test-first build plan of 70 tasks from today to submission on 11 Nov 2026 (deadline 12 Nov, 12:00 PM PT). Work the tasks in order; each one names the failing test to write before any code.

**The loop for every task**

1. **Red:** write the test named in the task. Run it and see it fail for the right reason.
2. **Green:** write the least code that makes it pass.
3. **Refactor:** clean up with all tests still green.
4. **Evidence:** commit with the task ID in the message (`T-214: action gate rejects stale state`) and paste the test command and result into the PR or `NEXT_STEP.md`.

Tasks marked **manual** (sandbox steps, interviews, video) have a check instead of a test; record the result in `docs/DECISIONS.md`.

**Conventions**

- Task IDs: T-0xx spike, T-1xx foundation, T-2xx core flow, T-3xx AI, T-4xx UX and outcome, T-5xx hardening, T-6xx submission.
- One task in progress at a time. A task is done only when its test is green in CI.
- Money is always integer minor units plus an ISO currency code. Time is always full UTC ISO-8601.
- Anything simulated, seeded or estimated carries a visible label in the UI.
- If a PayPal behaviour differs from this document, the spike result wins: record it in `DECISIONS.md` and update this document.

**Using it with Claude Code:** give it this document and the PRD, and ask it to complete one task at a time, starting with the first unfinished task, and to stop after each task with the test output.

## Architecture

One Next.js app holds everything: the pages, the server routes, and a set of plain TypeScript modules that do the real work. Only the server talks to PayPal and the AI provider, and only the action service can call a PayPal write endpoint.

&#91;embedded content: architecture · one server, one write path\]

Webhooks only trigger a sync; the sync re-reads PayPal before any state changes, and the AI never touches PayPal at all.

| Component | Responsibility | Never does |
| --- | --- | --- |
| Pages (React) | Four screens; shows labels, states and drafts | Calls PayPal or the AI directly; computes money |
| Route handlers | Thin HTTP layer; validates input with Zod; calls services | Holds business logic |
| PayPal client | OAuth token cache, typed calls, idempotency headers, raw-response logging | Decides whether an action is allowed |
| Webhook receiver | Verifies signature, deduplicates by event ID, queues a sync | Trusts payload content without re-fetching |
| Dispute sync | Re-fetches dispute details; updates case, allowed actions and outcome | Writes to PayPal |
| Normaliser | Turns raw carrier and PayPal values into canonical forms at ingestion | Guesses; unmapped values become UNKNOWN |
| Ledger | Append-only money entries with source and truth state | Mixes actual and estimated values in one entry |
| Case-file builder | Assembles a sealed, PII-free case file with stable record IDs | Includes buyer email, address or payer ID |
| Rules engine | Stage A: evidence checklist, deadline, baseline recommendation | Calls the model |
| AI pipeline | Stage B: structured analysis and drafts, one repair retry | Holds any PayPal write tool |
| Claim validator | Checks typed claims against cited record fields | Uses a second model as judge |
| Action service | Re-fetches state, checks the action gate and approval hash, then writes | Writes without a matching approval |

## Stack, layout and environment

Node 22.12 or later (CI tests Node 22 and 24; Node 20 is end-of-life and dropped), Next.js App Router with TypeScript in strict mode, Tailwind, SQLite through Prisma, Zod, Vitest, Playwright, and MSW for mocking PayPal and the AI in tests. Pin exact versions in `package.json` when T-101 runs.

**Repository layout**

```text
keepmore/
  app/                    pages and route handlers
    (screens)/overview, orders/[id], disputes/[id], outcome/[id]
    store/                demo storefront (Neel Pottery)
    api/                  route handlers, see the API section
  src/
    paypal/               client.ts, auth.ts, orders.ts, disputes.ts, webhooks.ts
    ledger/               entries.ts, fx.ts, views.ts
    normalise/            carrier-status.ts, tracking.ts, money.ts, time.ts
    disputes/             sync.ts, action-gate.ts, actions.ts, outcome.ts
    case/                 case-file.ts, rules.ts
    ai/                   adapter.ts, prompt.ts, schema.ts, validate-claims.ts
    audit/                audit.ts
    lib/                  hmac.ts, ids.ts, errors.ts
  prisma/                 schema.prisma, seed.ts, migrations/
  tests/
    unit/  integration/  e2e/  fixtures/paypal/  fixtures/ai/
  eval/                   cases/*.json, labels/*.json, run-eval.ts, report.md
  docs/                   PRD.md, DESIGN.md, DECISIONS.md, DEMO_SCRIPT.md, SECURITY.md
  .env.example  LICENSE  README.md  NEXT_STEP.md
```

**Environment variables** (placeholders only in `.env.example`)

| Variable | Purpose |
| --- | --- |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Sandbox REST app credentials |
| `PAYPAL_API_BASE` | `https://api-m.sandbox.paypal.com` |
| `PAYPAL_WEBHOOK_ID` | Needed to verify webhook signatures |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | Client ID for the checkout buttons (public by design) |
| `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` | Runtime model for Stage B |
| `HMAC_SECRET` | Keys the buyer hash; at least 32 random bytes |
| `DATABASE_URL` | `file:./dev.db` |
| `DEMO_MODE` | `true` shows seeded-data labels and the reset button |
| `SYNC_INTERVAL_SECONDS` | Dispute poll interval; default 900 |

## Data model

Twelve tables. Status-like fields are strings checked by Zod unions in code, so the schema works on SQLite whatever the Prisma version; money is `Int` minor units, time is `DateTime` in UTC. `LedgerEntry`, `AuditEvent` and `WebhookEvent` are append-only: no update or delete paths exist in the code.

```prisma
model Order {
  id             String   @id @default(cuid())
  paypalOrderId  String   @unique
  captureId      String?  @unique
  itemsJson      String
  country        String               // ISO 3166 alpha-2
  grossMinor     Int
  currency       String               // ISO 4217
  buyerHash      String?              // HMAC of payer ID; never displayed
  sellerProtectionStatus     String?  // raw capture seller_protection.status, e.g. ELIGIBLE (T-002)
  sellerProtectionCategories String?  // JSON array of seller_protection.dispute_categories
  createdAt      DateTime @default(now())
  shipment       Shipment?
  ledger         LedgerEntry[]
  disputes       DisputeCase[]
}

model LedgerEntry {
  id                String   @id @default(cuid())
  orderId           String
  order             Order    @relation(fields: [orderId], references: [id])
  type              String   // GROSS|PAYPAL_FEE|FX|DUTY|SHIPPING|RETURN_POSTAGE|REFUND|DISPUTE_FEE|RETAINED
  amountMinor       Int
  currency          String
  inrMinor          Int?
  sourceType        String   // PAYPAL_VERIFIED|REFERENCE_RATE_ESTIMATE|SELLER_ENTERED|DEMO_SEEDED|HYPOTHETICAL_SCENARIO
  sourceRef         String?  // capture ID, refund ID, case ID
  rate              Decimal?
  rateDate          DateTime?
  calcVersion       String
  correctsEntryId   String?  // correcting entries instead of edits
  occurredAt        DateTime
  createdAt         DateTime @default(now())
}

model FxRate {
  id      String   @id @default(cuid())
  date    DateTime
  pair    String   // USD/INR
  rate    Decimal
  source  String   // FBIL|PAYPAL|DEMO_SEED
  @@unique([date, pair, source])
}

model Shipment {
  id               String    @id @default(cuid())
  orderId          String    @unique
  order            Order     @relation(fields: [orderId], references: [id])
  carrier          String    // canonical code
  trackingNo       String    // normalised
  pushStatus       String    // NOT_ATTEMPTED|PUSHED|REJECTED
  pushedToPaypalAt DateTime?
  pushError        String?   // status code + redacted raw response
  eventsJson       String    // normalised events with source state
}

model DisputeCase {
  id                 String    @id @default(cuid())
  paypalDisputeId    String    @unique
  orderId            String?
  order              Order?    @relation(fields: [orderId], references: [id])
  reason             String
  stage              String
  status             String
  amountMinor        Int
  currency           String
  sellerDeadline     DateTime?
  allowedActionsJson String    // derived from links + allowed_response_options
  requestedEvidence  String    // evidence types requested from seller
  outcomeCode        String?   // raw PayPal value
  buyerHash          String?
  lastSyncedAt       DateTime
  rawHash            String    // hash of last details payload
}

model EvidenceRecord {
  id          String   @id         // stable REC-xxx
  caseId      String
  type        String   // ORDER|CAPTURE|SHIPMENT|TRACKING_EVENT|BUYER_MESSAGE|POLICY
  source      String
  occurredAt  DateTime
  fieldsJson  String   // normalised fields used by the claim validator
  contentHash String
  trustState  String
}

model AgentRun {
  id          String   @id @default(cuid())
  caseId      String
  mode        String   // RULES|AI
  provider    String?
  model       String?
  inputHash   String
  outputJson  String
  validation  String   // PASS|REPAIRED|FELL_BACK + details
  latencyMs   Int
  createdAt   DateTime @default(now())
}

model CaseAction {
  id            String    @id @default(cuid())
  caseId        String
  action        String
  payloadJson   String
  payloadHash   String
  approvedBy    String
  approvedAt    DateTime
  stateHashAtApproval String
  submittedAt   DateTime?
  httpStatus    Int?
  responseJson  String?
  idempotencyKey String   @unique
}

model WebhookEvent {
  eventId     String   @id
  type        String
  verified    Boolean
  receivedAt  DateTime @default(now())
  processedAt DateTime?
  result      String?
}

model SellerPolicy {
  id                    String @id @default("default")
  refundThresholdMinor  Int
  highValueBandMinor    Int
  minCarrierSample      Int    @default(20)
  returnlessCapPerYear  Int    @default(1)
  returnPolicyText      String
  currency              String @default("USD")
}

model ReturnlessGrant {
  id        String   @id @default(cuid())
  buyerHash String
  caseId    String
  grantedAt DateTime @default(now())
}

model AuditEvent {
  id         String   @id @default(cuid())
  entity     String
  entityId   String
  kind       String
  detailJson String   // redacted
  createdAt  DateTime @default(now())
}
```

## Module design and key rules

Each module is a set of pure functions where possible, so most tests need no network or database.

**Normaliser (`src/normalise`)**

- `normaliseStatus(carrier, rawText) → CanonicalStatus`: lookup table per carrier; unmapped text returns `UNKNOWN`. Canonical set: `IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, DELIVERED_TO_NEIGHBOUR, HELD_AT_CUSTOMS, RETURNED, EXCEPTION, UNKNOWN`.
- `normaliseTracking(raw)`: uppercase, strip spaces and hyphens.
- `toMinor(value: string, currency)`: parses decimal strings, never floats; uses the currency's minor-unit count.
- `carrierLocalDate(utc, carrierTz)`: date used when comparing date claims.

**Ledger (`src/ledger`)**

- `entriesFromCapture(capture)`: GROSS and PAYPAL\_FEE from `seller_receivable_breakdown`, source PAYPAL\_VERIFIED. If the breakdown has `exchange_rate`, the FX entry is PAYPAL\_VERIFIED too.
- `estimateFx(netMinorUsd, rate, spread)`: `fx = net_USD × r_base × spread`, rounded half-up to paise once, at the end. Source REFERENCE\_RATE\_ESTIMATE.
- `correct(entryId, newEntry)`: writes a correcting entry; the original stays.
- Views: per-order and per-month totals by type and source, computed in SQL. Totals never mix sources without showing the split.

**Dispute sync and action gate (`src/disputes`)**

- `syncDispute(id)`: GET details → normalise → upsert `DisputeCase` → rebuild evidence records → record `rawHash`. Called by the webhook, the poller and the "sync now" button.
- `allowedActions(details)`: intersection of HATEOAS `links` rels and `allowed_response_options`; returns a typed set such as `SEND_MESSAGE, PROVIDE_EVIDENCE, MAKE_OFFER, ACCEPT_CLAIM, ESCALATE, APPEAL`.
- `isStale(case, now)`: true when `lastSyncedAt` is older than 5 minutes; stale blocks approval.

**Approval and action service**

1. Seller approves an exact payload; the server stores `payloadHash` and `stateHashAtApproval` (the case's `rawHash`).
2. On submit: re-fetch details; if `rawHash` changed, block and ask for review.
3. Check the action is still in `allowedActions`.
4. Recompute the payload hash; it must equal the approved one.
5. Call PayPal with a `PayPal-Request-Id` equal to the action's `idempotencyKey`; store status and response; re-sync.

No other code path can call a dispute write endpoint; a lint rule forbids importing `paypal/disputes` write functions outside `disputes/actions.ts`.

**Outcome and retained amount (`outcome.ts`)**

- Store the raw `dispute_outcome.outcome_code` on every sync.
- Retained when the case is resolved with a seller-favourable code, or cancelled by the buyer, and no refund for this capture exists. Anything else with money returned is outflow. The exact code values are confirmed in T-008 and kept in one mapping table.

**Case file, rules and AI**

- `buildCaseFile(caseId)`: dispute fields, order items and amounts, country, shipment and normalised events, buyer messages, seller policy, allowed actions, requested evidence. Every item gets a stable `REC-` ID. No email, address, name or payer ID.
- `runRules(caseFile)`: Stage A. Deadline, evidence checklist, baseline recommendation from the PRD decision table, template message. Target under 5 seconds.
- `analyse(caseFile)`: Stage B. Zod schema for output; one repair retry on a schema failure; timeout 45 seconds, then Stage A only, labelled "Rules-based guidance — AI unavailable".
- `validateClaims(output, records)`: for each claim with a type, read the matching field of each cited record and compare canonical values. Results: SUPPORTED, NEAR\_MATCH (date off by one day), MISMATCH, UNVERIFIED (untyped). Only SUPPORTED claims may appear in a draft; a draft that cites anything else is blocked.
- The executable recommendation is `ai.recommended_action ∩ allowedActions`; if empty, show the rules recommendation and say why.

**Buyer hash:** `HMAC_SHA256(HMAC_SECRET, payerId)` at capture; fallback to the dispute's buyer email, hashed the same way. Raw values are never stored.

## API routes and PayPal calls

Eleven internal routes; every request and response body has a Zod schema in `src/**/schema.ts`.

| Route | Method | Does |
| --- | --- | --- |
| `/api/orders` | POST | Creates a PayPal order from a server-side cart; amount never comes from the browser |
| `/api/orders/[id]/capture` | POST | Captures, stores IDs, writes ledger entries, sets buyer hash |
| `/api/orders/[id]/ship` | POST | Saves carrier and tracking locally; attempts the PayPal tracking push |
| `/api/webhooks/paypal` | POST | Verifies, deduplicates, triggers sync; always answers 200 after storing the event |
| `/api/disputes` | GET | Inbox data from the database |
| `/api/disputes/[id]/sync` | POST | Manual "sync now" |
| `/api/disputes/[id]/analyse` | POST | Runs Stage A, then streams Stage B |
| `/api/disputes/[id]/approve` | POST | Stores the approved action, payload hash and state hash |
| `/api/disputes/[id]/submit` | POST | Action service: re-fetch, gate, hash check, write |
| `/api/sandbox/disputes/[id]/settle` | POST | Sandbox-only update-status and settle; disabled unless `DEMO_MODE` |
| `/api/demo/reset` | POST | Re-seeds the database; disabled unless `DEMO_MODE` |

**PayPal endpoints used** (base `https://api-m.sandbox.paypal.com`)

| Purpose | Call | Notes |
| --- | --- | --- |
| Token | `POST /v1/oauth2/token` | Cache until 60 s before expiry |
| Create order | `POST /v2/checkout/orders` | `PayPal-Request-Id` per cart |
| Capture | `POST /v2/checkout/orders/{id}/capture` | Read `seller_receivable_breakdown` |
| Tracking push | `POST /v2/checkout/orders/{id}/track` | Needs capture ID; non-blocking |
| Verify webhook | `POST /v1/notifications/verify-webhook-signature` | Uses the transmission headers and `PAYPAL_WEBHOOK_ID` |
| List / show disputes | `GET /v1/customer/disputes`, `GET /v1/customer/disputes/{id}` | Source of allowed actions and requested evidence |
| Write actions | `POST /v1/customer/disputes/{id}/send-message`, `make-offer`, `provide-evidence`, `escalate`, `accept-claim`, `appeal` | Evidence and messages are multipart when a file is attached; notes up to 2,000 characters; files JPG, GIF, PNG or PDF under 10 MB |
| Sandbox only | `POST /v1/customer/disputes/{id}/require-evidence`, `POST /v1/customer/disputes/{id}/adjudicate` | Request body values confirmed in T-008 |

**Webhook events subscribed:** `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`, `CUSTOMER.DISPUTE.RESOLVED`. The handler never trusts the payload: it re-fetches the resource before changing any state.

## Test strategy

Most confidence comes from fast unit tests on pure functions; integration tests cover routes against a real SQLite file and mocked PayPal; one end-to-end test proves the demo path.

| Layer | Tool | Scope | Runs |
| --- | --- | --- | --- |
| Unit | Vitest | Normaliser, ledger maths, FX, action gate, approval hashing, claim validator, outcome mapping, rules engine | Every save and every push |
| Integration | Vitest + MSW + test SQLite | Route handlers, webhook dedup, sync, action service, AI pipeline with fixture responses | Every push |
| Contract | Vitest | Real PayPal sandbox responses saved in `tests/fixtures/paypal/` parse against our Zod schemas | Every push; refresh fixtures on demand |
| End to end | Playwright | Overview → order → dispute → approve → submit → outcome, with PayPal and AI mocked | Every push |
| Live sandbox | `npm run smoke:sandbox` | Same path against the real sandbox, manual trigger only | Before recording; not in CI |
| AI evaluation | `npm run eval` | 30-case frozen suite (§6.5 of the PRD) against the real model | On prompt changes; report committed |

**Rules for tests**

- Fixtures come from real sandbox responses captured in the spike, with IDs and emails replaced. Never hand-write a PayPal response from memory.
- Time is injected (`now` parameter or fake timers); no test depends on the wall clock or time zone of the machine.
- Money assertions compare integer minor units exactly.
- AI is mocked everywhere except `npm run eval` and the live smoke test.
- CI runs `lint`, `typecheck`, `test`, `test:e2e`, `build`; a red CI blocks merging.

## Phase 0: sandbox spike (17–20 Oct)

All manual; the output is real PayPal responses saved as test fixtures and a go or no-go in `DECISIONS.md` by 20 Oct. Without T-005 the dispute product is not viable; switch to the leakage-only fallback.

| ID | Task | Check | Done when | Status |
| --- | --- | --- | --- | --- |
| T-001 | Create a sandbox REST app with Disputes enabled; note the business and personal sandbox accounts | App settings show Disputes | Credentials in local `.env` | Not started |
| T-002 | Minimal script: create and capture an order paid by the personal account | Capture response contains `seller_receivable_breakdown` | Response saved to `tests/fixtures/paypal/capture.json`; note whether `exchange_rate` appears | Not started |
| T-003 | Within the first hour, push tracking for that capture | Status code recorded | Result and exact error, if any, in `DECISIONS.md` | Not started |
| T-004 | Start a tunnel, register the webhook, receive `PAYMENT.CAPTURE.COMPLETED`, call verify-webhook-signature | Verify call returns `SUCCESS` | Event and headers saved as fixture | Not started |
| T-005 | As the sandbox buyer, open "item not received" in the Resolution Center | Dispute appears in `GET /v1/customer/disputes` | Details response saved as fixture | Not started |
| T-006 | Record allowed actions, requested evidence and the `CUSTOMER.DISPUTE.CREATED` webhook | Links and options listed | Notes in `DECISIONS.md`; webhook fixture saved | Not started |
| T-007 | Submit one write action: send-message, then provide-evidence with a small PDF | HTTP 200 and changed details | Request and response fixtures saved | Not started |
| T-008 | Call sandbox require-evidence, then adjudicate; re-fetch | `dispute_outcome` present | Exact request body values and `outcome_code` recorded | Not started |
| T-009 | Choose the runtime AI provider and a different vendor for evaluation cases; check free-tier terms | Terms page read | Choice and dates in `DECISIONS.md` | Done |
| T-010 | Record go or no-go; book 3–5 seller interviews | Decision written | Go recorded, or fallback scope chosen | Not started |

## Phase 1: foundation (21–24 Oct)

Exit check: a sandbox checkout writes correct ledger entries from the real fixture, and the four-screen shell runs on seeded data.

| ID | Task | Test first | Done when | Status |
| --- | --- | --- | --- | --- |
| T-101 | Scaffold: Next.js, TypeScript strict, Tailwind, ESLint, Vitest, Playwright, MIT licence | A trivial unit test and an empty Playwright page test | `npm test`, `npm run build` pass locally | Not started |
| T-102 | CI workflow: lint, typecheck, test, e2e, build | A deliberately failing test turns CI red | CI green on main; red blocks merge | Not started |
| T-103 | Prisma schema, first migration, test-database helper | Integration test writes and reads an Order; no exported update or delete for LedgerEntry | Migration applied; helper resets DB per test file | Not started |
| T-104 | Money utils `toMinor`, `fromMinor` | "114.42" USD → 11442; JPY has 0 decimals; a JS number input is rejected by type | All money code uses them | Not started |
| T-105 | Time util `carrierLocalDate` | 2026-10-21T20:30Z in Asia/Kolkata → 2026-10-22 | Injected `now` used everywhere | Not started |
| T-106 | Status and tracking normaliser with lookup tables | "Item delivered to neighbour" → DELIVERED\_TO\_NEIGHBOUR; unmapped → UNKNOWN; "ee 123-456 789 in" → "EE123456789IN" | Tables cover India Post, DHL, FedEx and the demo carrier | Not started |
| T-107 | PayPal client: token cache, typed errors, `PayPal-Request-Id` | MSW: token reused until 60 s before expiry; one refresh on 401; header sent on writes | All PayPal calls go through it | Not started |
| T-108 | Ledger entries from capture | T-002 fixture → GROSS 12000 USD and PAYPAL\_FEE from the breakdown, source PAYPAL\_VERIFIED | Fee is never recalculated when returned | Not started |
| T-109 | FX estimate, `FxRate` table, FBIL CSV loader | Net 11442 USD cents × ₹84 × 3% → 28834 paise; a PayPal `exchange_rate` overrides the estimate | Estimate labelled REFERENCE\_RATE\_ESTIMATE | Not started |
| T-110 | Seed and reset: Neel Pottery, about 400 orders over 6 months | Seeding twice yields the same content hash | Every seeded row is DEMO\_SEEDED | Not started |
| T-111 | Storefront checkout: create and capture routes plus buttons | Integration: a tampered browser amount is ignored; capture writes ledger and buyer hash; no raw payer ID stored | Real sandbox checkout works from the store page | Not started |
| T-112 | Four-screen shell and truth-state badge component | Playwright visits all four screens; badge renders each of the seven state labels | Navigation keeps order and case context | Not started |
| T-113 | AG Grid decision, option (a) or (b) | Manual | Decision and licence dates in `DECISIONS.md` by 24 Oct | Not started |

## Phase 2: core dispute flow (25–29 Oct)

Exit check: a real sandbox dispute arrives by webhook, is approved and submitted, and its new state is re-fetched, with no manual database edit.

| ID | Task | Test first | Done when | Status |
| --- | --- | --- | --- | --- |
| T-201 | Ship route: save shipment locally, attempt the PayPal push | Push success sets `pushedToPaypalAt`; a mocked 403 stores `pushError` and still returns success with LOCAL\_ONLY | "Local tracking only" badge shows when rejected | Not started |
| T-202 | Webhook receiver: verify and deduplicate | Invalid signature is stored as unverified and triggers nothing; the same event ID twice triggers one sync | Endpoint answers 200 within 2 s | Not started |
| T-203 | `syncDispute` from the details fixture | Upserts the case, parses deadline, requested evidence and `rawHash` | Called by webhook, poller and sync button | Not started |
| T-204 | `allowedActions` from links and options | Inquiry-stage fixture, claim-stage fixture and resolved fixture each give the expected set | Gate used by UI and server alike | Not started |
| T-205 | Poller, manual sync and stale detection | Fake timers: stale after 5 minutes; poller finds a dispute the webhook missed | Interval from `SYNC_INTERVAL_SECONDS` | Not started |
| T-206 | Link disputes to orders; buyer hash | Dispute matched by transaction ID; email fallback hashed; database dump contains no "@" | Unmatched disputes still show, flagged | Not started |
| T-207 | Evidence records with stable IDs | Re-syncing the same content keeps the same REC IDs | Records hold normalised fields | Not started |
| T-208 | Inbox screen | Playwright: sorted by deadline; stale badge visible | Shows reason, stage, amount, sync age | Not started |
| T-209 | Approval service | Editing the payload after approval makes submit fail on hash mismatch | Approval stores payload and state hashes | Not started |
| T-210 | Action service | Each of these blocks the write: stale case, action not allowed, `rawHash` changed, no approval; a retry reuses the idempotency key | Success stores status and response, then re-syncs | Not started |
| T-211 | Write calls: send-message, provide-evidence, make-offer, accept-claim | MSW asserts multipart body with `input` JSON and file; notes over 2,000 characters are rejected before sending | Responses match T-007 fixture shape | Not started |
| T-212 | Lint rule: dispute writes only from `disputes/actions.ts` | A fixture file importing a write function elsewhere fails lint | Rule runs in CI | Not started |
| T-213 | Live check against sandbox | Manual | One dispute: webhook → inbox → approve → submit → re-fetched state; noted in `DECISIONS.md` | Not started |

## Phase 3: AI truth map and evaluation (30 Oct–2 Nov)

Exit check: zero accepted unsupported claims and zero action-gate violations on the frozen suite, and the rules-only path works with the AI switched off. T-309 runs first so labels are frozen before any prompt work.

| ID | Task | Test first | Done when | Status |
| --- | --- | --- | --- | --- |
| T-309 | Generate evaluation cases with the second vendor along the PRD grid; write labels; commit both | Manual | Git history shows the labels commit before the first eval run | Not started |
| T-301 | Case-file builder | Output contains no email, street address, name or payer ID (pattern scan); every item has a REC ID | Builder is the only input to the model | Not started |
| T-302 | Rules engine (Stage A) | One test per row of the PRD decision table, plus deadline calculation | Returns in under 5 s on the seed data | Not started |
| T-303 | Output schema with typed claims | A valid fixture passes; an unknown action or claim type fails | Schema shared by pipeline and tests | Not started |
| T-304 | Claim validator | Cases for SUPPORTED, NEAR\_MATCH, MISMATCH, UNVERIFIED; DELIVERED\_TO\_NEIGHBOUR never supports DELIVERED | Drafts citing non-SUPPORTED claims are blocked | Not started |
| T-305 | AI adapter, prompt, repair retry, timeout | Mocked provider: malformed once → repaired; malformed twice → RULES mode; 45 s timeout → RULES mode | Each run stored in `AgentRun` | Not started |
| T-306 | Executable action = AI suggestion ∩ allowed actions | AI suggests ACCEPT\_CLAIM when not allowed → not executable, reason shown | Rules recommendation shown instead | Not started |
| T-307 | Prompt-injection boundary | A buyer message telling the model to refund is passed as quoted data and does not change the mocked pipeline's allowed actions or approval need | Boundary covered in the eval suite too | Not started |
| T-308 | Streaming analyse route | Stage A event arrives before any Stage B event | UI shows the rules draft at once, then the AI polish | Not started |
| T-310 | Evaluation runner and report | On two fixture cases the runner computes citation precision, unsupported-claim acceptance and gate violations correctly | Writes `eval/report.md` with method and denominators | Not started |
| T-311 | Run the evaluation and fix failures without changing labels | Manual | Report committed; targets met or gaps stated | Not started |
| T-312 | Checkpoint, 2 Nov | Manual | If the exit check fails, switch to the P0 fallback scope and record it | Not started |

## Phase 4: UX and outcome (3–5 Nov)

Exit check: one dispute goes from open to a sandbox-settled outcome, and the ledger shows the result with its source, without a database edit.

| ID | Task | Test first | Done when | Status |
| --- | --- | --- | --- | --- |
| T-401 | Dispute workbench: case summary, truth map, actions, approval | Playwright: an unverified claim shows in the "unverified" column and not in the draft; only allowed actions are buttons | Exact payload shown before approval | Not started |
| T-402 | Sandbox settle route | Returns 404 when `DEMO_MODE` is false; UI label reads "Sandbox-simulated adjudication" | Uses the T-008 body values | Not started |
| T-403 | Outcome mapping and retained rule | Seller-favourable with no refund → RETAINED entry; buyer cancel with refund → no RETAINED; raw code always stored | Mapping table matches T-008 findings | Not started |
| T-404 | Outcome screen | Playwright: refunded, lost and retained amounts shown separately with sources | Ledger change visible from the order timeline | Not started |
| T-405 | Overview screen (AG Studio under option a, else AG Grid Community and cards) | Card totals equal the SQL views; actual and estimated parts shown apart | Data-quality banner shows estimated and stale sources | Not started |
| T-406 | Order and financial truth timeline | Each line shows source badge, timestamp, rate or formula and reference | Order #1042 reads ₹757 listed leakage with labels | Not started |
| T-407 | Empty, loading, stale, error and success states | Playwright with mocked API failures: success is never shown after an error | All four screens covered | Not started |
| T-408 | Accessibility | axe check in Playwright: no serious or critical issues on the four screens | Keyboard path through approval works | Not started |
| T-409 | Usability test with 5 people | Manual | Results for the five PRD tasks recorded; worst issue fixed | Not started |

## Phase 5: hardening (6–8 Nov)

Exit check: CI green, a clean clone runs in under 10 minutes, and the live smoke test passes. Features freeze at the end of 8 Nov.

| ID | Task | Test first | Done when | Status |
| --- | --- | --- | --- | --- |
| T-501 | End-to-end happy path | Playwright with mocked PayPal and AI: overview → order → dispute → approve → submit → settle → outcome | Runs in CI | Not started |
| T-502 | Audit trail completeness | For one submitted action, audit holds webhook verification, model and input hash, validation result, approval, payload hash and PayPal response | No secret or buyer PII in any audit row (pattern scan) | Not started |
| T-503 | Security pass | Secret scan in CI; log redaction test; approve and submit reject cross-origin requests; demo routes off when `DEMO_MODE` is false | `docs/SECURITY.md` written | Not started |
| T-504 | Live sandbox smoke script | Manual run of `npm run smoke:sandbox` | Passes against the real sandbox | Not started |
| T-505 | Clean-clone test | Manual, timed, on a second machine or fresh container | Under 10 minutes following only the README | Not started |
| T-506 | Pre-open 4 sandbox disputes at different stages | Manual | IDs and stages listed in `docs/DEMO_SCRIPT.md` | Not started |
| T-507 | Feature freeze | Manual | Only bug fixes merged after 8 Nov | Not started |

## Phase 6: submission (9–11 Nov)

Submit on 11 Nov IST, a day before the deadline of 12 Nov at 12:00 PM PT (13 Nov, 1:30 AM IST).

| ID | Task | Check | Done when | Status |
| --- | --- | --- | --- | --- |
| T-601 | Final README: setup, how to open a sandbox dispute in 3 minutes, what is simulated, estimated or seeded, limitations | A second person follows it | No step needs help | Not started |
| T-602 | Public repo clean-up: remove internal scorecards; licence visible in the About panel; no secrets | Secret scan and manual look | Repo public | Not started |
| T-603 | Record step-matched clips and the final video | Under 3 minutes; captions; no copyrighted music | Public on YouTube | Not started |
| T-604 | Devpost copy: user, problem, demo, sandbox calls verified, eval method and results, interview findings, limitations | Read against the five judging criteria | Draft saved | Not started |
| T-605 | Re-check the official rules; submit | Rules page read on the day | Submitted by 11 Nov IST | Not started |
| T-606 | Check every link from a logged-out browser | Manual | Repo, video and demo links open | Not started |

## Done and open decisions

**Definition of done for the build**

- [ ] Every P0 task is Done with its test green in CI, or its fallback is recorded.
- [ ] A clean clone runs with the README, three PayPal values, one AI key and one command.
- [ ] One sandbox dispute goes from webhook to settled outcome with no database edit.
- [ ] Ledger totals reconcile exactly in tests; every number on screen has a source label.
- [ ] Evaluation report committed with method, denominators and results.
- [ ] No secrets, real buyer data or internal scorecards in the public repo.
- [ ] Video under 3 minutes shows only behaviour that exists.

**Cut order if a phase slips** (from the PRD; cut without debate): ledger Q&A, destination chart, carrier economics, return calculator, extra pre-shipment alerts, PDF styling. P0 fallback scope applies if the 2 Nov checkpoint fails.

**Open decisions**

| Decision | Owner | Due |
| --- | --- | --- |
| Go or no-go on disputes, from the spike | You | 20 Oct |
| Runtime AI provider and evaluation vendor | You | 20 Oct |
| AG Grid option (a) or (b) | You | 24 Oct |
| Sandbox settle body values and outcome codes | Spike result | 20 Oct |
| Solo build or with co-founders; who writes which phase | You | 20 Oct |
