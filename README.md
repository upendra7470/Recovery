# RecoveryOS

**AI-assisted revenue recovery intelligence for payment-first businesses.**

Payment failures silently drain merchant revenue. RecoveryOS detects revenue at risk, creates recovery opportunities, analyzes context, recommends strategies through AI advisory, enforces deterministic safety policies, executes approved recovery actions, verifies actual payment capture, and records outcomes in an auditable recovery ledger — all without giving AI direct authority over financial actions.

![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue) ![Fastify](https://img.shields.io/badge/Fastify-5-green) ![Next.js](https://img.shields.io/badge/Next.js-16-black) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue) ![Prisma](https://img.shields.io/badge/Prisma-6.12-2D3748) ![Tests](https://img.shields.io/badge/Tests-851-brightgreen)

---

## Product at a Glance

### The problem

Not all payment failures are equal. A network timeout is different from a fraud block. A gateway error during peak hours is different from an expired card. Merchants lose revenue not because retries are impossible, but because they lack the intelligence to know **which** failures are recoverable, the **safety** to retry responsibly, and the **verification** to prove recovery actually happened.

### The solution

RecoveryOS sits between payment failure detection and recovery execution. It classifies failures, ranks recovery opportunities, consults AI for contextual analysis, applies hard safety rules, executes approved actions, and counts revenue as recovered **only after verifying actual payment capture**.

```
Payment Event
    ↓
Revenue Risk Detection
    ↓
Recovery Opportunity (OPEN)
    ↓
Merchant Memory + Strategy Ranking
    ↓
Deterministic Decision Engine (score, confidence, action)
    ↓
AI Advisory (optional, non-binding)
    ↓
Deterministic Safety Policy Gate
    ↓
┌──────────────────────────────────────┐
│  APPROVED  → Recovery Execution      │
│  BLOCKED   → No action              │
│  REVIEW    → Human decision         │
└──────────────────────────────────────┘
    ↓
Payment Capture (simulated or real Razorpay)
    ↓
Outcome Verification (capture matched to attempt)
    ↓
Recovery Ledger (RECOVERED or OPEN)
    ↓
Merchant Memory Update
```

---

## Why RecoveryOS Is Different

| Capability | Simple Retry | Dashboard | RecoveryOS |
|-----------|:-----------:|:---------:|:----------:|
| Detects revenue risk | — | Yes | Yes |
| Classifies failure context | — | Partial | Yes |
| Recommends strategy | — | — | Yes |
| AI advisory layer | — | — | Yes |
| Deterministic safety gate | — | — | Yes |
| Executes recovery | Blind | — | Safe |
| Verifies outcome before counting | — | — | Yes |
| Learns merchant-specific patterns | — | — | Yes |
| Modular recovery types | — | — | Yes |
| Simulation & judge mode | — | — | Yes |

---

## AI Advises. Policy Decides.

This is the core architectural principle of RecoveryOS.

**AI can:**
- Analyze payment failure context
- Recommend a recovery strategy
- Provide explanation and confidence scores
- Surface warnings about risky patterns

**AI cannot:**
- Execute financial actions directly
- Bypass the deterministic safety policy
- Override hard-coded rules
- Access real payment credentials

```
AI Advisory Layer
    ↓ recommends (non-binding)
Deterministic Safety Policy
    ↓ decides (authoritative)
Recovery Execution
```

If the AI layer is unavailable, the deterministic decision engine and safety policy continue operating without interruption. AI is advisory — never the authority.

The safety policy (`evaluateExecutionSafety()`) is a **pure function** — no I/O, no randomness, no clock reads. Given the same inputs, it always produces the same verdict. It enforces hard rules:

- `DO_NOT_RETRY` for hard declines (fraud, Do Not Honor)
- `REVIEW` for low confidence or excessive retry counts
- `RETRY` only when all policy checks pass (opportunity is OPEN, confidence above threshold, retry count within limits, no blocking risk flags)

---

## Execution ≠ Recovery

RecoveryOS does **not** count a retry being "accepted" as recovered revenue.

The verification chain:

1. Recovery action dispatched
2. Payment capture event received (webhook or simulated)
3. Capture event matched to the original recovery attempt
4. Outcome verified against original failure
5. Recovery Ledger updated
6. **Only then** is revenue counted as recovered

When RecoveryOS reports recovered revenue, that number comes from **verified, persisted outcomes** — not from frontend calculations or execution acknowledgments.

---

## Recommended 5-Minute Demo

### Setup

```bash
git clone <repo-url> && cd recoveryos
npm install
docker compose up -d db
cp .env.example .env
# In .env, set: DEMO_MODE_ENABLED=true
npm run db:migrate:deploy
npm run dev
```

**API:** http://localhost:4000 · **Web:** http://localhost:3000

### Run the demo

1. Open **http://localhost:3000/judge**
2. Select **Payment Failure Storm**
3. Set **Seed:** `42`, **Events:** `200`, **Merchants:** `5`
4. Click **Start Scenario**
5. Watch progress and live metrics

### What to observe

| Stage | What you see |
|-------|-------------|
| Detection | Payment failures classified by type (gateway, network, insufficient funds, expired card) |
| Opportunities | Revenue at risk identified and quantified |
| Decision | Each opportunity scored (0–100) with confidence and priority |
| Safety | Approved, blocked, or escalated to review |
| Execution | Approved actions dispatched through the pipeline |
| Verification | Capture events matched to recovery attempts |
| Ledger | Recovered revenue updated only after verification |
| Memory | Merchant-specific strategy performance recorded |

### Canonical results (seed 42, 200 events, 5 merchants)

| Metric | Value |
|--------|-------|
| Events processed | 200 |
| Opportunities detected | 12 |
| Executions approved | 4 |
| Blocked by safety | 8 |
| Verified recoveries | 4 |
| Revenue at risk | ₹45,68,079 |
| Recovered revenue | ₹6,71,335 |
| Duration | ~5 seconds |

*These are actual results from the canonical scenario run.*

---

## Judge Mode

Judge Mode provides controlled, reproducible scenarios for evaluating the full RecoveryOS pipeline. Each scenario uses the existing detection, decision, safety, execution, and verification code — no bypass, no shortcuts.

**Route:** `/judge`

### Available scenarios

| Scenario | Seed | Events | Merchants | What it demonstrates |
|----------|------|--------|-----------|---------------------|
| **Payment Failure Storm** | 42 | 1,000 | 5 | Diverse failure types, full pipeline coverage |
| **Gateway Degradation** | 77 | 1,000 | 5 | Concentrated gateway/network failures, transient vs permanent |
| **Mixed Recovery** | 123 | 1,000 | 5 | Realistic mixture: approved, blocked, review-required |
| **Recovery Stress Test** | 999 | 10,000 | 10 | Large-scale throughput and accuracy under load |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (Next.js 16)                │
│  Dashboard │ Judge │ Simulation │ Modules │ Memory       │
└────────────────────────┬────────────────────────────────┘
                         │ REST API
┌────────────────────────┴────────────────────────────────┐
│                     API (Fastify 5)                      │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ Webhooks │  │ Routes   │  │ Demo / Judge / Sim    │  │
│  └────┬─────┘  └────┬─────┘  └──────────┬───────────┘  │
│       │              │                    │              │
│  ┌────┴──────────────┴────────────────────┴──────────┐  │
│  │              Revenue Leakage Service                │  │
│  │  ┌───────────┐  ┌──────────────┐  ┌────────────┐ │  │
│  │  │ Detection │  │ Opportunity  │  │   Memory   │ │  │
│  │  │  Rules    │  │ Repository   │  │  Service   │ │  │
│  │  └───────────┘  └──────────────┘  └────────────┘ │  │
│  └──────────────────────┬────────────────────────────┘  │
│                         │                                │
│  ┌──────────────────────┴────────────────────────────┐  │
│  │           Decision Engine (deterministic)          │  │
│  │  Score → Priority → Confidence → Action            │  │
│  └──────────────────────┬────────────────────────────┘  │
│                         │                                │
│  ┌──────────────────────┴────────────────────────────┐  │
│  │              AI Advisory Layer                     │  │
│  │  OpenAI-compatible │ Demo adapter │ constrain()   │  │
│  └──────────────────────┬────────────────────────────┘  │
│                         │                                │
│  ┌──────────────────────┴────────────────────────────┐  │
│  │         Safety Policy (evaluateExecutionSafety)    │  │
│  │  Pure function │ No I/O │ Deterministic verdict    │  │
│  └──────────┬───────────────┬───────────────┬────────┘  │
│             │ APPROVED      │ BLOCKED       │ REVIEW    │
│  ┌──────────┴───────┐                   ┌───┴────────┐  │
│  │    Execution     │                   │   Human    │  │
│  │  Demo │ Razorpay │                   │   Review   │  │
│  └──────────┬───────┘                   └────────────┘  │
│             │                                            │
│  ┌──────────┴───────────────────────────────────────┐   │
│  │           Outcome Verification                     │  │
│  │  Capture event → Match to attempt → Verify → Ledgr │  │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              │    PostgreSQL 16     │
              │  13 models │ Prisma  │
              └─────────────────────┘
```

See [docs/architecture.md](docs/architecture.md) for detailed system design, data flow, and module descriptions.

---

## System Components

### Revenue Risk Detection

Detection rules analyze incoming payment events and identify revenue at risk:

- **Failed Payment** — Triggers on `payment.failed` where no captured payment exists for the same order within the detection window. Excludes subscription failures.
- **Subscription Payment Failed** — Handles recurring subscription renewal failures with churn prevention context.
- **Checkout Dropoff** — Identifies abandoned checkout sessions and incomplete payment intents.

Each rule produces a `RecoveryOpportunity` with evidence, amount at risk, and failure context.

### Decision Engine

A transparent, explainable heuristic model (not machine learning). Fixed weights over observed factors produce a score (0–100). A separate evidence-quality calculation produces confidence. Ordered safety rules select the action.

**Scoring factors:**

| Factor | Weight | What it measures |
|--------|--------|-----------------|
| Value | 25 | Recoverable amount in INR paise |
| Recency | 15 | How recently the failure occurred |
| Recoverability | 25 | Failure category (transient > unknown > insufficient funds > hard decline) |
| Retry History | 15 | Number of prior failed attempts |
| Historical Support | 20 | Merchant-specific recovery rate (requires ≥20 samples) |

**Action selection** (first match wins):
1. Opportunity not OPEN → `NO_ACTION`
2. Hard decline → `DO_NOT_RETRY`
3. Authentication / insufficient funds → `CUSTOMER_ACTION_REQUIRED`
4. Multiple retries within 60 minutes → `WAIT`
5. Low confidence or unknown category → `REVIEW`
6. High retry count (≥4) → `REVIEW`
7. Default → `RETRY`

### Safety Policy

The `evaluateExecutionSafety()` function is the final authority. It is a **pure function** — no I/O, no randomness, no clock reads. Checks include:

- Action must be `RETRY` or `WAIT`
- Opportunity must be `OPEN`
- No existing captured payment for this opportunity
- Confidence ≥ configured threshold
- No blocking risk flags (`NON_RECOVERABLE_CONDITION`, `HIGH_RETRY_COUNT`)
- Retry count < max retries
- Provider payment ID must exist

Eight distinct block reasons are defined. If any check fails, execution is blocked.

### AI Advisory

AI integration uses an OpenAI-compatible API (opt-in via `AI_ENABLED=true`). The `constrainAdvice()` function scans AI output for retry suggestions and contradicts them when the deterministic decision is `DO_NOT_RETRY` or `NO_ACTION`, marking advice as `safetyConstrained: true`.

In demo mode, a deterministic `DemoAIAdvisor` provides synthetic analysis without external API calls.

If AI is unavailable, the deterministic pipeline operates without interruption.

### Recovery Execution

- **Demo Mode** — `DemoRetryAdapter` always accepts retry requests. No external API calls. Returns a deterministic provider reference.
- **Razorpay Mode** — `RazorpayRetryAdapter` makes real API calls to Razorpay's Orders API via Basic Auth. Requires `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. Opt-in, sandbox-safe.

### Outcome Verification

Execution acceptance is **not** recovery. RecoveryOS verifies:

1. Payment capture event received
2. Event matched to original recovery attempt (same payment ID or order ID)
3. Opportunity status updated from OPEN to RECOVERED
4. Recovery Ledger persisted

Only verified, persisted outcomes are counted as recovered revenue.

### Recovery Ledger

All recovery attempts and outcomes are persisted in the database with full audit trail:

- Execution status and provider reference
- Failure codes and reasons
- Timestamps for request, start, and completion
- Idempotency keys prevent duplicate processing

### Merchant Memory

Per-merchant, per-strategy, per-failure-type performance tracking:

```
Merchant A + Subscription Failure + RETRY strategy
    → 15 attempts, 12 successes, 3 failures
    → 80% success rate
    → Effectiveness score: 0.82
    → Confidence: HIGH
```

**Effectiveness formula:** 60% success rate + 30% recovery rate + 10% sample confidence

**Confidence curve:** Sigmoid — 0 samples → 0 confidence, 20 → 60, 50 → 85, 100 → 95

**Cold start:** When fewer than 20 historical samples exist, the system uses the module's default strategy and scores the `historicalSupport` factor as 0.

Strategy memory feeds back into the decision engine's `historicalSupport` factor, allowing RecoveryOS to learn which strategies work for which merchants over time.

---

## Recovery Modules

| Module | Trigger Event | Strategies | Purpose |
|--------|--------------|------------|---------|
| **Failed Payment** | `payment.failed` | RETRY, PAYMENT_LINK, REVIEW, DO_NOT_RETRY | Card/UPI transaction recovery with smart retry scheduling |
| **Subscription Recovery** | `subscription.charged` | RETRY, PAYMENT_LINK, REVIEW, DO_NOT_RETRY | Recurring renewal failure recovery with churn prevention |
| **Mandate Retry** | `mandate.debited` | RETRY, REVIEW, DO_NOT_RETRY | NACH/e-mandate representment with bank cooldown limits |
| **B2B Receivable** | `invoice.overdue` | PAYMENT_LINK, RETRY, REVIEW, DO_NOT_RETRY | Overdue enterprise invoice recovery via payment links and reminders |
| **Checkout Dropoff** | `checkout.abandoned` | PAYMENT_LINK, RETRY, REVIEW, DO_NOT_RETRY | Abandoned cart recovery via timed recovery links |
| **Payment Degradation** | `gateway.degraded` | RETRY, REVIEW, DO_NOT_RETRY | Gateway anomaly detection with circuit breaker pattern |

Each module shares the same intelligence core: detection → decision → safety → execution → verification → ledger.

---

## Simulation System

RecoveryOS includes a deterministic simulation engine for reproducible testing without real money.

**Why synthetic data exists:**
- Buildathon sandbox limitations (no real payment traffic)
- Reproducible, deterministic testing (same seed = same results)
- Controlled demonstrations for evaluation
- Stress testing at scale

**Components:**
- **Seeded PRNG** — Deterministic random number generator (mulberry32). Same seed always produces the same sequence.
- **Synthetic Data Generator** — Creates realistic payment events with configurable failure distributions.
- **Event Replay Engine** — Replays synthetic events through the full RecoveryOS pipeline.
- **Judge Scenarios** — Pre-configured scenario presets for evaluation.

Synthetic data runs through the **same pipeline** as real payment events — detection, decision, safety, execution, verification. No shortcuts, no bypasses.

**Routes:** `/simulation/*` (requires `DEMO_MODE_ENABLED=true`)

---

## Razorpay Integration

RecoveryOS includes a Razorpay integration adapter. It is **opt-in** and works in demo mode without credentials.

**Configuration:**
- Set `RECOVERY_EXECUTION_PROVIDER=razorpay`
- Provide `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`
- Optionally set `RAZORPAY_BASE_URL` (defaults to `https://api.razorpay.com`)

**What it does:**
- Creates orders via Razorpay's Orders API (`POST /v1/orders`)
- Uses Basic Auth for authentication
- Order `receipt` field serves as idempotency key
- Returns order ID as provider reference for frontend Checkout integration

**Webhook verification:**
- HMAC-SHA256 signature verification
- Timing-safe comparison
- Fail-closed on invalid signatures

**What it does NOT do:**
- Does not initiate payments directly (uses Checkout flow)
- Does not store payment credentials
- Does not process refunds

In demo mode, the `DemoRetryAdapter` handles all execution without external API calls.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16.3 (App Router), React 19, Tailwind CSS 4.3 |
| API | Fastify 5.12, TypeScript 5.9 |
| Database | PostgreSQL 16 |
| ORM | Prisma 6.12 |
| AI Advisory | OpenAI-compatible API (opt-in) |
| Testing | Vitest 4.1 |
| Validation | Zod 4.4 |
| Logging | Pino 10 |
| CI | GitHub Actions |
| Infrastructure | Docker, Docker Compose |

---

## Project Structure

```
recoveryos/
├── apps/
│   ├── api/                          # Fastify 5 + Prisma 6
│   │   ├── src/
│   │   │   ├── routes/               # 14 route files (auth, webhooks, demo, judge, ...)
│   │   │   ├── services/             # 16 service files (execution, memory, dashboard, ...)
│   │   │   ├── simulation/           # Synthetic data + replay engine
│   │   │   ├── detection/            # Revenue risk detection rules
│   │   │   ├── decision/             # Deterministic decision engine
│   │   │   ├── execution/            # Recovery execution providers
│   │   │   ├── modules/              # 6 modular recovery types
│   │   │   ├── ai/                   # AI advisory layer
│   │   │   ├── auth/                 # Authentication (scrypt + sessions)
│   │   │   ├── plugins/              # Error handler, security headers, CORS
│   │   │   ├── repositories/         # Data access layer
│   │   │   ├── domain/               # Type definitions + pure functions
│   │   │   └── config/               # Environment validation (Zod)
│   │   ├── prisma/                   # Schema + migrations (13 models)
│   │   ├── api/                      # Vercel serverless handler
│   │   └── test/                     # 60 test files
│   │       ├── reliability/          # Race conditions, idempotency, safety attacks
│   │       ├── security/             # Input validation, isolation, secrets
│   │       ├── decision/             # Engine logic verification
│   │       ├── detection/            # Rule correctness
│   │       └── ...
│   └── web/                          # Next.js 16
│       └── src/
│           ├── app/                  # 11 page routes
│           ├── components/           # UI + layout components
│           └── lib/                  # API client + utilities
├── docs/                             # Architecture, demo script, submission
├── docker-compose.yml                # 3-service stack (db, api, web)
└── .env.example                      # Environment reference
```

---

## Running Locally

### Requirements

- Node.js ≥ 20
- Docker (for PostgreSQL)

### Setup

```bash
# Clone and install
git clone <repo-url> && cd recoveryos
npm install

# Start PostgreSQL
docker compose up -d db

# Configure environment
cp .env.example .env

# Run migrations
npm run db:migrate:deploy

# Start development servers
npm run dev
```

**API:** http://localhost:4000 · **Web:** http://localhost:3000

### With Docker Compose (full stack)

```bash
cp .env.example .env
docker compose up --build
```

---

## Running the Demo

```bash
# In .env, add:
DEMO_MODE_ENABLED=true

# Start the stack
npm run dev

# Open Judge Mode
# http://localhost:3000/judge

# Or use API directly:
# POST /judge/start { "scenario": "payment-failure-storm" }
```

**Demo pages:**
- `/judge` — Judge Mode with reproducible scenarios
- `/demo` — Live command center with real-time pipeline visualization
- `/simulation` — Simulation Lab for custom dataset generation and replay

---

## Testing

```bash
# Run all tests (851 total)
npm run test

# API tests only (839)
npm run test -w @recoveryos/api

# Web tests only (12)
npm run test -w @recoveryos/web
```

### Test categories

| Category | What's covered |
|----------|---------------|
| Detection rules | Unit tests for each failure pattern |
| Decision engine | Deterministic logic, scoring, action selection |
| Safety policy | Approved/blocked/review outcomes, attack resistance |
| Execution | Demo adapter, provider interface, state transitions |
| Merchant Memory | Upsert, strategy ranking, isolation, effectiveness |
| API routes | All endpoints with request/response validation |
| Frontend | Component rendering, API client |
| Reliability | Race conditions, concurrent execution, idempotency |
| Security | Webhook verification, input validation, secret handling, merchant isolation |

### CI

GitHub Actions runs on every push/PR to `main`:
- PostgreSQL 16 container for integration tests
- Lint → Typecheck → Test → Build (both API and web)
- `npm audit` with high-severity check

---

## Reliability & Security

### Reliability controls

- **Webhook HMAC verification** — Fail-closed signature validation
- **Merchant isolation** — All queries scoped by `merchantId`
- **Idempotency** — Unique constraints on `providerEventId`, `idempotencyKey`
- **Conditional state transitions** — `updateMany WHERE status = expected` prevents race conditions
- **Concurrent update protection** — Only one of two concurrent transitions succeeds
- **Duplicate event handling** — Events processed exactly once via unique constraints
- **Graceful shutdown** — 30-second hard-stop timeout for in-flight requests

### Security controls

- **Input validation** — Zod schemas on all API inputs
- **Secret redaction** — DATABASE_URL, API keys censored in logs
- **CORS** — Restricted to configured origins in production
- **HSTS** — `max-age=63072000; includeSubDomains; preload`
- **CSP** — `default-src 'none'; frame-ancestors 'none'`
- **X-Content-Type-Options** — `nosniff`
- **X-Frame-Options** — `DENY`
- **Body limit** — 1MB max request payload
- **Request ID** — UUID correlation on every response

### Three reliability bugs discovered and fixed

**1. Merchant Memory Race Condition**
- **Problem:** Concurrent upserts could violate unique constraints on `(merchantId, strategy, failureType)`
- **Root cause:** Standard upsert + increment pattern had a gap between read and write
- **Fix:** Atomic `updateMany WHERE attempts < newAttempts` with conditional increments
- **Protection:** `test/reliability/concurrency.test.ts`

**2. Execution Transition Race**
- **Problem:** Concurrent workers could both attempt `PENDING → AUTHORIZED` on the same execution
- **Root cause:** Two workers read the same status and both attempted transition
- **Fix:** Conditional `updateStatus` that only transitions from the expected current state
- **Protection:** `test/reliability/concurrency.test.ts`

**3. Double Recovery Mutation**
- **Problem:** Duplicate capture events could mutate already-recovered opportunities
- **Root cause:** No guard against processing a capture for an already-RECOVERED opportunity
- **Fix:** Guard: `updateMany WHERE status = OPEN` — only OPEN opportunities can be recovered
- **Protection:** `test/reliability/outcome-integrity.test.ts`, `test/reliability/duplicate-events.test.ts`

---

## What Broke and How We Fixed It

Beyond the three reliability bugs above, several engineering challenges emerged:

**AI Safety Constraint** — The AI advisory layer could recommend retrying a payment that the deterministic engine classified as `DO_NOT_RETRY`. Fixed by adding `constrainAdvice()` which scans AI output, contradicts unsafe suggestions, and marks advice as `safetyConstrained: true`.

**Demo Mode Idempotency** — Running the same demo scenario twice could create duplicate opportunities. Fixed by adding `DEMO_RUN_PREFIX` tracking and conditional cleanup between scenario runs.

**Vercel Deployment** — Fastify's long-running server model is incompatible with Vercel's serverless runtime. Fixed by creating an `api/index.ts` handler that uses `app.inject()` to process each request through the full pipeline without `app.listen()`.

**TypeScript Discriminated Union Narrowing** — TypeScript 5.9.3 on Vercel's build runner failed to narrow a discriminated union after an early return. Fixed by destructuring the union member after the type guard.

---

## Limitations

- **Synthetic data** — Demo mode uses simulated payment events, not real transactions
- **Demo execution** — Recovery execution in demo mode uses a deterministic adapter (no real money movement)
- **No production deployment** — This is a buildathon prototype, not a production service
- **AI advisory only** — AI provides contextual analysis but does not make financial decisions
- **Single payment provider** — Razorpay integration exists but is opt-in and sandbox-only
- **Buildathon scale** — Testing and evaluation are limited to the scenarios included in the repository

This repository demonstrates the architecture and recovery lifecycle. It is not presented as a production financial system.

---

## Future Scope

- Additional payment providers (Stripe, PayU, CCAvenue)
- Richer recovery strategies (payment method upgrades, installment plans)
- Production-grade observability (distributed tracing, alerting)
- Expanded merchant segmentation and cohort analysis
- More recovery channels (SMS, email, WhatsApp)
- Stronger evaluation datasets with real-world failure distributions
- Production deployment with horizontal scaling
- Advanced strategy optimization using reinforcement learning

---

## AI-Assisted Development

AI was used throughout development to:

- Inspect implementation and reason about edge cases
- Assist with implementing detection rules, decision engine, and safety policy
- Generate and refine test suites for reliability and security
- Investigate race conditions and concurrency issues
- Draft documentation and architecture descriptions

The architecture defines deterministic safety boundaries. AI is not granted unrestricted financial authority. Generated code was tested and validated against the existing test suite.

---

## Built for the Razorpay Buildathon

RecoveryOS demonstrates how AI can be used responsibly in financial systems — as an advisory layer with deterministic safety boundaries, not as an autonomous execution authority. It combines revenue risk detection, context-aware strategy recommendation, merchant-specific learning, deterministic safety, verified recovery, and auditable record-keeping into a single orchestration layer.

---

## License

Private — All rights reserved.
