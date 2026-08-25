import type {
  DecisionsOverviewMetrics,
  NewRecoveryDecisionData,
  DecisionPriority,
  RecommendedAction,
  RecoveryDecisionRow,
  RecoveryDecisionStore,
} from '../domain/recovery-decision.js';
import type { RecoveryOpportunityRow } from '../domain/recovery-opportunity.js';

/**
 * Persistence facade for recovery decisions.
 *
 * Decisions are attributed (merchant/account) exclusively from the persisted
 * opportunity row — tenant isolation can never be bypassed by engine output.
 * Uniqueness on (opportunity_id, engine_version) makes re-evaluation an
 * upsert; concurrent evaluations converge to one row per version.
 */
export class RecoveryDecisionRepository {
  constructor(private readonly store: RecoveryDecisionStore) {}

  async persistResult(args: {
    opportunity: Pick<RecoveryOpportunityRow, 'id' | 'merchantId'>;
    result: {
      score: number;
      priority: RecoveryDecisionRow['priority'];
      confidence: number;
      recommendedAction: RecoveryDecisionRow['recommendedAction'];
      reasons: string[];
      factors: NewRecoveryDecisionData['factors'];
      riskFlags: NewRecoveryDecisionData['riskFlags'];
    };
    engineVersion: string;
    evaluatedAt: Date;
  }): Promise<RecoveryDecisionRow> {
    const data: NewRecoveryDecisionData = {
      // Attribution flows ONLY from the persisted opportunity (tenant isolation).
      merchantId: args.opportunity.merchantId,
      opportunityId: args.opportunity.id,
      engineVersion: args.engineVersion,
      score: args.result.score,
      priority: args.result.priority,
      confidence: args.result.confidence,
      recommendedAction: args.result.recommendedAction,
      reasons: [...args.result.reasons],
      factors: args.result.factors.map((factor) => ({ ...factor })),
      riskFlags: args.result.riskFlags.map((flag) => ({ ...flag })),
      evaluatedAt: args.evaluatedAt,
    };
    return this.store.upsert(data);
  }

  findByOpportunityAndEngineVersion(
    opportunityId: string,
    engineVersion: string
  ): Promise<RecoveryDecisionRow | null> {
    return this.store.findByOpportunityAndEngineVersion(opportunityId, engineVersion);
  }

  findLatestByOpportunityIds(
    opportunityIds: readonly string[]
  ): Promise<RecoveryDecisionRow[]> {
    return this.store.findLatestByOpportunityIds(opportunityIds);
  }

  /**
   * Aggregate counters for dashboard metrics.
   *
   * NOTE: with only one engine version deployed, unversioned aggregates are
   * exact. When a second engine version ever ships, these queries must become
   * version-scoped (or restricted to the latest version per opportunity) so
   * rows are never double-counted across versions.
   */
  async overviewMetrics(merchantId?: string): Promise<DecisionsOverviewMetrics> {
    const [criticalCount, highCount, recommendedRetries, reviewRequired, doNotRetry, averageConfidence] =
      await Promise.all([
        this.store.countByPriority('CRITICAL', merchantId),
        this.store.countByPriority('HIGH', merchantId),
        this.store.countByRecommendedAction('RETRY', merchantId),
        this.store.countByRecommendedAction('REVIEW', merchantId),
        this.store.countByRecommendedAction('DO_NOT_RETRY', merchantId),
        this.store.averageConfidence(merchantId),
      ]);
    return {
      criticalCount,
      highCount,
      recommendedRetries,
      reviewRequired,
      doNotRetry,
      averageConfidence,
    };
  }

  countByPriority(priority: DecisionPriority, merchantId?: string): Promise<number> {
    return this.store.countByPriority(priority, merchantId);
  }

  countByRecommendedAction(action: RecommendedAction, merchantId?: string): Promise<number> {
    return this.store.countByRecommendedAction(action, merchantId);
  }
}
