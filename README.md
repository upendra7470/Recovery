# RecoveryOS

**AI-assisted revenue recovery intelligence for payment-first businesses.**

RecoveryOS detects payment-related revenue leakage, understands recovery context, recommends strategies through AI advisory, enforces deterministic safety policies, executes approved recovery actions, verifies outcomes against actual payment captures, and learns merchant-specific patterns — all without giving AI direct authority over financial actions.

---

## The Problem

Payment failures silently drain merchant revenue. A failed UPI transaction, a declined card, a gateway timeout — each represents money left on the table. But merchants face a harder problem than just retries:

- **Which failures are recoverable?** Not all failures are equal. A network timeout is different from a fraud block.
- **When should you NOT retry?** Retrying a hard-declined payment wastes resources and risks customer trust.
- **Did the recovery actually work?** A retry being "accepted" doesn't mean money was captured.
- **What worked before for this merchant?** Every merchant has different failure patterns and customer behavior.

Existing solutions are either simple retry logic (blind, unsafe) or dashboards (detect but don't act). Neither provides intelligent, safe, verified recovery.

---

## The Solution

RecoveryOS is a full-stack revenue recovery orchestration layer that sits between payment failure detection and recovery execution. It combines:

1. **Revenue Risk Detection** — Identifies payment failures that represent actual revenue at risk
2. **Recovery Intelligence** — Scores opportunities and recommends actions using deterministic decision logic
3. **Merchant Memory** — Tracks per-merchant strategy performance to improve future decisions
4. **AI Advisory** — Provides contextual analysis (advisory only, never authoritative)
5. **Deterministic Safety Policy** — Enforces hard rules that AI cannot override
6. **Recovery Execution** — Orchestrates approved retry actions through payment providers
7. **Outcome Verification** — Confirms actual payment capture before counting recovery
8. **Recovery Ledger** — Maintains auditable records of all recovery attempts and outcomes

---

## Why RecoveryOS

| Feature | Simple Retry | Dashboard | RecoveryOS |
|---------|-------------|-----------|------------|
| Detects revenue risk | No | Yes | Yes |
| Understands context | No | Partial | Yes |
| Recommends strategy | No | No | Yes |
| AI advisory | No | No | Yes |
| Deterministic safety | No | No | Yes |
| Executes recovery | Yes (blind) | No | Yes (safe) |
| Verifies outcome | No | No | Yes |
| Learns merchant patterns | No | No | Yes |
| Modular recovery types | No | No | Yes |
| Simulation & testing | No | No | Yes |

---

## How It Works

```
Payment Event (webhook or synthetic)
        ↓
Revenue Risk Detection
        ↓
Recovery Opportunity (OPEN)
        ↓
Merchant Memory + Strategy Ranking
        ↓
Deterministic Decision Engine
        ↓
AI Advisory (optional, non-binding)
        ↓
Safety Policy Gate
        ↓
┌─────────────────────────────────┐
│  APPROVED  → Recovery Execution │
│  BLOCKED   → No action         │
│  REVIEW    → Human decision    │
└─────────────────────────────────┘
        ↓
Payment Capture (simulated or real)
        ↓
Outcome Verification
        ↓
Recovery Ledger (RECOVERED or OPEN)
        ↓
Merchant Memory Update
```

---

## Architecture

See [docs/architecture.md](docs/architecture.md) for detailed system design, data flow diagrams, and module descriptions.

### Core Principles

1. **Safety First** — A deterministic `evaluateExecutionSafety()` gate is the final authority. AI advises, safety decides.
2. **Execution ≠ Recovery** — A successful retry execution does not mean revenue is recovered. Only verified payment captures update recovery state.
3. **Merchant Isolation** — Every query is scoped by `merchantId`. No cross-tenant data leakage.
4. **Simulation Isolation** — Synthetic data runs through the same pipeline but is flagged as demo-only.

---

## AI + Safety Architecture

RecoveryOS uses AI as an **advisory layer** — not as an execution authority.

```
AI Advisory Layer
    ↓ recommends
Deterministic Safety Policy
    ↓ decides
Recovery Execution
```

The AI can:
- Analyze payment failure context
- Recommend a recovery strategy
- Provide explanation and confidence

The AI cannot:
- Execute financial actions directly
- Bypass the safety policy
- Override deterministic rules
- Access real payment credentials

If AI is unavailable, the deterministic safety system remains fully operational.

---

## Recovery Pipeline

### Detection Rules
- **Failed Payment** — Detects payment failures and correlates with subsequent successful payments
- **Subscription Payment Failed** — Handles recurring subscription failure patterns
- **Checkout Dropoff** — Identifies abandoned checkout sessions

### Decision Engine
The deterministic decision engine evaluates each opportunity using:
- Failure category (network, gateway, insufficient funds, expired card, fraud)
- Retry count and history
- Merchant-specific strategy performance
- Risk score and confidence level

### Safety Policy
Hard-coded rules that cannot be overridden:
- `DO_NOT_RETRY` for hard decline codes (fraud, Do Not Honor)
- `REVIEW` for low-confidence or excessive retry counts
- `RETRY` only when all policy checks pass

### Execution
- **Demo Mode** — Simulated payment capture (deterministic adapter)
- **Razorpay Mode** — Real API calls via Basic Auth (opt-in, requires credentials)

### Outcome Verification
Execution acceptance is NOT recovery. RecoveryOS verifies:
1. Payment capture event received
2. Event matched to the original recovery attempt
3. Outcome persisted in the Recovery Ledger
4. Only then is revenue counted as recovered

---

## Merchant Memory

RecoveryOS tracks per-merchant, per-strategy, per-failure-type performance:

```
Merchant A + Subscription Failure + RETRY strategy
    → 15 attempts, 12 successes, 3 failures
    → 80% success rate
    → Effectiveness score: 0.82
    → Confidence: HIGH
```

This data feeds back into strategy ranking, allowing RecoveryOS to learn which strategies work for which merchants. On cold start (fewer than 5 outcomes), the system uses the module's default strategy.

---

## Recovery Modules

RecoveryOS supports modular recovery types:

| Module | Trigger | Strategy |
|--------|---------|----------|
| Subscription Recovery | `subscription.payment_failed` | RETRY |
| Mandate Retry | `mandate.authentication_failed` | RETRY |
| B2B Receivable | `invoice.payment_overdue` | PAYMENT_LINK |
| Checkout Dropoff | `checkout.session_expired` | RETRY |
| Payment Degradation | `gateway.degradation_detected` | ALTERNATE_METHOD |

Each module shares the same intelligence core: detection → decision → safety → execution → verification → ledger.

---

## Simulation & Judge Mode

### Simulation Lab (`/simulation`)
Generate synthetic payment datasets and replay them through the full RecoveryOS pipeline. Configure seed, event count, and merchant count to test different scenarios.

### Judge Mode (`/judge`)
Controlled, reproducible scenarios for evaluation:

| Scenario | Description |
|----------|-------------|
| Payment Failure Storm | High volume of diverse failures — demonstrates full pipeline |
| Gateway Degradation | Concentrated gateway/network failures — transient vs permanent |
| Mixed Recovery | Realistic mixture of outcomes — approved, blocked, review |
| Recovery Stress Test | Large-scale throughput verification |

All scenarios use the **existing RecoveryOS pipeline** — no bypass, no shortcuts.

### Live Demo (`/demo`)
Interactive command center with real-time visualization of the recovery lifecycle. Shows the 10-stage pipeline from payment event to recovered revenue.

---

## Verified Revenue Recovery

RecoveryOS distinguishes between execution and recovery:

```
Execution Accepted  ≠  Revenue Recovered
```

The verification chain:

1. Recovery execution dispatched
2. Payment capture event received (webhook or simulated)
3. Event matched to recovery attempt
4. Outcome verified against original failure
5. Recovery Ledger updated
6. Revenue counted as recovered

**Only persisted, verified outcomes are counted as recovered revenue.**

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| API | Fastify 5, TypeScript, Prisma 6.12 |
| Database | PostgreSQL 16 |
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4 |
| Decision Engine | Deterministic (pure function) |
| AI Advisory | OpenAI-compatible API (opt-in) |
| Testing | Vitest (845 tests) |
| CI | GitHub Actions |
| Deployment | Docker, docker-compose |

---

## Running Locally

```bash
# 1. Clone and install
git clone <repo-url> && cd recoveryos
npm install

# 2. Start database
docker compose up -d db

# 3. Set up environment
cp .env.example .env

# 4. Run migrations
npm run db:migrate:deploy

# 5. Start dev servers
npm run dev
```

**API:** http://localhost:4000 · **Web:** http://localhost:3000

---

## Running the Demo

```bash
# Enable demo mode in .env
DEMO_MODE_ENABLED=true

# Start the stack
docker compose up --build

# Or run locally
npm run dev

# Open Judge Mode
# http://localhost:3000/judge

# Select "Payment Failure Storm"
# Seed: 42, Events: 200, Merchants: 5
# Click "Start Scenario"
```

### Canonical Demo Configuration

```
Scenario:   Payment Failure Storm
Seed:       42
Events:     200
Merchants:  5
Duration:   ~5 seconds
```

---

## Testing

```bash
# Run all tests (845 total)
npm run test

# API tests only (833)
npm run test -w @recoveryos/api

# Web tests only (12)
npm run test -w @recoveryos/web
```

### Test Coverage
- Detection rules: unit tests for each failure pattern
- Decision engine: deterministic logic verification
- Safety policy: approved/blocked/review outcomes
- Execution: demo adapter and provider interface
- Merchant Memory: upsert, strategy ranking, isolation
- API routes: all endpoints with request/response validation
- Frontend: component rendering and API client tests
- Reliability: race conditions, concurrent execution, idempotency
- Security: webhook verification, input validation, secret handling

---

## Security

- **Webhook Verification** — HMAC signature verification (fail-closed)
- **Safety Gate** — Deterministic rules that AI cannot override
- **Merchant Isolation** — All queries scoped by merchantId
- **Secret Redaction** — DATABASE_URL, API keys, secrets censored in logs
- **Input Validation** — Zod schemas on all API inputs
- **CORS** — Restricted to configured origins in production
- **HSTS** — Enforced via security headers
- **CSP** — Content Security Policy on frontend
- **Body Limit** — 1MB max request payload
- **Graceful Shutdown** — 30s hard-stop timeout for in-flight requests

---

## Project Structure

```
recoveryos/
├── apps/
│   ├── api/                    # Fastify 5 + Prisma 6
│   │   ├── src/
│   │   │   ├── routes/         # 14 API route files
│   │   │   ├── services/       # 16 service files
│   │   │   ├── simulation/     # Synthetic data + replay
│   │   │   ├── detection/      # Revenue risk rules
│   │   │   ├── decision/       # Deterministic engine
│   │   │   ├── execution/      # Recovery execution
│   │   │   ├── modules/        # Modular recovery types
│   │   │   ├── ai/             # AI advisory layer
│   │   │   ├── auth/           # Authentication
│   │   │   ├── repositories/   # Data access
│   │   │   └── domain/         # Type definitions
│   │   ├── prisma/             # Schema + migrations
│   │   └── test/               # 60 test files
│   └── web/                    # Next.js 16
│       └── src/
│           ├── app/            # 14 page routes
│           ├── components/     # UI + layout components
│           └── lib/            # API clients + utilities
├── docs/                       # Architecture + demo docs
├── docker-compose.yml          # 3-service stack
└── .env.example                # Environment reference
```

---

## Limitations

- **Synthetic Data** — Demo mode uses simulated payment events, not real transactions
- **Demo Execution** — Recovery execution in demo mode uses a deterministic adapter (no real money movement)
- **No Production Deployment** — This is a buildathon demonstration, not a production service
- **AI Advisory Only** — AI provides context analysis but does not make financial decisions
- **Single Payment Provider** — Currently supports Razorpay (extensible via provider adapter)

---

## Buildathon Context

Built for the **Razorpay Buildathon**. RecoveryOS demonstrates how AI can be used responsibly in financial systems — as an advisory layer with deterministic safety boundaries, not as an autonomous execution authority.

### What Broke and How AI Fixed It

During development, three critical reliability issues were discovered and fixed:

1. **Merchant Memory Race Condition** — Concurrent upserts could hit unique constraints. Fixed with atomic `updateMany WHERE attempts < newAttempts` pattern.

2. **Execution Transition Race** — Concurrent workers could both attempt the same state transition. Fixed with conditional `updateStatus` that only transitions from the expected current state.

3. **Double Recovery Mutation** — Duplicate captured events could mutate already-recovered opportunities. Fixed with guard: `updateMany WHERE status = OPEN`.

All fixes are protected by automated tests (Phase 16 — Reliability & Security).

AI-assisted development was used throughout to inspect code, reason about edge cases, implement fixes, and write comprehensive test suites.

---

## License

Private — All rights reserved.
