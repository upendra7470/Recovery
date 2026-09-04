# RecoveryOS Demo Script

**Target Duration:** 3–5 minutes

---

## 0:00–0:30 — The Problem

**Show:** Dashboard with revenue at risk metrics

**Say:**

> Every day, merchants lose revenue to payment failures — gateway timeouts, insufficient funds, expired cards, network errors. Most of these failures are recoverable, but merchants lack the intelligence to know which ones, and the safety to act on them responsibly.
>
> A payment failure isn't just a failed transaction. It's revenue at risk, and the merchant needs to know: can this be recovered? Should we retry? What happened last time we tried?

---

## 0:30–1:00 — RecoveryOS

**Show:** Architecture overview (or describe the pipeline)

**Say:**

> RecoveryOS is an AI-assisted revenue recovery orchestration layer. It detects payment failures, reasons about recovery opportunities, recommends strategies through AI advisory, and places a deterministic safety boundary between recommendations and executable actions.
>
> Here's how it works: a payment event comes in. RecoveryOS detects it as revenue at risk. It checks merchant memory for what's worked before. The decision engine scores the opportunity. AI provides contextual analysis. And then the safety policy decides — approve, block, or escalate to human review.

---

## 1:00–2:30 — Live Judge Mode

**Show:** Open `/judge`

**Say:**

> Let me show you how this works in practice.

**Action:**
1. Select "Payment Failure Storm" scenario
2. Set seed: 42, events: 200, merchants: 5
3. Click "Start Scenario"
4. Watch the progress bar and live metrics

**During execution, say:**

> RecoveryOS is now processing 200 synthetic payment events through the full pipeline. Each failure is being detected, evaluated, and either approved for recovery, blocked by safety policy, or escalated for human review.

**After completion, say:**

> The scenario completed in about 5 seconds. Let's look at the results.

---

## 2:30–3:30 — Intelligence & Safety

**Show:** Completed scenario results

**Point out:**

> **12 recovery opportunities** were detected from payment failures.
>
> **4 were approved** — these are cases where the failure type, retry count, and merchant history all indicated a safe recovery attempt.
>
> **8 were blocked** — the safety policy determined these were either hard declines, excessive retries, or high-risk cases that should not be retried automatically.
>
> **4 verified recoveries** — RecoveryOS only counts revenue as recovered after the outcome has been verified against actual payment capture events.

**Show one approved case:**

> Here's an approved case: the failure was a gateway timeout, the merchant has a history of successful retries for this failure type, and the confidence score was above the threshold. The safety policy approved it, execution was dispatched, and the payment was captured.

**Show one blocked case:**

> Here's a blocked case: the failure code indicates a hard decline — possibly fraud or Do Not Honor. The safety policy correctly blocked this, because retrying a hard decline wastes resources and risks customer trust.

---

## 3:30–4:15 — Verification

**Show:** Dashboard with recovered revenue

**Say:**

> This is the key differentiator: RecoveryOS does not treat execution acceptance as recovery. A retry being "accepted" doesn't mean money was captured.
>
> RecoveryOS verifies the actual payment capture event, matches it to the original recovery attempt, and only then updates the recovery ledger. Only verified, persisted outcomes are counted as recovered revenue.
>
> This means when RecoveryOS says "₹6,71,335 recovered," that number comes from actual verified outcomes — not frontend calculations.

---

## 4:15–5:00 — Differentiation

**Show:** Architecture or merchant memory page

**Say:**

> RecoveryOS is not just a payment retry system. It combines:
>
> - **Revenue risk detection** — understands which failures matter
> - **Merchant memory** — learns what works for each merchant
> - **AI advisory** — provides contextual analysis (but never executes)
> - **Deterministic safety** — enforces hard rules that AI cannot override
> - **Outcome verification** — proves recovery actually happened
> - **Recovery ledger** — maintains auditable records
> - **Simulation** — tests the full pipeline without real money
>
> The AI recommends. The safety policy decides. The verification proves it worked.
>
> That's RecoveryOS — an intelligence and safety layer for revenue recovery.

---

## Quick Reference: Key Numbers (from actual run)

| Metric | Value |
|--------|-------|
| Events processed | 200 |
| Opportunities detected | 12 |
| Executions attempted | 4 |
| Blocked by safety | 8 |
| Verified recoveries | 4 |
| Revenue at risk | ₹45,68,079 |
| Recoverable revenue | ₹6,71,335 |
| Recovered revenue | ₹6,71,335 |
| Recovery rate | 14.7% |
| Duration | ~5 seconds |

*Note: These are actual results from running the canonical scenario (seed 42, 200 events, 5 merchants). Do not fabricate different numbers.*
