# RecoveryOS

**AI-powered revenue recovery intelligence for modern payment operations.**

RecoveryOS sits beside payment infrastructure such as Razorpay to help merchants
understand where revenue is leaking, decide how to recover it safely, execute
approved recovery actions, verify outcomes, and measure the revenue actually
recovered.

> **Status: Phase 1 — Foundation.**
> RecoveryOS does **not yet connect to Razorpay**, does **not use AI/LLMs**, and
> does **not perform any recovery actions**. All monetary figures shown in the
> dashboard are zero by design because no payment events exist yet.

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

## 2. Current phase scope (Phase 1)

Phase 1 delivers only the application foundation:

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

Explicitly **not** in this phase: Razorpay integration, webhooks, event ingestion,
idempotency, synthetic data, simulation, risk engine, AI decisions, policies,
recovery actions, outcome verification, ledger, merchant memory, voice recovery,
authentication.

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
routes/        HTTP surface (health, readiness today; events/payments later)
services/      business rules + input validation orchestration
repositories/  persistence boundaries (no Prisma types leak upward)
domain/        core types + schemas (Merchant today; more later)
lib/           logger, database checks, error model, prisma client
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

## 9. Tests

```bash
npm test            # all workspaces
npm run test --workspace @recoveryos/api        # watch mode: add :watch
```

Covered: env config validation, `/health`, `/ready` (up, down, timeout,
no-leak), centralized error handling (unknown errors, AppErrors, thrown
ZodErrors, 404s, malformed JSON, production hardening), database connectivity
checks (success/failure/timeout), repository + service behavior with mocked
persistence, and web formatting utilities.

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

No Razorpay connectivity, no webhook/event ingestion, no idempotency layer, no
synthetic transactions or simulation, no revenue-risk engine, no AI/LLM usage of
any kind, no recovery strategies or actions, no payment retries or links, no
voice recovery, no merchant memory, no anomaly detection, no authentication, and
**no claimed recovered revenue** — every money figure renders as ₹0 honestly.

## 14. Planned future phases

Phase 2 Razorpay integration + webhook ingestion + normalization + idempotency ·
Phase 3 synthetic data + simulation + replay · Phase 4 revenue risk engine ·
Phase 5 recovery intelligence/context/pattern engines + merchant memory ·
Phase 6 AI decision agent · Phase 7 policy/safety engine · Phase 8 recovery
action orchestrator · Phase 9 outcome verification · Phase 10 recovery ledger ·
Phase 11 adaptive merchant memory · Phase 12 recovery modules · Phase 13
Hinglish voice recovery · Phase 14 full merchant dashboard. Details:
[docs/architecture.md](docs/architecture.md).
