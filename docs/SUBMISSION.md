# RecoveryOS — Buildathon Submission

## Project Name

RecoveryOS

## One-Line Description

AI-assisted revenue recovery intelligence with deterministic safety boundaries for payment-first businesses.

## Problem

Payment failures silently drain merchant revenue. A failed UPI transaction, a declined card, a gateway timeout — each represents money left on the table. But merchants face a harder problem than just retries:

- Which failures are recoverable?
- When should you NOT retry?
- Did the recovery actually work?
- What worked before for this merchant?

Existing solutions are either blind retry logic (unsafe) or dashboards (detect but don't act). Neither provides intelligent, safe, verified recovery.

## Solution

RecoveryOS is a full-stack revenue recovery orchestration layer that:

1. **Detects** payment-related revenue leakage
2. **Understands** context through merchant memory and strategy ranking
3. **Decides** using a deterministic decision engine
4. **Advises** through AI (optional, non-binding)
5. **Enforces** deterministic safety policies
6. **Executes** approved recovery actions
7. **Verifies** outcomes against actual payment captures
8. **Learns** merchant-specific recovery patterns

## How It Works

```
Payment Failure
    ↓
Revenue Risk Detection
    ↓
Recovery Opportunity
    ↓
Merchant Memory + Strategy Ranking
    ↓
Deterministic Decision Engine
    ↓
AI Advisory (optional)
    ↓
Safety Policy Gate
    ↓
Approved / Blocked / Review
    ↓
Execution (if approved)
    ↓
Outcome Verification
    ↓
Recovery Ledger
    ↓
Merchant Memory Update
```

## Key Innovation

**AI as advisory, not authority.**

RecoveryOS uses AI to analyze payment failure context and recommend recovery strategies. But AI cannot execute financial actions directly. A deterministic safety gate sits between AI recommendations and executable actions, enforcing hard rules that no component — including AI — can override.

This means:
- AI can suggest a retry
- Safety policy decides whether the suggestion is executable
- If AI fails, the deterministic system remains fully operational

## AI Usage

- **Context Analysis** — AI analyzes payment failure patterns and merchant history
- **Strategy Recommendation** — AI suggests recovery strategies with confidence scores
- **Explanation Generation** — AI produces human-readable explanations for decisions
- **Non-binding** — AI output is advisory only; the deterministic engine makes final decisions
- **Graceful degradation** — System operates fully without AI (deterministic fallback)

## Safety

The deterministic safety policy enforces:

- `DO_NOT_RETRY` for hard decline codes (fraud, Do Not Honor)
- `REVIEW` for low-confidence decisions or excessive retry counts
- `RETRY` only when all policy checks pass
- Merchant isolation across all operations
- Idempotent execution (no duplicate recovery attempts)

AI cannot bypass, override, or disable these rules.

## Technical Architecture

- **API:** Fastify 5 + TypeScript + Prisma 6.12
- **Database:** PostgreSQL 16
- **Frontend:** Next.js 16 + React 19 + Tailwind CSS 4
- **Decision Engine:** Deterministic pure function
- **AI Advisory:** OpenAI-compatible (opt-in)
- **Testing:** Vitest (845 tests)
- **CI:** GitHub Actions
- **Deployment:** Docker, docker-compose

## Demo

**Scenario:** Payment Failure Storm (seed 42, 200 events, 5 merchants)

**Actual Results:**
- 12 recovery opportunities detected
- 4 approved by safety policy
- 8 blocked by safety policy
- 4 verified recoveries
- ₹6,71,335 recovered revenue
- ~5 seconds execution time

All metrics from actual RecoveryOS pipeline execution. No fabrication.

## Testing

- 845 tests passing (833 API + 12 Web)
- ESLint clean
- TypeScript clean (both workspaces)
- Production builds passing
- Prisma schema validated
- 0 high-severity dependency vulnerabilities
- Security scan clean (no secrets, no credentials)

## What We Built

- Full revenue detection pipeline (3 rules)
- Deterministic decision engine
- AI advisory layer (non-binding)
- Safety policy gate (non-overridable)
- Recovery execution (demo + Razorpay adapters)
- Outcome verification system
- Recovery ledger
- Merchant memory with strategy ranking
- 5 modular recovery types
- Synthetic dataset generator
- Event replay engine
- Simulation analytics
- Judge Mode (4 scenarios)
- Live Demo command center
- Merchant dashboard
- 14 API routes
- 14 frontend pages
- Docker deployment
- CI/CD pipeline

## Limitations

- **Synthetic Data** — Demo uses simulated payment events, not real transactions
- **Demo Execution** — Recovery in demo mode uses deterministic adapter (no real money)
- **No Production Deployment** — Buildathon demonstration, not production service
- **Single Provider** — Razorpay only (extensible via provider adapter)
- **AI Advisory** — AI provides analysis but does not make financial decisions

## Repository

- GitHub: [link]
- Tests: 845 passing
- Build: Clean
- Security: 0 vulnerabilities
- Documentation: README, Architecture, Demo Script, Submission
