# RecoveryOS

**AI-powered revenue recovery intelligence for modern payment operations.**

RecoveryOS sits beside payment infrastructure such as Razorpay to help merchants
understand where revenue is leaking, decide how to recover it safely, execute
approved recovery actions, verify outcomes, and measure the revenue actually
recovered.

> **Status: Phase 4 — Intelligent recovery decision engine (deterministic, no AI APIs).**
> RecoveryOS ingests Razorpay payment events, detects revenue leakage, and now
> scores every opportunity with a transparent decision engine: priority,
> confidence and a recommended next step — each fully explainable. It does
> **not use any LLM or paid AI API**, does **not execute any recovery actions**,
> and never invents monetary figures — every amount derives from stored payment
> events in the provider's minor units.

---

## 1. The problem RecoveryOS will solve

Payment platforms lose significant revenue to failed payments, expired mandates,
abandoned checkouts and unmanaged retries. Today most merchants handle this with
manual follow-ups or blunt retry loops. RecoveryOS is being built to provide:

- **Visibility** – a single view of revenue at risk across providers.
- **Intelligence** – AI-recommended recovery strategies grounded in merchant history.
- **Safety** – deterministic policy enforcement before any action runs.
- **Execution** – orchestrated recovery actions (retries, payment links, voice).
- **Verification & measurement** – verified outcomes and true recovered-revenue reporting.

## 2. Current phase scope (Phase 1–4)

Phase 1 delivered the application foundation:

| Area | Delivered |
| --- | --- |
| Web app | Next.js (App Router) dashboard shell with empty-state Overview |
| Backend | Fastify API with `/health` and `/ready` endpoints |
| Database | PostgreSQL + Prisma (`Merchant`, `PaymentAccount` models) |
| Config | Zod-validated environment configuration, fail-fast on startup |
| Logging | Structured JSON logging (pino) with request IDs and secret redaction |
| Errors | Centralized error handler with a consistent, safe error envelope |
| Validation | Zod schema validation utilities ready for future endpoints |
| Testing | Vitest unit/integration tests for all infrastructure layers |
| Quality | ESLint (type-aware), TypeScript strict mode, Prettier |
| Infra | Docker Compose for PostgreSQL (optional), local Postgres supported |

Phase 2 adds reliable payment event ingestion:

| Area | Delivered |
| --- | --- |
| Webhook endpoint | `POST /webhooks/razorpay` with raw-body HMAC-SHA256 verification |
| Provider adapter | `RazorpayAdapter` behind a generic `PaymentProviderAdapter` interface |
| Normalization | Razorpay payloads normalized into a provider-agnostic shape |
| Persistence | `PaymentEvent` model retaining raw payload + normalized data for audit |
| Idempotency | Unique `(provider, provider_event_id)` constraint; duplicates return 200 |

Phase 3 adds the deterministic revenue leakage detection engine (no LLMs):

| Area | Delivered |
| --- | --- |
| Detection rules | `FailedPaymentRule`, `SubscriptionPaymentFailedRule`, `CheckoutDropoffRule` — pure, side-effect-free, mutually exclusive per event |
| Correlation | Failed/authorized payments are checked against related captured/failed events inside a configurable window (`DETECTION_WINDOW_HOURS`) before an opportunity is created — a successful retry suppresses the finding |
| Opportunities | `RecoveryOpportunity` model with `OPEN → RECOVERED` lifecycle, evidence JSON, expiry for drop-offs |
| Idempotency | Unique `(source_event_id, type)` constraint; concurrent detections resolve to one row |
| Tenant isolation | Merchant/account attribution copied **only** from the stored source event |
| Resolution | A captured payment correlated by payment/order id marks open opportunities `RECOVERED` with the recovery event recorded — never fabricated |
| Read API | `GET /opportunities`, `GET /opportunities/overview`, `GET /opportunities/:id` (merchantId-scoped) |
| Dashboard | Recovery Cases page + Overview stat cards now render real detected data |

Phase 4 adds the deterministic, explainable recovery decision engine (still no
LLMs — this is a heuristic model, not machine learning):

| Area | Delivered |
| --- | --- |
| Decision engine | `decision/` pure engine (`v1`): transparent weighted factors → 0–100 score, five priority bands, separate 0–100 confidence, ordered safety rules → one of six controlled recommendations |
| Failure classification | Deterministic mapping of provider failure codes to TRANSIENT / INSUFFICIENT_FUNDS / AUTHENTICATION / HARD_DECLINE / UNKNOWN; unmapped codes stay unknown and lower confidence instead of being guessed |
| Explainability | Every decision stores structured factors (name, contribution, value, explanation), human-readable reasons and risk flags with per-flag explanations |
| Safety-first | Hard declines → `DO_NOT_RETRY`; auth/funding failures → `CUSTOMER_ACTION_REQUIRED`; weak or conflicting evidence → `REVIEW`; closed opportunities → `NO_ACTION`. Phase 4 never executes payments or retries |
| Persistence | `recovery_decisions` table: one row per (opportunity, engine version), upserted on re-evaluation; merchant attribution copied only from the opportunity |
| Historical context | Outcome statistics per opportunity type feed the score only above a minimum sample size (20) — smaller samples are flagged `INSUFFICIENT_HISTORICAL_DATA` rather than producing invented rates |
| Read API | `GET /opportunities/:id/decision` (lazy first evaluation + staleness-aware re-evaluation) and `GET /decisions/overview` metrics; the opportunities list now carries an additive `decision` summary |
| Dashboard | Recovery Cases rows show priority/score/confidence/recommendation; new case detail page explains WHY (score breakdown, factors table, risks, engine version) |

Explicitly **not** implemented yet: AI/LLM decisions, recovery orchestration,
automated retries or payment actions, customer messaging, analytics beyond the
read APIs, synthetic data, simulation, policies, outcome-verification workflows,
ledger, merchant memory, voice recovery, authentication.

## 3. Architecture

Monorepo managed with npm workspaces:

```
apps/
  api   → RecoveryOS API service (Fastify + Prisma + pino + Zod)
  web   → Merchant dashboard shell (Next.js App Router + Tailwind CSS)
```

Key architectural decision: the backend is a **separate service** rather than
Next.js route handlers. Future phases must ingest high-volume payment webhooks,
run long-lived processing, and keep financial logic independent of UI deploys —
a dedicated process keeps those concerns decoupled from the frontend from day one.

Layering inside the API:

```
routes/        HTTP surface (health, readiness, Razorpay webhook, opportunities, decisions)
services/      business rules + input validation orchestration
detection/     deterministic leakage rules + detector (Phase 3, pure functions)
decision/      deterministic recovery decision engine (Phase 4, pure functions)
adapters/      provider integrations (Razorpay signature/normalization)
repositories/  persistence boundaries (no Prisma types leak upward)
domain/        core types + store interfaces (Merchant, PaymentEvent, RecoveryOpportunity, RecoveryDecision, …)
lib/           logger, database contracts, error model, prisma client
plugins/       centralized error handling, security headers
config/        validated environment configuration
```

The frontend never touches Prisma or SQL. It talks to the API through an explicit
client module (`apps/web/src/lib/api/*`) executed in server components. See
[docs/architecture.md](docs/architecture.md) for how later phases slot in.

## 4. Technology stack

- **TypeScript** (strict mode) everywhere
- **Next.js 16** · React 19 · Tailwind CSS 4 (web)
- **Fastify 5** · pino · Zod (API)
- **PostgreSQL 14+** · **Prisma 6** ORM
- **Vitest** testing · **ESLint 9** + typescript-eslint · Prettier
- **Docker Compose** (optional) for local PostgreSQL

## 5. Local setup

Prerequisites: Node.js ≥ 20 (developed on 22), npm 10+, and either Docker or a
local PostgreSQL installation.

```bash
git clone <repo-url> recoveryos && cd recoveryos
npm install          # installs all workspaces, generates the Prisma client
npm run setup        # creates apps/api/.env and apps/web/.env.local from .env.example
```

## 6. Environment variables

`.env.example` is the canonical reference. `npm run setup` copies it into place;
edit the generated files per environment. Never commit real `.env` files.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NODE_ENV` | API | `development` / `test` / `production` runtime mode |
| `DATABASE_URL` | API | PostgreSQL connection string used by Prisma |
| `API_HOST` | API | Interface the API binds to |
| `API_PORT` | API | Port the API listens on (default 4000) |
| `LOG_LEVEL` | API | pino level: `fatal`…`trace` (+`silent`) |
| `RAZORPAY_WEBHOOK_SECRET` | API | Secret used to verify `X-Razorpay-Signature` (optional at config level; the webhook endpoint fails closed when unset) |
| `DEFAULT_TEST_PAYMENT_ACCOUNT_ID` | API | Optional PaymentAccount UUID used to link local/test webhooks that carry no recognizable provider account id |
| `DETECTION_WINDOW_HOURS` | API | Correlation window (1–720, default 24) used when deciding whether a failure was later recovered or an authorization expired |
| `NEXT_PUBLIC_APP_URL` | Web | Public URL of the dashboard |
| `NEXT_PUBLIC_API_URL` | Web | Base URL of the API, called server-side for health |

The credentials shipped in `.env.example` are **local development defaults only**.

## 7. Database setup

Option A – Docker Compose:

```bash
npm run db:up                 # starts postgres:16 on localhost:5432
```

Option B – native PostgreSQL (e.g. Homebrew):

```bash
psql -d postgres -c "CREATE ROLE recoveryos LOGIN PASSWORD 'recoveryos_dev' CREATEDB;"
psql -d postgres -c "CREATE DATABASE recoveryos OWNER recoveryos;"
```

(`CREATEDB` is required by `prisma migrate dev` shadow databases.)

Then apply migrations:

```bash
npm run db:migrate:dev        # development: create/apply migrations
npm run db:migrate:deploy     # CI/production: apply committed migrations only
```

Phase 1 schema: `merchants` (id, name, createdAt, updatedAt) and
`payment_accounts` (merchant relation, provider enum incl. `razorpay`,
environment `test|production`, status `active|inactive`, optional display name and
external account id — **no credentials or secrets are ever stored**).

Phase 2 adds `payment_events`: one row per ingested webhook event with the raw
payload (`jsonb`), a JSON-safe normalized projection, signature-verification
state, processing status/attempts/timestamps and optional links to the resolved
payment account + merchant. Idempotency is enforced by a unique index on
`(provider, provider_event_id)` — Razorpay payloads carry no dedicated event id,
so the adapter derives a stable identity from the event type and payment id
(e.g. `payment.captured:pay_123`). Amounts are stored in the provider's minor
unit (paise), exactly as Razorpay sends them.

Phase 3 adds `recovery_opportunities`: one row per detected revenue leakage with
type (`FAILED_PAYMENT`, `SUBSCRIPTION_PAYMENT_FAILED`, `CHECKOUT_DROPOFF`),
status (`OPEN`, `RECOVERED`, `EXPIRED`, `DISMISSED` — only transitions
`OPEN → RECOVERED` today), amount at risk + currency copied from the source
event, mandatory evidence JSON, detection/expiry/resolution timestamps and links
to the source event (cascade) plus the recovery event that realized the revenue
again. Idempotency: unique `(source_event_id, type)`; tenant scoping via indexed
`merchant_id` / `payment_account_id` columns.

Phase 4 adds `recovery_decisions` (migration
`20260825171037_add_recovery_decisions`): one row per (opportunity, engine
version) storing score, priority enum, confidence, recommended-action enum,
reasons/factors/risk-flags JSON, evaluated timestamp and a `SET NULL` merchant
relation plus cascade FK to the opportunity. Uniqueness on
`(opportunity_id, engine_version)` makes re-evaluation an upsert; indexes on
merchant/priority/action power the overview aggregates.

## 8. Running the application

```bash
npm run dev        # API on http://localhost:4000 + dashboard on http://localhost:3000
npm run dev:api    # API only
npm run dev:web    # dashboard only
```

Production-style run:

```bash
npm run build
npm run start:api  # serves compiled dist/index.js
npm run start:web  # serves the Next.js production build
```

Verify:

```bash
curl http://localhost:4000/health   # liveness → {"status":"ok","service":"recoveryos",...}
curl http://localhost:4000/ready    # readiness → 200 when DB is reachable, 503 otherwise
open http://localhost:3000          # dashboard shell
```

## 8.1 Webhook endpoint (Phase 2)

```text
POST /webhooks/razorpay
```

| Scenario | Response |
| --- | --- |
| Valid, previously unseen event | `201` + `{received, eventId, status: "processed", …}` |
| Redelivery of the same event | `200` + `status: "duplicate"` (no second row) |
| Supported but not-yet-handled Razorpay event | `200` + `status: "unsupported"` |
| Invalid / modified / missing signature | `422` validation envelope |
| Malformed payload (missing event/payment entity) | `422` validation envelope |
| Empty body | `422` validation envelope |
| Malformed JSON | `400` client error envelope |

Signature verification uses HMAC-SHA256 over the **exact raw request bytes**
(captured before JSON parsing) compared timing-safely against
`X-Razorpay-Signature`. Supported events today: `payment.authorized`,
`payment.captured`, `payment.failed`. Unsupported events are acknowledged
(`200`) without being persisted.

Local testing against a running API:

```bash
node scripts/test-webhook.mjs payment.captured     # or payment.authorized/failed
node scripts/test-webhook.mjs duplicate            # 201 → 200 idempotent replay
node scripts/test-webhook.mjs invalid-signature    # expect 422
node scripts/test-webhook.mjs modified-payload     # expect 422
node scripts/test-webhook.mjs unsupported          # expect 200
node scripts/test-webhook.mjs malformed            # expect 422
```

The script derives its secret from `RAZORPAY_WEBHOOK_SECRET`
(default `test_webhook_secret_123`) and targets `WEBHOOK_URL` or
`http://localhost:4000/webhooks/razorpay`.

## 8.2 Detection pipeline & opportunities API (Phase 3)

After every ingested event the API runs the deterministic detection engine:

| Incoming event | Engine behavior |
| --- | --- |
| `payment.failed` | Creates a `FAILED_PAYMENT` opportunity **unless** a captured payment for the same payment/order id already exists in the window |
| `payment.failed` with `subscription_id` | Same check, categorized as `SUBSCRIPTION_PAYMENT_FAILED` instead |
| `payment.authorized` never followed by capture/decline | Conservative `CHECKOUT_DROPOFF` opportunity that expires after `DETECTION_WINDOW_HOURS` |
| `payment.captured` correlated to an open opportunity by payment/order id | Opportunity transitions to `RECOVERED` with the capture recorded as `recovery_event_id` |

Detection failures never fail webhook ingestion — they are logged and skipped.
Rules are pure functions: identical input always yields identical output.

Read API:

```text
GET /opportunities?merchantId=&status=&type=&from=&to=   → { opportunities, total }
GET /opportunities/overview?merchantId=                  → { openOpportunities, failedPayments, currencies[] }
GET /opportunities/:id                                   → full detail incl. evidence + source-event summary
```

All queries honor the optional `merchantId` filter so responses never cross
tenant boundaries. Raw webhook payloads and customer PII are never exposed —
only detection evidence and non-sensitive source-event fields. Currency amounts
are always returned in minor units and broken down per currency; currencies are
never mixed into a single number.

Local smoke test of the full flow:

```bash
node scripts/test-webhook.mjs payment.failed      # creates an OPEN opportunity
node scripts/test-webhook.mjs                     # then:
curl 'http://localhost:4000/opportunities'         # inspect detected cases
curl 'http://localhost:4000/opportunities/overview'
```

## 8.3 Decision engine & decisions API (Phase 4)

Every recovery opportunity can be assessed by the deterministic decision
engine (version `v1`). Scoring uses five transparent weighted factors
(fixed weights, sum = 100):

| Factor | Max points | Basis |
| --- | --- | --- |
| Financial value | 25 | Banded recoverable amount (minor units) |
| Recency | 15 | Time since detection (explicitly injected evaluation time — no clock reads inside the engine) |
| Failure recoverability | 25 | Deterministic failure-code category (transient full marks; hard declines zero + risk flag) |
| Retry history | 15 | Observed failed retries correlated from stored payment events |
| Historical outcomes | 20 | Recovery rate for the opportunity type — **only with ≥ 20 historical samples**; otherwise unavailable and scored 0 |

Priority bands: `0–19 VERY_LOW · 20–39 LOW · 40–59 MEDIUM · 60–79 HIGH ·
80–100 CRITICAL`.

Confidence is a separate 0–100 measure of evidence quality behind the
recommendation — **not** a success probability. It grows with a mapped failure
code, sufficient historical samples and observed retry behavior.

Recommendations come from ordered safety rules: hard decline → `DO_NOT_RETRY`;
authentication/funding failures → `CUSTOMER_ACTION_REQUIRED`; ≥2 failed retries
with a very recent attempt → `WAIT`; low confidence or unknown failure class →
`REVIEW`; ≥4 failed attempts → `REVIEW`; closed opportunities → `NO_ACTION`;
otherwise → `RETRY`. When evidence is insufficient the engine always prefers
`REVIEW` over an unsafe automated recommendation.

Read API:

```text
GET /opportunities/:id/decision   → { score, priority, confidence, recommendedAction,
                                      reasons[], factors[], riskFlags[], engineVersion,
                                      evaluatedAt }
GET /decisions/overview           → { criticalOpportunities, highPriorityOpportunities,
                                      recommendedRetries, reviewRequired, doNotRetry,
                                      averageConfidence|null, engineVersion }
```

- The first read lazily evaluates and persists; re-reads return the stored
  decision unless the opportunity changed afterwards (staleness via
  `updatedAt`), in which case it is transparently re-evaluated.
- `GET /opportunities` items now include an additive `decision` summary
  (score/priority/confidence/action) when available — existing fields are
  unchanged.
- Overview metrics honor the optional `merchantId` filter so counts never
  cross tenant boundaries.

## 9. Tests

```bash
npm test            # all workspaces
npm run test --workspace @recoveryos/api        # watch mode: add :watch
```

Covered: env config validation (incl. optional webhook-secret conventions and
`DETECTION_WINDOW_HOURS` bounds), `/health`, `/ready` (up, down, timeout,
no-leak), centralized error handling (unknown errors, AppErrors, thrown
ZodErrors, 404s, malformed JSON, production hardening), database connectivity
checks, repository + service behavior with mocked persistence, web formatting
utilities — Phase 2 ingestion: Razorpay signature verification, payload
validation/normalization, repository idempotency (P2002 → duplicate resolution),
and webhook route status codes (`201` new, `200` duplicate/unsupported, `422`
signature/payload/empty-body, `400` malformed JSON) exercised against an
in-memory store that enforces the same uniqueness as PostgreSQL — and Phase 3
detection: rule-level suppression/correlation/expiry behavior, detector
determinism and mutual exclusivity, opportunity creation/resolution with tenant
isolation and idempotent replays, P2002 fallback in the opportunity repository,
opportunities route filters/overview/detail responses, the end-to-end
webhook → detection → recovery flow through the real Fastify app — and Phase 4
decisions: engine scoring bands and boundary values, priority mapping,
score-vs-confidence separation, every failure category, retry recency/count
behavior, safety routing (DO_NOT_RETRY / CUSTOMER_ACTION_REQUIRED / REVIEW /
NO_ACTION), determinism, factor explainability, version stamping, service
orchestration (lazy evaluation, staleness re-evaluation, tenant attribution),
repository upsert semantics, decision route contracts (valid/missing/invalid
UUID/overview scoping) and additive list summaries.

## 10. Lint

```bash
npm run lint
```

Type-aware ESLint via typescript-eslint; Next.js rules on the web workspace.
Two narrow, documented exceptions: `require-await` is disabled for Fastify plugin/
route wrappers and test mocks (frameworks mandate the shapes); `unbound-method`
is disabled in tests (vi.fn store mocks).

## 11. Type checking

```bash
npm run typecheck
```

Strict mode plus `noUncheckedIndexedAccess`, `verbatimModuleSyntax` (API).

## 12. Production build

```bash
npm run build       # compiles API to dist/ and builds the Next.js app
```

## 13. What is NOT implemented yet

No AI/LLM usage of any kind (the decision engine is a deterministic heuristic
model, not machine learning), no recovery execution of any kind — no payment
retries, links, charges or customer messaging — no voice recovery, no merchant
memory, no anomaly detection, no synthetic transactions or simulation, no
analytics beyond the read APIs, no authentication, and no active recovery —
`RECOVERED` status reflects only a customer-initiated successful retry observed
in the event stream, never an action RecoveryOS took.

## 14. Planned future phases

~~Phase 2 Razorpay integration + webhook ingestion~~ (delivered) · ~~Phase 3
revenue leakage detection~~ (delivered) · ~~Phase 4 deterministic decision
engine~~ (delivered) · Phase 5 synthetic data + simulation + replay · Phase 6
recovery intelligence/context/pattern engines + merchant memory · Phase 7 AI
decision agent behind the existing engine interface (ML model trained on
accumulated outcomes may replace or augment `DeterministicDecisionEngine`;
the interface and feature extraction are already model-ready) · Phase 8
policy/safety engine · Phase 9 recovery action orchestrator · Phase 10 outcome
verification · Phase 11 recovery ledger · Phase 12 adaptive merchant memory ·
Phase 13 recovery modules · Phase 14 Hinglish voice recovery · Phase 15 full
merchant dashboard. Details: [docs/architecture.md](docs/architecture.md).
