# RecoveryOS Architecture

## Overview

RecoveryOS is a revenue recovery intelligence platform that detects payment failures, decides whether to retry, executes approved recovery actions, verifies outcomes, and learns merchant-specific patterns — all governed by a deterministic safety engine that an AI advisory layer can never override.

## System Principles

1. **Safety First** — `evaluateExecutionSafety()` is the authoritative gate. AI advises, safety decides.
2. **Execution ≠ Recovery** — A successful retry does not mean revenue is recovered. Only verified captures count.
3. **Merchant Isolation** — Every query scoped by `merchantId`. No cross-tenant leakage.
4. **Simulation Isolation** — Synthetic data runs through the same pipeline, flagged as demo-only.

## Architecture Diagram

```
                    ┌─────────────────────┐
                    │ Razorpay Webhooks   │
                    │ / Synthetic Events  │
                    └──────────┬──────────┘
                               ↓
                    ┌─────────────────────┐
                    │ Event Infrastructure│
                    │ PaymentEvent store  │
                    └──────────┬──────────┘
                               ↓
                    ┌─────────────────────┐
                    │ Revenue Risk Engine │
                    │ Detection Rules     │
                    └──────────┬──────────┘
                               ↓
                    ┌─────────────────────┐
                    │ Recovery Opportunity│
                    │ Status: OPEN        │
                    └──────────┬──────────┘
                               ↓
                    ┌─────────────────────┐
                    │ Merchant Memory     │
                    │ Strategy Ranking    │
                    └──────────┬──────────┘
                               ↓
                    ┌─────────────────────┐
                    │ Decision Engine     │
                    │ Deterministic       │
                    └──────────┬──────────┘
                               ↓
                    ┌─────────────────────┐
                    │ AI Advisory Layer   │
                    │ (Optional, Binding) │
                    └──────────┬──────────┘
                               ↓
                    ┌─────────────────────┐
                    │ Safety Policy Gate  │
                    │ Deterministic       │
                    └──────────┬──────────┘
                               ↓
              ┌────────────────┼────────────────┐
              ↓                ↓                ↓
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │   APPROVED   │ │   BLOCKED    │ │    REVIEW    │
     │  Execute     │ │  No Action   │ │  Human Decides│
     └──────┬───────┘ └──────────────┘ └──────────────┘
            ↓
     ┌─────────────────────┐
     │ Recovery Execution  │
     │ Demo/Razorpay       │
     └──────────┬──────────┘
                ↓
     ┌─────────────────────┐
     │ Payment Capture     │
     │ (Simulated/Real)    │
     └──────────┬──────────┘
                ↓
     ┌─────────────────────┐
     │ Outcome Verification│
     └──────────┬──────────┘
                ↓
     ┌─────────────────────┐
     │ Recovery Ledger     │
     │ Status: RECOVERED   │
     └──────────┬──────────┘
                ↓
     ┌─────────────────────┐
     │ Merchant Memory     │
     │ Strategy Update     │
     └─────────────────────┘
```

## Simulation Architecture

Simulation uses the **existing RecoveryOS pipeline** — no bypass, no shortcuts.

```
Synthetic Dataset Generator
    ↓
Seeded Random Number Generator
    ↓
Synthetic Payment Events
    ↓
Event Replay Service
    ↓
EXISTING RecoveryOS Pipeline
    ↓
Persisted Analytics (SimulationRun)
```

Judge Mode wraps this with scenario configurations:

```
Scenario Config
    ↓
Synthetic Dataset (seeded, deterministic)
    ↓
Event Replay
    ↓
Full RecoveryOS Pipeline
    ↓
Judge Analytics (opportunities, safety, recovery)
```

## Data Flow

### Event Ingestion

| Source | Path |
|--------|------|
| Razorpay webhook | `POST /webhooks/razorpay` → `WebhookService` → `PaymentEvent` |
| Synthetic event | `SyntheticEventReplay` → `PaymentEvent` (via detection pipeline) |
| Demo scenario | `POST /demo/run/:scenario` → full pipeline |

### Detection Rules

| Rule | Trigger | Output |
|------|---------|--------|
| `FailedPaymentRule` | `payment.failed` | RecoveryOpportunity (FAILED_PAYMENT) |
| `SubscriptionPaymentFailedRule` | `subscription.payment_failed` | RecoveryOpportunity (SUBSCRIPTION_PAYMENT_FAILED) |
| `CheckoutDropoffRule` | `checkout.session_expired` | RecoveryOpportunity (CHECKOUT_DROPOFF) |

### Decision Engine

Pure function: `evaluateRecoveryDecision(opportunity, memory, config) → Decision`

Inputs:
- Failure category (network, gateway, insufficient funds, expired card, fraud)
- Retry count and history
- Merchant strategy performance
- Risk score

Outputs:
- `score` (0–100)
- `priority` (VERY_LOW → CRITICAL)
- `confidence` (0–100)
- `recommendedAction` (RETRY, DO_NOT_RETRY, REVIEW, WAIT, etc.)

### Safety Gate

```
evaluateExecutionSafety(decision, executionConfig) → SafetyResult

HARD_DECLINE codes → DO_NOT_RETRY
Low confidence → REVIEW
Excessive retries → REVIEW
All checks pass → RETRY (if enabled)
```

AI cannot override this gate.

### Execution Providers

| Provider | Mode | Behavior |
|----------|------|----------|
| `DemoRetryAdapter` | Demo | Deterministic success after 300ms |
| `RazorpayRetryAdapter` | Production | Real Razorpay API call via Basic Auth |

### Outcome Verification

1. Execution dispatched → `RecoveryExecution` (PENDING)
2. Payment capture event received → matched to execution
3. `RecoveryOpportunity.status` → RECOVERED
4. `RecoveryExecution.status` → SUCCEEDED
5. Revenue counted in Recovery Ledger

## Module System

| Module | Strategy | Adapter |
|--------|----------|---------|
| SUBSCRIPTION_RECOVERY | RETRY | SubscriptionRetryAdapter |
| MANDATE_RETRY | RETRY | MandateRetryAdapter |
| B2B_RECEIVABLE | PAYMENT_LINK | B2BReceivableAdapter |
| CHECKOUT_DROPOFF | RETRY | CheckoutRecoveryAdapter |
| PAYMENT_DEGRADATION | ALTERNATE_METHOD | DegradationAdapter |

Each module shares the same detection → decision → safety → execution → verification pipeline.

## Database Schema

### Core Models (13)

| Model | Purpose |
|-------|---------|
| `Merchant` | Tenant isolation boundary |
| `PaymentAccount` | Provider-specific account config |
| `PaymentEvent` | Ingested payment events |
| `RecoveryOpportunity` | Detected revenue risk |
| `RecoveryDecision` | Engine decisions |
| `RecoveryAIAdvice` | AI advisory records |
| `RecoveryExecution` | Execution attempts |
| `MerchantStrategyMemory` | Per-merchant strategy performance |
| `SimulationRun` | Simulation analytics |
| `User` | Authentication |
| `MerchantMembership` | Multi-tenant access |
| `Session` | Session management |

### Key Unique Constraints

- `PaymentEvent(provider, providerEventId)` — idempotent ingestion
- `RecoveryDecision(opportunityId, engineVersion)` — one decision per version
- `RecoveryExecution(idempotencyKey)` — no duplicate executions
- `MerchantStrategyMemory(merchantId, strategy, failureType)` — one record per combination

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/health` | GET | Liveness probe |
| `/ready` | GET | Readiness probe (DB check) |
| `/webhooks/razorpay` | POST | Webhook ingestion |
| `/dashboard/overview` | GET | Dashboard aggregation |
| `/opportunities` | GET | List recovery opportunities |
| `/decisions` | GET | List decisions |
| `/executions` | GET | List executions |
| `/operations` | GET | List operations |
| `/demo/status` | GET | Demo mode status |
| `/demo/run/:scenario` | POST | Run demo scenario |
| `/demo/reset` | DELETE | Reset demo data |
| `/judge/scenarios` | GET | List judge scenarios |
| `/judge/start` | POST | Start judge scenario |
| `/judge/run/:id` | GET | Judge run status |
| `/judge/run/:id/analytics` | GET | Judge analytics |
| `/simulation/run` | POST | Start simulation |
| `/simulation/run/:id` | GET | Simulation status |
| `/simulation/run/:id/analytics` | GET | Simulation analytics |
| `/recovery-modules` | GET | List recovery modules |
| `/merchant-memory` | GET | Merchant strategy memory |

## Frontend Pages

| Page | Route | Type | Purpose |
|------|-------|------|---------|
| Dashboard | `/` | Server | KPIs, pipeline, activity |
| Judge Mode | `/judge` | Client | Scenario selection & execution |
| Live Demo | `/demo` | Server+Client | Command center visualization |
| Simulation Lab | `/simulation` | Client | Dataset generation & replay |
| Recovery Cases | `/recovery-cases` | Server | Opportunity list & detail |
| Recovery Modules | `/recovery-modules` | Server | Module overview |
| Operations | `/operations` | Server | Execution history |
| Payment Health | `/payment-health` | Server | Gateway health |
| AI Decisions | `/ai-decisions` | Server | Decision audit log |
| Merchant Memory | `/merchant-memory` | Server | Strategy performance |

## Deployment

### Docker Compose (3 services)

```yaml
services:
  db:     postgres:16-alpine (port 5432)
  api:    Fastify 5 (port 4000)
  web:    Next.js 16 (port 3000)
```

### CI Pipeline (GitHub Actions)

```
Push/PR to main
    ├── API Job
    │   ├── PostgreSQL container
    │   ├── npm ci
    │   ├── npm audit
    │   ├── Prisma migrate
    │   ├── ESLint
    │   ├── TypeScript
    │   ├── Vitest (833 tests)
    │   └── Build
    └── Web Job
        ├── npm ci
        ├── npm audit
        ├── ESLint
        ├── TypeScript
        ├── Vitest (12 tests)
        └── Build
```

## Security Model

| Control | Implementation |
|---------|---------------|
| Webhook verification | HMAC SHA256 (fail-closed) |
| Safety gate | Deterministic, non-overridable |
| Merchant isolation | All queries scoped by merchantId |
| Secret redaction | DATABASE_URL, API keys, secrets censored in logs |
| Input validation | Zod schemas on all API inputs |
| CORS | Restricted to configured origins |
| HSTS | max-age=63072000; includeSubDomains; preload |
| CSP | default-src 'self'; frame-ancestors 'none' |
| Body limit | 1MB max payload |
| Graceful shutdown | 30s hard-stop timeout |
