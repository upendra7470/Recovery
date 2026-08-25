# RecoveryOS Architecture

This document describes the Phase 1 foundation and the intended target
architecture that later phases will grow into. Nothing described as "future" is
implemented yet.

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

The web Overview page calls `GET /health` **server-side** through
`apps/web/src/lib/api/status.ts`. There are no browser→API calls in Phase 1, so
CORS is intentionally not enabled. When the dashboard later calls the API from
the browser, CORS will be added with an explicit allow-list — never a wildcard.

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
          ↑ validates via Zod        ↑ maps rows → domain types
```

- Routes only parse HTTP and delegate; they never touch Prisma.
- Services own business rules and input validation (`parseWith(schema, input)`).
- Repositories depend on narrow store interfaces (`MerchantStore`), not the full
  Prisma client — this keeps them unit-testable and ORM-swappable.
- Domain types are plain TypeScript; persistence shapes do not leak outward.
- Configuration is parsed once at startup by Zod (`config/env.ts`) and fails
  fast on invalid values; nothing reads `process.env` ad hoc inside features.

## 6. Logging & observability

Structured JSON logs via pino: ISO timestamps, level, `service:"recoveryos"`,
request correlation IDs on request/response/error lines, response times.
Redaction paths strip authorization headers, cookies and common secret field
names. Log levels are environment-driven; development uses pretty printing.
Future phases can attach metrics/tracing without changing call sites because all
logging flows through one factory (`lib/logger.ts`).

## 7. Security posture (Phase 1)

- Secrets only via environment variables; `.env*` gitignored; no credentials in
  source or database (`PaymentAccount` stores provider metadata, never keys).
- Centralized safe error responses (no stacks, no internals in production).
- Zod validation at every future ingress point; strict schemas reject unknown keys.
- Security headers on both apps (API: nosniff/DENY/no-referrer/CSP/no-store;
  web: nosniff/DENY/referrer-policy/permissions-policy via `next.config.mjs`).
- No authentication yet — documented gap, planned before any multi-tenant or
  hosted use. The dashboard is local-development-only until then.
- No wildcard CORS.

## 8. Data model evolution

Phase 1 ships only identity foundations:

- `merchants(id uuid pk, name text, created_at, updated_at)`
- `payment_accounts(id uuid pk, merchant_id fk→merchants cascade, provider enum
  [razorpay], environment enum [test|production], status enum [active|inactive],
  display_name?, external_account_id?, created_at, updated_at)` with uniqueness on
  `(provider, environment, external_account_id)` to prepare idempotent provider
  account registration.

Later phases will add (non-exhaustive): raw + normalized event tables with
idempotency keys (P2), simulation/replay datasets (P3), risk assessments (P4),
decisions + rationale + policy evaluations (P5–P7), recovery actions + attempts
(P8), outcome verifications (P9), append-only recovery ledger entries (P10),
merchant memory embeddings/summaries (P11). Each lands as its own migration;
enums evolve additively.

## 9. Testing strategy

Vitest, node environment, no live DB required for CI determinism:

- Config: acceptance of valid envs, rejection matrix for invalid ones.
- HTTP: fastify `inject()` against the real app factory with injected fakes.
- Readiness: success, failure, hang/timeout, response-leak prevention.
- Error handling: mapping table of error classes → status/envelope, production
  masking, framework errors (bad JSON, 404).
- Persistence boundary: repository/service behavior against typed mock stores.
- Web: pure formatting logic (`formatInr`, `formatPercent`).

Integration-style tests against a live PostgreSQL run naturally during local
verification (`/ready` checks); dedicated DB-backed test suites arrive with the
first data-bearing phase.

## 10. Extension map (phases → touch points)

| Phase | New capability | Where it plugs in |
| --- | --- | --- |
| 2 | Razorpay webhooks | new `routes/` module + `services/ingestion` + idempotency repo |
| 3 | Simulation/replay | `services/simulation` reusing event normalization |
| 4 | Risk engine | `domain/risk` + `services/risk`; scheduled/batch entrypoint |
| 5 | Context/pattern/memory | `services/intelligence/*`, new repos |
| 6 | AI decision agent | behind a provider interface; deterministic fallbacks required |
| 7 | Policy engine | pure functions over decisions; fail-closed defaults |
| 8 | Action orchestrator | `services/actions` + outbox pattern on existing Postgres |
| 9 | Outcome verification | consumes orchestrator results, writes ledger candidates |
| 10 | Recovery ledger | append-only table + read APIs |
| 11 | Adaptive memory | evolves merchant memory schemas/consumers |
| 12–14 | Modules, voice, full dashboard | new route modules + dashboard sections |

The foundation's stable seams — validated config, structured logging, central
error handling, repository boundaries, health/readiness — are intended to remain
unchanged while these phases land.
