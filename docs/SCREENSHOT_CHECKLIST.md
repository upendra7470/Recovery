# RecoveryOS — Screenshot Checklist

Recommended screenshots for buildathon submission.

---

## Screenshot 1: Dashboard Overview

**Page:** `/`

**What should be visible:**
- Revenue at Risk, Recoverable Revenue, Recovered Revenue, Recovery Rate
- Recovery pipeline metrics (opportunities, approved, blocked, verified)
- Recent activity feed with actual recovery events

**Judge should understand:**
- RecoveryOS provides a real-time view of revenue recovery status
- Metrics come from actual persisted data, not frontend calculations

---

## Screenshot 2: Judge Mode — Scenario Selection

**Page:** `/judge`

**What should be visible:**
- Four scenario cards (Payment Failure Storm, Gateway Degradation, Mixed Recovery, Recovery Stress Test)
- Scenario descriptions, event counts, merchant counts, seed values
- Configuration panel (seed, events, merchants)

**Judge should understand:**
- RecoveryOS has reproducible, deterministic test scenarios
- Each scenario exercises different parts of the pipeline

---

## Screenshot 3: Judge Mode — In Progress

**Page:** `/judge` (during execution)

**What should be visible:**
- Progress bar with percentage
- Live metrics: Revenue at Risk, Opportunities, Approved, Blocked
- Event count progress

**Judge should understand:**
- RecoveryOS processes events in real time through the full pipeline
- Safety decisions (approved/blocked) happen during execution

---

## Screenshot 4: Judge Mode — Completed Results

**Page:** `/judge` (after completion)

**What should be visible:**
- Summary banner with total events, revenue at risk, recovered revenue, recovery rate
- Detailed metrics: opportunities, approved, blocked, verified recoveries
- Pipeline and safety breakdown
- Recent recovery events

**Judge should understand:**
- Actual results from running the scenario
- Safety policy blocked some recoveries (demonstrating safety boundary)
- Only verified recoveries counted as recovered revenue

---

## Screenshot 5: Safety & Decision Evidence

**Page:** `/judge` (completed) or `/recovery-cases/[id]`

**What should be visible:**
- One approved case: RETRY → SUCCEEDED
- One blocked case: DO_NOT_RETRY or CUSTOMER_ACTION_REQUIRED → BLOCKED
- Decision explanation and safety outcome

**Judge should understand:**
- AI recommended, safety decided
- Different failure types get different safety outcomes
- Hard declines are correctly blocked

---

## Screenshot 6: Architecture Diagram

**Page:** `docs/architecture.md` (rendered)

**What should be visible:**
- Complete data flow from event ingestion to recovery ledger
- Safety gate with approved/blocked/review branches
- AI advisory layer (non-binding)
- Simulation flow (uses existing pipeline)

**Judge should understand:**
- The full system architecture
- Where AI sits (advisory only)
- Where safety sits (authoritative)
- How simulation works (no bypass)

---

## Capture Instructions

1. Start the application: `docker compose up --build` or `npm run dev`
2. Open http://localhost:3000
3. Navigate to each page listed above
4. For Judge Mode screenshots, run the canonical scenario first (seed 42, 200 events)
5. Use browser screenshot tool (Cmd+Shift+4 on Mac, or browser dev tools)
6. Capture at 1280x800 or 1920x1080 resolution
7. Ensure all text is readable
8. Ensure metrics are visible

**Do not fabricate screenshots.** Use actual running application state.
