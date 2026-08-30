import type { RecoveryOpportunityRow } from './recovery-opportunity.js';
import { z } from 'zod';

/**
 * Operational urgency band derived from the decision score (Phase 4).
 * Mirrors the DecisionPriority enum in prisma/schema.prisma.
 *
 * Bands: 0–19 VERY_LOW · 20–39 LOW · 40–59 MEDIUM · 60–79 HIGH · 80–100 CRITICAL
 */
export const DECISION_PRIORITIES = [
  'VERY_LOW',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const;
export type DecisionPriority = (typeof DECISION_PRIORITIES)[number];

/**
 * Controlled vocabulary of recommendations produced by the decision engine.
 * Mirrors the RecommendedAction enum in prisma/schema.prisma.
 *
 * Phase 4 is a DECISION layer only — nothing here executes payments,
 * retries or customer messaging. Actions describe what an operator (or a
 * future orchestration phase) should consider doing next.
 */
export const RECOMMENDED_ACTIONS = [
  'RETRY',
  'WAIT',
  'CUSTOMER_ACTION_REQUIRED',
  'DO_NOT_RETRY',
  'REVIEW',
  'NO_ACTION',
] as const;
export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];

/**
 * Safety/quality flags attached to a decision. Every flag carries its own
 * explanation so the dashboard can show WHY a flag was raised.
 */
export const DECISION_RISK_FLAGS = [
  'NON_RECOVERABLE_CONDITION',
  'INSUFFICIENT_HISTORICAL_DATA',
  'MISSING_FAILURE_CODE',
  'HIGH_RETRY_COUNT',
  'CONFLICTING_EVIDENCE',
] as const;
export type DecisionRiskFlag = (typeof DECISION_RISK_FLAGS)[number];

/** A structured, explainable scoring factor. */
export interface DecisionFactor {
  /** Stable machine name, e.g. `value`, `recency`, `recoverability`. */
  name: string;
  /** Points contributed to the score (already weighted). */
  contribution: number;
  /** The raw observed value behind the factor, JSON-safe (null when unobserved). */
  value: string | number | boolean | null;
  /** Human-readable explanation of how the contribution was derived. */
  explanation: string;
}

export interface DecisionRiskFlagDetail {
  flag: DecisionRiskFlag;
  explanation: string;
}

/**
 * Failure category derived deterministically from the provider error code
 * recorded in the opportunity evidence. Unmapped codes stay UNKNOWN — the
 * engine never guesses a category it cannot support.
 */
export const FAILURE_CATEGORIES = [
  'TRANSIENT',
  'INSUFFICIENT_FUNDS',
  'AUTHENTICATION',
  'HARD_DECLINE',
  'UNKNOWN',
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/**
 * Features available to the decision engine. Every field reflects data that
 * was actually observed; unobserved data is null — never fabricated.
 */
export interface DecisionFeatures {
  /** Minor currency units (paise for INR), copied from the opportunity. */
  recoverableAmount: number;
  currency: string;
  /** Milliseconds between detection and evaluation (explicitly passed in). */
  opportunityAgeMs: number;
  /**
   * Explicit reference timestamp (epoch ms) for all recency math. The engine
   * never reads the clock — determinism requires time to be injected.
   */
  evaluatedAtMs: number;
  /**
   * Distinct FAILED payment events (other than the source event) observed for
   * the same payment/order identity after the source event.
   */
  observedFailedRetries: number;
  /** Timestamp of the most recent observed failed retry (null when none). */
  lastFailedRetryAt: Date | null;
  /** Category derived from the evidence failure code. */
  failureCategory: FailureCategory;
  /** Raw provider failure code from the evidence (null when absent). */
  failureCode: string | null;
  /** Current lifecycle state of the opportunity (drives the NO_ACTION rule). */
  opportunityStatus: RecoveryOpportunityRow['status'];
  /**
   * Historical outcomes for this opportunity type across ALL merchants.
   * null when no usable statistics exist yet (the engine must not pretend).
   */
  historicalOutcomes: { sampleSize: number; recoveredCount: number } | null;
}

/** Pure engine output. Persistence happens outside the engine. */
export interface RecoveryDecisionResult {
  /** 0–100 operational priority score (weighted transparent factors). */
  score: number;
  priority: DecisionPriority;
  /**
   * 0–100 confidence in the RECOMMENDATION's meaningfulness — NOT a success
   * probability. Low confidence ⇒ the engine prefers REVIEW.
   */
  confidence: number;
  recommendedAction: RecommendedAction;
  reasons: string[];
  factors: DecisionFactor[];
  riskFlags: DecisionRiskFlagDetail[];
}

/** Persisted shape of a recovery_decisions row. */
export interface RecoveryDecisionRow {
  id: string;
  merchantId: string | null;
  opportunityId: string;
  engineVersion: string;
  score: number;
  priority: DecisionPriority;
  confidence: number;
  recommendedAction: RecommendedAction;
  reasons: string[];
  factors: DecisionFactor[];
  riskFlags: DecisionRiskFlagDetail[];
  evaluatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Data required to persist a decision. */
export interface NewRecoveryDecisionData {
  merchantId: string | null;
  opportunityId: string;
  engineVersion: string;
  score: number;
  priority: DecisionPriority;
  confidence: number;
  recommendedAction: RecommendedAction;
  reasons: string[];
  factors: DecisionFactor[];
  riskFlags: DecisionRiskFlagDetail[];
  evaluatedAt: Date;
}

/** Aggregate counters powering the decisions overview (per merchant scope). */
export interface DecisionsOverviewMetrics {
  criticalCount: number;
  highCount: number;
  recommendedRetries: number;
  reviewRequired: number;
  doNotRetry: number;
  /** Average confidence across stored decisions; null when none exist. */
  averageConfidence: number | null;
}

/**
 * Persistence boundary for recovery decisions. Implemented by the Prisma
 * adapter in repositories/prisma-stores.ts.
 *
 * One row per (opportunity_id, engine_version); re-evaluation UPSERTS the row
 * so the stored decision always reflects the engine's CURRENT assessment for
 * that version. Full append-only decision history is a future extension.
 */
export interface RecoveryDecisionStore {
  upsert(data: NewRecoveryDecisionData): Promise<RecoveryDecisionRow>;
  findById(id: string): Promise<RecoveryDecisionRow | null>;
  findByOpportunityAndEngineVersion(
    opportunityId: string,
    engineVersion: string
  ): Promise<RecoveryDecisionRow | null>;
  findLatestByOpportunityIds(opportunityIds: readonly string[]): Promise<RecoveryDecisionRow[]>;
  listAll(args: { merchantId?: string }): Promise<RecoveryDecisionRow[]>;
  countByPriority(priority: DecisionPriority, merchantId?: string): Promise<number>;
  countByRecommendedAction(action: RecommendedAction, merchantId?: string): Promise<number>;
  averageConfidence(merchantId?: string): Promise<number | null>;
}

export const decisionParamsSchema = z.object({
  id: z.string().uuid(),
});

export const decisionsOverviewQuerySchema = z
  .object({
    merchantId: z.string().uuid().optional(),
  })
  .strict();

export type DecisionsOverviewQuery = z.infer<typeof decisionsOverviewQuerySchema>;
