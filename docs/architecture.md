# RecoveryOS Architecture

## Overview

RecoveryOS is a revenue recovery intelligence platform that detects payment failures, decides whether to retry, and executes recovery — all governed by a deterministic safety engine that an AI advisory layer can never override.

## System Design

### Core Principles

1. **Safety first** — A deterministic `evaluateExecutionSafety()` gate is authoritative. AI provides advisory context only.
2. **Execution ≠ Recovery** — A successful retry execution does not mean revenue is recovered. Only webhook-verified outcomes update recovery state.
3. **Merchant isolation** — Every query is scoped by `merchantId`. No cross-tenant data leakage.
4. **Simulation isolation** — Synthetic data runs in the same pipeline but is flagged as demo-only.

### Data Flow

```
Payment Event (webhook/API)
  → Revenue Leakage Detection
    → Recovery Opportunity (OPEN)
      → Deterministic Decision Engine
        → AI Advisory (optional, non-binding)
          → Safety Gate (evaluateExecutionSafety)
            → Recovery Execution (if approved)
              → Webhook Verification
                → Recovery State Update
```

### Safety Model

The safety gate enforces:
- **DO_NOT_RETRY** for hard decline codes (fraud, Do Not Honor)
- **REVIEW** for low-confidence decisions or excessive retry counts
- **RETRY** only when all policy checks pass
- AI can suggest but never bypass the gate

## Tech Stack

| Layer | Technology |
|-------|-----------|
| API | Fastify 5, TypeScript, Prisma 6.12 |
| Database | PostgreSQL 16 |
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4 |
| Decision Engine | Deterministic (pure function) |
| AI Advisory | OpenAI-compatible API (opt-in) |
| Testing | Vitest |
| CI | GitHub Actions |

## Modules

- **Revenue Leakage Detection** — Rule-based correlation of payment failures
- **Recovery Intelligence** — Decision engine with confidence scoring
- **AI Advisory** — LLM-powered context analysis (non-binding)
- **Recovery Execution** — Provider-agnostic retry orchestration
- **Recovery Operations** — Scheduler, idempotency, reconciliation
- **Merchant Memory** — Per-merchant strategy learning
- **Simulation** — Synthetic data generation and replay
- **Judge Mode** — Scenario-based evaluation harness
- **Dashboard** — Real-time KPIs and activity feed

## API Routes

| Route | Description |
|-------|-------------|
| `GET /health` | Liveness probe |
| `GET /ready` | Readiness probe (DB connectivity) |
| `POST /webhooks/razorpay` | Webhook ingestion |
| `GET /dashboard/overview` | Dashboard aggregation |
| `POST /demo/run/:scenario` | Demo scenario execution |
| `POST /judge/start` | Judge mode scenario |
| `POST /simulation/run` | Synthetic event replay |

## Deployment

See `docker-compose.yml` for container orchestration. The stack runs three services:

1. **db** — PostgreSQL 16 with persistent volume
2. **api** — Fastify API server (port 4000)
3. **web** — Next.js frontend (port 3000)

Environment configuration is documented in `.env.example`.
