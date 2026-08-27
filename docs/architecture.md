# RecoveryOS Architecture

This document describes the Phase 1 foundation, the Phase 2 payment event
ingestion pipeline, and the intended target architecture that later phases will
grow into.

## 1. System context (target state)

```
                    ┌────────────────────────┐
                    │  Payment providers     │
                    │  (Razorpay, …)         │
                    └───────────▲────────────┘
              webhooks/events   │ recovery actions (approved only)
                    ┌───────────┴────────────┐
                    │      RecoveryOS API    │
                    │  ingestion · risk · AI │
                    │  policy · orchestration│
                    │  verification · ledger │
                    └───────────┬────────────┘
                                │
                     ┌──────────▼──────────┐
                     │  PostgreSQL         │
                     │  events · decisions │
                     │  actions · ledger   │
                     └─────────────────────┘
                                ▲
                     ┌──────────┴──────────┐
                     │ Merchant Dashboard  │
                     │ (Next.js)           │
                     └─────────────────────┘
```

## 2. Why a separate API service

Phase 1 deliberately places the backend in its own Fastify process instead of
Next.js route handlers:

- Webhook ingestion (Phase 2+) must handle high volumes, signature verification,
  idempotency and retries without competing with UI rendering.
- Financial decision logic needs independent deployability, scaling and audits.
- The dashboard remains a thin presentation layer over explicit APIs.
- A future split into more services stays possible; a premature microservice
  split is avoided.

## 3. Current runtime topology

| Process | Port | Source |
| --- | --- | --- |
| API (`@recoveryos/api`) | 4000 | Fastify, compiled to `dist/`, pino logging |
| Web (`@recoveryos/web`) | 3000 | Next.js App Router, server components |
| PostgreSQL | 5432 | Docker Compose or native install |

The web Overview page calls `GET /health` and the opportunities read API
**server-side** through `apps/web/src/lib/api/*`. There are no browser→API
calls yet, so CORS is intentionally not enabled. When the dashboard later calls
the API from the browser, CORS will be added with an explicit allow-list —
never a wildcard.

## 4. API design conventions

- **Endpoints**: `GET /health` (liveness: process is up, no dependencies),
  `GET /ready` (readiness: verifies PostgreSQL with a timeout). Future resource
  endpoints (`/api/v1/events`, `/payments`, `/recovery`, `/decisions`,
  `/actions`, `/analytics`) will follow the same conventions.
- **Success envelope**: plain JSON payloads; every response carries an
  `x-request-id` header for correlation.
- **Error envelope**:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "requestId": "uuid",
    "details": { "issues": [{ "path": "name", "message": "Name is required." }] }
  }
}
```

- Status codes: 400 malformed request, 401 unauthorized (future), 404 unknown
  route/resource, 409 conflict, 422 validation, 500 generic internal error,
  503 dependency unavailable.
- Unknown errors are always masked as `INTERNAL_ERROR`; stack traces and driver
  messages stay in server logs only. Readiness failures never echo connection
  strings or error reasons in responses.

## 5. Layering rules (API)

```
routes → services → repositories → Prisma/PostgreSQL
            ↑ adapters (provider integrations)
              ↑ validates via Zod        ↑ maps rows → domain types
```

- Routes only parse HTTP and delegate; they never touch Prisma.
- Services own business rules and input validation (`parseWith(schema, input)`).
- Provider-specific logic (signature schemes, payload dialects) lives behind
  the `PaymentProviderAdapter` interface in `adapters/`, never inside routes.
- Repositories depend on narrow store interfaces (`PaymentEventStore`,
  `PaymentAccountLookupStore`, `RecoveryOpportunityStore`), not the full Prisma
  client — this keeps them unit-testable and ORM-swappable. The only
  Prisma-touched code is `repositories/prisma-stores.ts` and `lib/prisma.ts`.
- Deterministic engines (e.g. `detection/`) are pure functions with no I/O;
  persistence happens only in services/repositories.
- Domain types are plain TypeScript; persistence shapes do not leak outward.
- Configuration is parsed once at startup by Zod (`config/env.ts`) and fails
  fast on invalid values; nothing reads `process.env` ad hoc inside features.

## 5.1 Payment event ingestion (Phase 2)

```
Razorpay webhook
      │
      ▼
POST /webhooks/razorpay                routes/webhooks.ts
      │  raw-body capture (scoped content-type parser)
      ▼
HMAC-SHA256 signature verification     adapters/razorpay.ts (timing-safe)
      │  rejects invalid / modified / missing signatures → 422
      ▼
Payload validation                     envelope + payment entity structure
      │  malformed payloads → 422; unsupported events acknowledged → 200
      ▼
Event normalization                    provider-agnostic NormalizedPaymentEvent
      ▼
Account/merchant resolution            envelope account_id, else configured
      │                                test account; may stay unlinked
      ▼
Idempotent persistence                 PaymentEventRepository
      │  unique (provider, provider_event_id); P2002 races resolve to the
      │  existing row and report status "duplicate"
      ▼
Deterministic response                 201 new · 200 duplicate/unsupported
                                       422 invalid signature/payload · 400 bad JSON
```

Key decisions:

- **Raw body fidelity.** The exact request bytes are captured in a parser that
  Fastify scopes to the webhook plugin's encapsulation context, so JSON parsing
  behavior on every other route stays untouched.
- **Derived idempotency identity.** Razorpay webhooks do not carry a dedicated
  event id, so the adapter derives a stable one from the event type + provider
  payment id (`payment.captured:pay_123`). The database's composite unique
  index is the source of truth — no in-memory cache participates.
- **Amounts are preserved** in the provider's minor unit (paise) exactly as
  Razorpay sends them; normalization never converts currency values.
- **Audit first.** Each row keeps the raw payload verbatim plus a JSON-safe
  normalized projection (ISO timestamps), so events can be reprocessed by
  future phases without re-fetching from the provider.
- **Fail closed on missing config.** The webhook secret is optional at the env
  layer (preserving existing deployments/tests); ingestion returns a server
  error rather than processing unverified events when it is unset.

Supported events: `payment.authorized`, `payment.captured`,
`payment.failed`. Other Razorpay events are acknowledged with
`status: "unsupported"` and are not persisted.

## 5.2 Revenue leakage detection engine (Phase 3)

```
payment_events (persisted row)
      │
      ▼
RevenueLeakageService                  services/revenue-leakage.service.ts
      │  runs after every processed ingestion; detection failure never
      │  fails the webhook response
      ▼
Related-event correlation              PaymentEventStore.findRelatedByOrderOrPayment
      │  same payment/order id inside DETECTION_WINDOW_HOURS; ordered,
      │  window-bounded
      ▼
Deterministic rules                    detection/rules/*.rule.ts
      │  pure functions: (event, related, config) → finding | null
      │  • SubscriptionPaymentFailedRule  — failed + subscription_id present
      │  • FailedPaymentRule              — failed, no successful follow-up
      │  • CheckoutDropoffRule            — authorized, never captured/declined
      │    (expires after the window)
      │  Rules are mutually exclusive: exactly one category per event.
      ▼
Opportunity persistence                repositories/recovery-opportunity.repository.ts
      │  unique (source_event_id, type); P2002 races re-read the winning row;
      │  merchant/account attribution copied only from the source event
      ▼
Recovery resolution                    captured event correlated by payment/order id
                                         → OPEN opportunities become RECOVERED with
                                           recovery_event_id + resolvedAt recorded
```

Key decisions:

- **No LLMs anywhere in this path.** The engine is fully deterministic and
  auditable: a finding can always be traced back to stored rows.
- **Conservative by default.** A failure with any later capture for the same
  payment/order produces nothing; an authorization is only treated as drop-off
  when neither a capture nor an explicit decline exists in the window.
- **Never invent money.** Findings missing amount or currency are skipped, not
  estimated. Evidence JSON records the exact source values.
- **Idempotent replays.** Re-processing the same webhook yields `no-action`
  thanks to the `(source_event_id, type)` unique constraint.
- **Tenant isolation.** Attribution (`merchant_id`, `payment_account_id`) flows
  exclusively from the persisted source event; resolution lookups match on
  strict equality of those columns, so one merchant's capture can never close
  another merchant's opportunity.
- **Ingestion stays primary.** Detection runs post-ingestion inside a
  try/catch; a detection bug degrades to "no opportunities" rather than failing
  webhook deliveries.

Read surface: `GET /opportunities` (list+count), `GET /opportunities/overview`
(status/currency aggregates via SQL groupBy), `GET /opportunities/:id` (detail
with evidence + source-event summary). All honor an optional `merchantId`
filter; raw payloads and customer PII are never exposed.

## 5.3 Recovery decision engine (Phase 4)

```
RecoveryOpportunity (persisted)
      │
      ▼
Feature extraction                     decision/features.ts (pure)
      │  recoverableAmount · currency · opportunityAge · evaluatedAtMs ·
      │  observedFailedRetries (+ last retry time) from correlated FAILED
      │  events after the source event · failure category from evidence code ·
      │  historical outcome stats per opportunity type
      │  Unobserved data stays null — never fabricated.
      ▼
DeterministicDecisionEngine            decision/engine.ts (pure, version "v1")
      │  ┌ scoring: five fixed-weight factors → 0–100 score
      │  │   value(25) + recency(15) + recoverability(25)
      │  │   + retryHistory(15) + historicalSupport(20*)
      │  │   *historicalSupport requires ≥20 samples; else unavailable → 0
      │  ├ priority bands: <20 VERY_LOW · <40 LOW · <60 MEDIUM
      │  │                 <80 HIGH · ≥80 CRITICAL
      │  ├ confidence (0–100): evidence quality — mapped failure code,
      │  │   sample size, observed behavior. NOT a success probability.
      │  └ recommendation: ordered safety rules → RETRY | WAIT |
      │    CUSTOMER_ACTION_REQUIRED | DO_NOT_RETRY | REVIEW | NO_ACTION
      ▼
Failure classification                 decision/failure-category.ts (pure)
      │  provider error codes → TRANSIENT / INSUFFICIENT_FUNDS /
      │  AUTHENTICATION / HARD_DECLINE / UNKNOWN (unmapped stays UNKNOWN)
      ▼
Upsert persistence                     repositories/recovery-decision.repository.ts
      │  unique (opportunity_id, engine_version); merchant attribution copied
      │  only from the persisted opportunity; factors/reasons/riskFlags stored
      │  as JSON for audit and dashboard explainability
      ▼
Read APIs + dashboard                  routes/decisions.ts + recovery-cases UI
```

Key decisions:

- **Deterministic and auditable.** No randomness, no clock reads inside the
  engine (evaluation time is injected), identical input ⇒ identical output.
  Every stored decision explains itself via structured factors.
- **A heuristic model, not machine learning.** Weights are fixed, documented
  engineering choices; changing them requires bumping `engineVersion` so old
  decisions keep their original meaning. The interface (`DecisionEngine`
  shape: features in, result out) is deliberately model-ready for a future ML
  replacement (see §11).
- **Safety-first ordering.** `DO_NOT_RETRY` beats high scores; low confidence
  or unknown classification forces `REVIEW`; closed opportunities yield
  `NO_ACTION`. The system prefers admitting uncertainty over unsafe advice.
- **Honest history.** Outcome statistics below the minimum sample size are
  flagged `INSUFFICIENT_HISTORICAL_DATA` and excluded from scoring rather
  than producing invented recovery rates.
- **Lazy evaluation with staleness awareness.** First decision read evaluates
  and persists; if the opportunity changes afterwards (`updatedAt`), the next
  read transparently re-evaluates. No background workers in Phase 4.
- **Tenant isolation.** Decisions inherit merchant/account attribution only
  from their opportunity; overview aggregates scope strictly by merchantId.

## 5.4 AI-assisted recovery intelligence (Phase 5 — advisory)

```
Deterministic decision (authoritative)
      │  score · priority · confidence · recommendation · risk flags
      ▼
Minimized input construction           services/recovery-ai-advisor.service.ts
      │  opportunity type/amount/currency/status · failure category/code ·
      │  retry count · historical rate (or explicit null) · the full
      │  deterministic assessment as READ-ONLY context.
      │  Never sent: PII, payment instruments, raw payloads, secrets.
      ▼
AIRecoveryAdvisor (interface)          ai/providers/openai-compatible.ts
      │  any OpenAI-compatible chat-completions endpoint via a small typed
      │  fetch client; strict AbortSignal timeout; no SDKs; no retries.
      ▼
Model output validation                domain/recovery-ai-advice.ts (Zod)
      │  JSON-only contract; bounded strings; strictly numeric confidence
      │  0–100 (no coercions). Any failure ⇒ { status: 'invalid_response' }.
      ▼
Deterministic safety guard             ai/safety.ts (pure)
      │  detects contradictory retry suggestions vs DO_NOT_RETRY/NO_ACTION/
      │  NON_RECOVERABLE_CONDITION → appends warnings + safetyConstrained;
      │  annotates evidence gaps (missing failure code).
      ▼
Upsert persistence + reuse             recovery_ai_advice table
      │  unique (decision_id, advisor_version, model); SHA-256 decision-
      │  content fingerprint ⇒ cached advice reused while the deterministic
      │  decision is unchanged, regenerated when it changes.
      ▼
GET /opportunities/:id/ai-advice       { decision (always), ai }
      │  ai ∈ available | disabled | unavailable(reason) — reason codes are
      │  stable and safe to render: timeout · rate_limited · provider_error ·
      │  network_error · invalid_response · disabled.
```

Key decisions:

- **> AI is advisory and cannot override deterministic payment recovery safety decisions.**
  The advice schema structurally lacks score/priority/recommendation fields,
  so the model has nothing to override with; free-text contradictions are
  caught by the guard and surfaced as warnings, never as actions.
- **Optional enhancement.** With `AI_ENABLED=false` (default) no advisor is
  constructed at all. With it enabled, every failure mode (timeout, 429,
  provider 5xx, network, malformed JSON, schema violation, advisor crash)
  degrades to an explicit unavailable state — a decision is never lost and an
  API request never fails because of AI.
- **Provider-independent.** Only OpenAI-compatible HTTP semantics are spoken;
  hosted gateways and local compatible servers work without code changes.
- **Data minimization by construction.** The request object is built field by
  field (`buildRequestFrom`); serialization of whole rows is impossible.
- **Auditable.** provider, model, advisorVersion, promptVersion and a decision
  fingerprint persist with every advice row; raw model responses do not.

## 5.5 Controlled recovery execution & outcome tracking (Phase 6)

```
fresh deterministic decision (stale-aware, Phase 4 service)
      ↓
Safety gate (pure)                    execution/../domain safety rules
      │  action == RETRY (WAIT ⇒ scheduled PENDING only) · opportunity OPEN ·
      │  payment not already captured · confidence ≥ minimum · no blocking
      │  risk flag · attempts < limit · payment identifier present
      ├─ blocked ⇒ auditable BLOCKED record + 409 EXECUTION_BLOCKED
      ▼
Idempotent execution record           recovery_executions
      │  unique idempotency_key (opportunity+decision+action+attempt);
      │  in-flight/accepted executions replay on duplicate requests
      ▼
State machine (pure)                  execution/state-machine.ts
      │  PENDING→AUTHORIZED→EXECUTING→SUCCEEDED|FAILED
      │  PENDING→BLOCKED|CANCELLED · AUTHORIZED→CANCELLED
      ▼
Provider capability                   execution/providers/razorpay-retry.adapter.ts
      │  narrow retryPayment(...) — no generic execute(action); configurable
      │  gateway endpoint; unconfigured ⇒ deterministic not_configured;
      │  responses normalized to accepted/rejected/unavailable
      ▼
Outcome truth                         existing Phase 3 payment-event flow
         provider ACCEPTANCE ≠ recovery; opportunities become RECOVERED only
         when a captured payment event arrives through webhook ingestion
```

Key decisions:

- **Manual ≠ override.** `POST /opportunities/:id/execute` runs the identical
  fresh-decision → gate → execute pipeline as any future automation. Nothing
  can bypass DO_NOT_RETRY, retry limits, recovered state or staleness.
- **Acceptance ≠ recovery.** An execution's SUCCEEDED status means the provider
  accepted the retry REQUEST. The UI says "Recovery request submitted —
  awaiting payment outcome"; RECOVERED requires a real captured payment event.
- **Duplicate-proof by construction.** The database-unique idempotency key plus
  the in-flight/succeeded replay guard guarantee one provider operation per
  logical attempt even under concurrent duplicate requests.
- **Capability-scoped providers.** Only operations that pass the safety gate
  have an interface method, so unsafe future actions cannot slip through
  typing. Raw provider payloads and credentials never cross the boundary.

## 5.5.1 Recovery operations & automation (Phase 7)

```
RecoveryOperationScheduler.tick()      services/recovery-operation-scheduler.service.ts
  │
  ├─ A. stale handling   PENDING older than RECOVERY_OPERATION_MAX_AGE_HOURS
  │                      → CANCELLED(STALE_MAX_AGE) — audited, never deleted
  ├─ B. planning         OPEN opportunities with fresh RETRY/WAIT-eligible
  │     decisions and NO active execution ⇒ AUTOMATED PENDING records
  │     (unique idempotency keys; active-execution guard prevents duplicates)
  └─ C. execution        due PENDING rows → RecoveryExecutionService
                           .runScheduledExecution(id)
                            │  fresh stale-aware decision (Phase 4 service)
                            │  safety gate re-run (identical rules)
                            │  atomic ownership claim:
                            │    conditional update WHERE status='PENDING'
                            │  → provider via the shared attempt pipeline
  Retry policy (pure)    execution/retry-policy.ts
                         only PROVIDER_UNAVAILABLE-class failures retry;
                         delay = base × 2^(failedAttempt−1), capped at 6h;
                         attempts capped by RECOVERY_MAX_ATTEMPTS; each retry
                         is a NEW audited PENDING row scheduled in the future
  Reconciliation         describeReconciliation(execution, opportunity):
                         SUCCEEDED+RECOVERED ⇒ recovered · SUCCEEDED+OPEN ⇒
                         awaiting_payment_outcome · FAILED ⇒ failed …
```

Key decisions:

- **One pipeline.** Manual and automated execution share
  `RecoveryExecutionService`; the scheduler cannot diverge from operator
  behavior because it never touches the provider directly.
- **Ownership before side effects.** The PENDING→AUTHORIZED transition is a
  single conditional database update: duplicate ticks, dual processes and
  manual races converge to exactly one provider call per logical attempt.
- **Bounded and deterministic.** No randomness in backoff; absolute attempt
  caps; stale work is cancelled with an explicit reason code.
- **Replaceable runtime.** `runtime/recovery-automation.ts` is the only place
  a timer exists; external queues can drive `tick()` unchanged.

## 6. Logging & observability

Structured JSON logs via pino: ISO timestamps, level, `service:"recoveryos"`,
request correlation IDs on request/response/error lines, response times.
Redaction paths strip authorization headers, cookies and common secret field
names. Log levels are environment-driven; development uses pretty printing.
Future phases can attach metrics/tracing without changing call sites because all
logging flows through one factory (`lib/logger.ts`).

## 7. Security posture

- Secrets only via environment variables; `.env*` gitignored; no credentials in
  source or database (`PaymentAccount` stores provider metadata, never keys).
- Centralized safe error responses (no stacks, no internals in production).
- Zod validation at every future ingress point; strict schemas reject unknown keys.
- Security headers on both apps (API: nosniff/DENY/no-referrer/CSP/no-store;
  web: nosniff/DENY/referrer-policy/permissions-policy via `next.config.mjs`).
- Authentication via session cookies (Phase 8); public paths excluded;
  unauthenticated requests to protected paths rejected with 401.
- No wildcard CORS; credentialed CORS restricted to configured origin only.
- Razorpay API key secret never logged, persisted, or exposed to frontend;
  only used in Basic Auth header for Order API calls.

## 8. Data model evolution

Phase 1 shipped the identity foundations:

- `merchants(id uuid pk, name text, created_at, updated_at)`
- `payment_accounts(id uuid pk, merchant_id fk→merchants cascade, provider enum
  [razorpay], environment enum [test|production], status enum [active|inactive],
  display_name?, external_account_id?, created_at, updated_at)` with uniqueness on
  `(provider, environment, external_account_id)` to prepare idempotent provider
  account registration.

Phase 2 added `payment_events` (migration
`20260825133130_add_payment_events`): raw + normalized webhook event storage
with `signature_verified`, `processing_status` enum [pending|processed|
duplicate|unsupported|failed], attempt counters, failure reason, and optional
`SET NULL` relations to payment account and merchant. Uniqueness on
`(provider, provider_event_id)` enforces idempotent ingestion at the database.

Phase 3 added `recovery_opportunities` (migration
`20260825154107_add_recovery_opportunities`): type enum
[FAILED_PAYMENT|SUBSCRIPTION_PAYMENT_FAILED|CHECKOUT_DROPOFF], status enum
[OPEN|RECOVERED|EXPIRED|DISMISSED] (only OPEN→RECOVERED transitions today),
amount/currency copied from the source event in minor units, mandatory evidence
JSON, detected/expires/resolved timestamps, cascade FK to the source event,
`SET NULL` FK to the recovery event, and indexed merchant/account columns.
Uniqueness on `(source_event_id, type)` makes detection idempotent.

Phase 4 added `recovery_decisions` (migration
`20260825171037_add_recovery_decisions`): score (0–100), priority enum
[VERY_LOW|LOW|MEDIUM|HIGH|CRITICAL], confidence (0–100), recommended-action
enum [RETRY|WAIT|CUSTOMER_ACTION_REQUIRED|DO_NOT_RETRY|REVIEW|NO_ACTION],
reasons/factors/risk-flags JSON, engine version string, evaluated timestamp,
cascade FK to the opportunity, `SET NULL` merchant relation. Uniqueness on
`(opportunity_id, engine_version)` makes re-evaluation an upsert; indexes on
merchant/priority/action serve overview aggregates.

Phase 5 added `recovery_ai_advice` (migration
`20260826023019_add_recovery_ai_advice`): advisory AI output stored per
`(decision_id, advisor_version, model)` — summary/explanation/nextStep/
customerMessage/operatorMessage, model confidence (advisory metadata),
warnings JSON, `safetyConstrained`, decision-content SHA-256 fingerprint for
cache invalidation, provider/model/promptVersion stamps. Cascade FK to the
decision; raw provider responses are never persisted.

Phase 6 added `recovery_executions` (migration
`20260826032642_add_recovery_executions`): execution status enum [PENDING|
AUTHORIZED|EXECUTING|SUCCEEDED|FAILED|BLOCKED|CANCELLED] restricted by a pure
state machine, unique `idempotency_key`, attempt counter, normalized failure
code/reason, cascade FKs to opportunity and decision, `SET NULL` merchant,
indexes on opportunity/merchant/decision/status/createdAt.

Phase 7 extended `recovery_executions` with scheduling fields (migration
`20260826120833_add_execution_scheduling_fields`): `origin` (MANUAL/AUTOMATED),
`nextAttemptAt`, `scheduledAt`, and a composite `(status, next_attempt_at)`
index powering due-work discovery.

Phase 9-10 extended the execution flow with real Razorpay Order API integration
and frontend Checkout flow. The database schema remains unchanged — the
provider reference ID (order ID) is returned in the API response for Checkout
but not persisted in the execution record.

## 9. Testing strategy

Vitest, node environment, no live DB required for CI determinism:

- Config: acceptance of valid envs, rejection matrix for invalid ones.
- HTTP: fastify `inject()` against the real app factory with injected fakes.
- Readiness: success, failure, hang/timeout, response-leak prevention.
- Error handling: mapping table of error classes → status/envelope, production
  masking, framework errors (bad JSON, 404).
- Persistence boundary: repository/service behavior against typed mock stores.
- Ingestion: adapter unit tests (signatures, validation, normalization),
  repository idempotency tests (unique-violation resolution), and route tests
  against an in-memory store enforcing the same unique constraint as Postgres.
- Detection: rule-level tests (correlation suppression, missing-data skips,
  expiry math, mutual exclusivity), detector determinism, service-level
  opportunity creation/resolution with tenant isolation and replay idempotency,
  P2002 fallback in the repository, opportunities route filters/overview/detail
  contracts, and end-to-end webhook → detection → recovery flow tests.
- Decision engine: scoring bands and boundary values (0–100 clamp), priority
  band mapping at every boundary, score-vs-confidence separation, every
  failure category (including unmapped codes), retry count/recency behavior,
  safety routing for hard declines/auth/funding/unknown/closed cases,
  multi-run determinism, factor explainability, version stamping. Service:
  lazy evaluation, staleness re-evaluation, tenant attribution, historical
  statistics wiring. Repository: upsert semantics, per-version rows, overview
  aggregates. Routes: valid/missing/malformed ids, honest zero states,
  merchantId scoping, additive list summaries.
- Execution: safety-gate rule matrix, pure state-machine transitions,
  provider adapter normalization against stubbed fetch, service orchestration
  with a fake provider (single call per attempt, replays, disabled mode,
  stale refresh, blocked audit rows, limits, tenant attribution), repository
  idempotency/counting and route contracts (201/200/409/503).
- Operations automation: scheduler tick phases (stale cancel, planning
  idempotence, due execution through the shared pipeline with exactly one
  provider call), bounded deterministic retry scheduling, reconciliation
  status derivation, operations API contracts incl. merchant scoping.
- Web: pure formatting logic (`formatInr`, `formatMinorAmount`, `formatPercent`).

Integration-style tests against a live PostgreSQL run naturally during local
verification (`/ready` checks); dedicated DB-backed test suites arrive with the
first data-bearing phase.

## 10. Extension map (phases → touch points)

| Phase | New capability | Where it plugs in |
| --- | --- | --- |
| 2 ✅ | Razorpay webhooks | `routes/webhooks.ts` + `adapters/razorpay.ts` + `PaymentEventRepository` |
| 3 ✅ | Revenue leakage detection | `detection/` rules + detector, `services/revenue-leakage.service.ts`, `RecoveryOpportunityRepository`, `routes/opportunities.ts` |
| 4 ✅ | Decision engine | `decision/` engine + features + failure categories, `services/recovery-decision.service.ts`, `RecoveryDecisionRepository`, `routes/decisions.ts` |
| 5 ✅ | AI advisory intelligence | `ai/` prompt + safety guard + OpenAI-compatible provider, `services/recovery-ai-advisor.service.ts`, `recovery_ai_advice` store, `/opportunities/:id/ai-advice` |
| 6 ✅ | Controlled execution | `domain/recovery-execution.ts`, `execution/` safety + state machine + Razorpay retry adapter, `services/recovery-execution.service.ts`, `routes/executions.ts`, `recovery_executions` table |
| 7 ✅ | Operations & automation | `services/recovery-operation-scheduler.service.ts`, `/operations/*`, runtime timer |
| 8 ✅ | Authentication | `plugins/authentication.ts`, session cookies, tenant isolation |
| 9 ✅ | Real Razorpay integration | `execution/providers/razorpay-retry.adapter.ts` (real API), Basic Auth, order creation |
| 10 ✅ | Demo-ready customer flow | Frontend Checkout integration, Checkout-safe response data |
| 11 | Outcome verification | consumes orchestrator results, writes ledger candidates |
| 12 | Recovery ledger | append-only table + read APIs |
| 13 | Synthetic data + simulation | `services/simulation` reusing event normalization |
| 14 | Adaptive memory | evolves merchant memory schemas/consumers |
| 15–17 | Modules, voice, full dashboard | new route modules + dashboard sections |

## 11. Future ML extension point (documented, not implemented)

Phase 4 ships only the `DeterministicDecisionEngine`. The seam for a future
model is deliberately clean:

```
Historical payment data (payment_events, opportunities, decisions, outcomes)
      ↓
Feature engineering        ← decision/features.ts already isolates this step
      ↓
Model training / evaluation          (future phase — NOT in this repo today)
      ↓
Calibrated recovery probability
      ↓
MLDecisionEngine implements the same evaluate(features) → result contract
      ↓
Safety layer unchanged: risk flags, REVIEW-on-low-confidence and the
recommendation rule order remain deterministic guardrails around any model
```

Requirements when that phase lands: version every model (`engineVersion`),
keep the deterministic engine as fallback/fail-closed path, never let a model
output bypass the safety rules, and store per-decision model metadata for
audit. No external AI API is called anywhere in the current codebase.

The foundation's stable seams — validated config, structured logging, central
error handling, repository boundaries, health/readiness — are intended to remain
unchanged while these phases land.
