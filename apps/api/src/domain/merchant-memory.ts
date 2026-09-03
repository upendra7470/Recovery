/**
 *  * Merchant Memory (Phase 11) — Adaptive Merchant Memory subsystem.
 *
 * Evidence-based, deterministic merchant-specific historical recovery data.
 * Memory is derived from actual recovery outcomes stored in PostgreSQL.
 * Memory is NEVER fabricated by AI — it reflects verified system outcomes only.
 *
 * Architectural boundary:
 *   AI DECISION → uses merchant memory as CONTEXT → recommends strategy
 *   SAFETY/POLICY → authorizes or blocks
 *   EXECUTION → provider interaction
 *   OUTCOME VERIFICATION → webhook-confirmed recovery
 *   MERCHANT MEMORY UPDATE ← only verified outcomes update memory
 */

/**
 * Strategy categories tracked in merchant memory.
 * Maps to the RecommendedAction values that represent actionable strategies.
 */
export const MERCHANT_MEMORY_STRATEGIES = [
  'RETRY',
  'PAYMENT_LINK',
  'ALTERNATE_METHOD',
  'REVIEW',
  'WAIT',
  'CUSTOMER_ACTION_REQUIRED',
  'DO_NOT_RETRY',
  'NO_ACTION',
] as const;
export type MerchantMemoryStrategy = (typeof MERCHANT_MEMORY_STRATEGIES)[number];

/** Persisted shape of a merchant_strategy_memory row. */
export interface MerchantStrategyMemoryRow {
  id: string;
  merchantId: string;
  strategy: MerchantMemoryStrategy;
  failureType: string;
  attempts: number;
  successes: number;
  failures: number;
  blocked: number;
  humanReviews: number;
  totalAmountAttempted: number;
  totalAmountRecovered: number;
  successRate: number;
  recoveryRate: number;
  sampleCount: number;
  confidence: number;
  effectivenessScore: number;
  lastObservedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Data required to create or update a merchant strategy memory row. */
export interface NewMerchantStrategyMemoryData {
  merchantId: string;
  strategy: MerchantMemoryStrategy;
  failureType: string;
}

/** Aggregated merchant memory overview. */
export interface MerchantMemoryOverview {
  merchantId: string;
  totalOutcomes: number;
  totalRecovered: number;
  totalAmountRecovered: number;
  recoveryRate: number;
  bestStrategy: MerchantMemoryStrategy | null;
  bestStrategySuccessRate: number;
  strategies: MerchantStrategyMemoryRow[];
  failurePatterns: MerchantFailurePatternSummary[];
  confidence: 'NO_DATA' | 'LOW' | 'SUFFICIENT';
  lastObservedAt: Date | null;
}

/** Failure pattern summary for a specific failure type. */
export interface MerchantFailurePatternSummary {
  failureType: string;
  attempts: number;
  successes: number;
  recoveryRate: number;
  bestStrategy: MerchantMemoryStrategy | null;
  bestStrategySuccessRate: number;
}

/** Memory evidence for AI decision context. */
export interface MerchantMemoryEvidence {
  merchantId: string;
  strategyPerformance: Array<{
    strategy: MerchantMemoryStrategy;
    failureType: string;
    attempts: number;
    successes: number;
    successRate: number;
    totalAmountRecovered: number;
    confidence: number;
  }>;
  overallRecoveryRate: number;
  totalOutcomes: number;
  confidenceLevel: 'NO_DATA' | 'LOW' | 'SUFFICIENT';
}

/** Partial metrics update for a merchant strategy memory row. */
export interface MerchantStrategyMemoryMetricsUpdate {
  attempts?: number;
  successes?: number;
  failures?: number;
  blocked?: number;
  humanReviews?: number;
  totalAmountAttempted?: number;
  totalAmountRecovered?: number;
  successRate?: number;
  recoveryRate?: number;
  sampleCount?: number;
  confidence?: number;
  effectivenessScore?: number;
  lastObservedAt?: Date;
}

/** Persistence boundary for merchant strategy memory. */
export interface MerchantStrategyMemoryStore {
  upsert(data: NewMerchantStrategyMemoryData): Promise<MerchantStrategyMemoryRow>;
  updateMetrics(id: string, metrics: MerchantStrategyMemoryMetricsUpdate): Promise<MerchantStrategyMemoryRow>;
  findById(id: string): Promise<MerchantStrategyMemoryRow | null>;
  findByMerchantAndStrategy(
    merchantId: string,
    strategy: MerchantMemoryStrategy,
    failureType: string
  ): Promise<MerchantStrategyMemoryRow | null>;
  listByMerchant(merchantId: string): Promise<MerchantStrategyMemoryRow[]>;
  getOverview(merchantId: string): Promise<MerchantMemoryOverview>;
  getEvidenceForAI(merchantId: string): Promise<MerchantMemoryEvidence>;
  deleteByMerchant(merchantId: string): Promise<number>;
}
