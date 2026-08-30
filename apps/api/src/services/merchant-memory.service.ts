import type {
  MerchantMemoryEvidence,
  MerchantMemoryOverview,
  MerchantMemoryStrategy,
  MerchantStrategyMemoryStore,
} from '../domain/merchant-memory.js';
import type { RecoveryDecisionRow } from '../domain/recovery-decision.js';
import type { RecoveryOpportunityRow } from '../domain/recovery-opportunity.js';
import type { RecoveryExecutionRow } from '../domain/recovery-execution.js';

/**
 * MerchantMemoryService — Phase 11.
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
export class MerchantMemoryService {
  constructor(private readonly store: MerchantStrategyMemoryStore) {}

  /**
   * Record a verified recovery outcome into merchant memory.
   * Called ONLY after outcome verification — never before.
   *
   * @param merchantId - Merchant who owns the recovery
   * @param strategy - Strategy that was used
   * @param failureType - Failure category that triggered the opportunity
   * @param outcome - Whether the recovery succeeded
   * @param amountAtRisk - Amount that was at risk
   * @param recoveredAmount - Amount recovered (0 if failed)
   */
  async recordOutcome(
    merchantId: string,
    strategy: string,
    failureType: string,
    outcome: 'success' | 'failure',
    amountAtRisk: number,
    recoveredAmount: number
  ): Promise<void> {
    const existing = await this.store.findByMerchantAndStrategy(
      merchantId,
      strategy as MerchantMemoryStrategy,
      failureType
    );

    const now = new Date();
    const attempts = (existing?.attempts ?? 0) + 1;
    const successes = (existing?.successes ?? 0) + (outcome === 'success' ? 1 : 0);
    const failures = (existing?.failures ?? 0) + (outcome === 'failure' ? 1 : 0);
    const totalAmountAttempted =
      (existing?.totalAmountAttempted ?? 0) + amountAtRisk;
    const totalAmountRecovered =
      (existing?.totalAmountRecovered ?? 0) + recoveredAmount;

    const successRate = attempts > 0 ? successes / attempts : 0;
    const recoveryRate =
      totalAmountAttempted > 0 ? totalAmountRecovered / totalAmountAttempted : 0;
    const sampleCount = attempts;

    const effectivenessScore = this.calculateEffectivenessScore(
      successRate,
      recoveryRate,
      sampleCount
    );
    const confidence = this.calculateConfidence(sampleCount);

    await this.store.upsert({
      merchantId,
      strategy: strategy as MerchantMemoryStrategy,
      failureType,
    });

    // Update the fields via the store's internal update mechanism
    // We need to re-fetch and update since upsert only creates
    const updated = await this.store.findByMerchantAndStrategy(
      merchantId,
      strategy as MerchantMemoryStrategy,
      failureType
    );
    if (updated !== null) {
      // Use a raw update through the store
      await this.store.updateMetrics(updated.id, {
        attempts,
        successes,
        failures,
        blocked: existing?.blocked ?? 0,
        humanReviews: existing?.humanReviews ?? 0,
        totalAmountAttempted,
        totalAmountRecovered,
        successRate,
        recoveryRate,
        sampleCount,
        confidence,
        effectivenessScore,
        lastObservedAt: now,
      });
    }
  }

  /**
   * Record that an execution was blocked (DO_NOT_RETRY / NO_ACTION).
   * This is a negative outcome that should influence strategy effectiveness.
   */
  async recordBlocked(
    merchantId: string,
    strategy: string,
    failureType: string
  ): Promise<void> {
    const existing = await this.store.findByMerchantAndStrategy(
      merchantId,
      strategy as MerchantMemoryStrategy,
      failureType
    );
    if (existing === null) {
      await this.store.upsert({
        merchantId,
        strategy: strategy as MerchantMemoryStrategy,
        failureType,
      });
    }
    const updated = await this.store.findByMerchantAndStrategy(
      merchantId,
      strategy as MerchantMemoryStrategy,
      failureType
    );
    if (updated !== null) {
      await this.store.updateMetrics(updated.id, {
        blocked: updated.blocked + 1,
      });
    }
  }

  /**
   * Record that an execution required human review.
   */
  async recordHumanReview(
    merchantId: string,
    strategy: string,
    failureType: string
  ): Promise<void> {
    const existing = await this.store.findByMerchantAndStrategy(
      merchantId,
      strategy as MerchantMemoryStrategy,
      failureType
    );
    if (existing === null) {
      await this.store.upsert({
        merchantId,
        strategy: strategy as MerchantMemoryStrategy,
        failureType,
      });
    }
    const updated = await this.store.findByMerchantAndStrategy(
      merchantId,
      strategy as MerchantMemoryStrategy,
      failureType
    );
    if (updated !== null) {
      await this.store.updateMetrics(updated.id, {
        humanReviews: updated.humanReviews + 1,
      });
    }
  }

  /**
   * Get merchant memory overview for display.
   */
  async getOverview(merchantId: string): Promise<MerchantMemoryOverview> {
    return this.store.getOverview(merchantId);
  }

  /**
   * Get evidence for AI decision context.
   */
  async getEvidenceForAI(merchantId: string): Promise<MerchantMemoryEvidence> {
    return this.store.getEvidenceForAI(merchantId);
  }

  /**
   * Calculate effectiveness score from success rate, recovery rate, and sample count.
   * Higher scores indicate better historical performance for this strategy.
   */
  calculateEffectivenessScore(
    successRate: number,
    recoveryRate: number,
    sampleCount: number
  ): number {
    // Base score from success rate (0-60)
    const baseScore = successRate * 60;

    // Recovery rate bonus (0-30)
    const recoveryBonus = recoveryRate * 30;

    // Sample size confidence bonus (0-10)
    // Sigmoid-like function: 0 at sample 0, ~5 at sample 10, ~9 at sample 50, approaching 10
    const sampleBonus = 10 * (1 - Math.exp(-sampleCount / 20));

    return Math.round(Math.min(100, baseScore + recoveryBonus + sampleBonus) * 10) / 10;
  }

  /**
   * Calculate confidence level based on sample count.
   * Returns 0-100 confidence score.
   */
  calculateConfidence(sampleCount: number): number {
    // Sigmoid-like confidence curve
    // 0 samples → 0 confidence
    // 5 samples → ~20
    // 10 samples → ~40
    // 20 samples → ~60 (threshold for "sufficient")
    // 50 samples → ~85
    // 100+ samples → approaches 100
    if (sampleCount === 0) return 0;
    if (sampleCount >= 100) return 95;
    return Math.round(95 * (1 - Math.exp(-sampleCount / 25)));
  }

  /**
   * Clear all merchant memory (used during demo reset).
   */
  async clearAll(merchantId: string): Promise<number> {
    return this.store.deleteByMerchant(merchantId);
  }

  /**
   * Process a completed execution and update merchant memory accordingly.
   * This is the main integration point for the outcome → memory pipeline.
   */
  async processExecutionOutcome(
    merchantId: string,
    decision: RecoveryDecisionRow,
    opportunity: RecoveryOpportunityRow,
    execution: RecoveryExecutionRow
  ): Promise<void> {
    const strategy = decision.recommendedAction as MerchantMemoryStrategy;
    const failureType = opportunity.reason;

    if (
      execution.status === 'SUCCEEDED'
    ) {
      await this.recordOutcome(
        merchantId,
        strategy,
        failureType,
        'success',
        opportunity.amountAtRisk,
        opportunity.amountAtRisk
      );
    } else if (execution.status === 'FAILED') {
      await this.recordOutcome(
        merchantId,
        strategy,
        failureType,
        'failure',
        opportunity.amountAtRisk,
        0
      );
    } else if (execution.status === 'BLOCKED') {
      await this.recordBlocked(merchantId, strategy, failureType);
    }
  }
}
