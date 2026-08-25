import type { PaymentEventRow } from '../domain/payment-event.js';
import type {
  OpportunityEvidence,
  RecoveryOpportunityRow,
} from '../domain/recovery-opportunity.js';
import type { DecisionFeatures } from '../domain/recovery-decision.js';
import { categorizeFailureCode } from './failure-category.js';

/**
 * Deterministic feature extraction for the decision engine.
 *
 * Every value reflects data that was actually observed; unobserved data is
 * null/zero — never fabricated. The evaluation time is passed in explicitly
 * so extraction is reproducible in tests (no clock reads here). Callers pass
 * only failed events correlated to the same payment/order identity that
 * occurred AFTER the source event (retry semantics live at the call site).
 */
export function extractDecisionFeatures(args: {
  opportunity: RecoveryOpportunityRow;
  /** Failed events correlated to the same payment/order after the source event. */
  failedRetriesAfterSource: readonly PaymentEventRow[];
  historicalOutcomes: { sampleSize: number; recoveredCount: number } | null;
  evaluatedAt: Date;
}): DecisionFeatures {
  const { opportunity, failedRetriesAfterSource, historicalOutcomes, evaluatedAt } = args;

  const evidence = opportunity.evidence as Partial<OpportunityEvidence> | null;
  const failureCode = typeof evidence?.failureCode === 'string' ? evidence.failureCode : null;

  let lastFailedRetryAt: Date | null = null;
  for (const row of failedRetriesAfterSource) {
    if (lastFailedRetryAt === null || row.eventCreatedAt > lastFailedRetryAt) {
      lastFailedRetryAt = row.eventCreatedAt;
    }
  }

  return {
    recoverableAmount: opportunity.amountAtRisk,
    currency: opportunity.currency,
    opportunityAgeMs: Math.max(0, evaluatedAt.getTime() - opportunity.detectedAt.getTime()),
    evaluatedAtMs: evaluatedAt.getTime(),
    observedFailedRetries: failedRetriesAfterSource.length,
    lastFailedRetryAt,
    failureCategory: categorizeFailureCode(failureCode).category,
    failureCode,
    opportunityStatus: opportunity.status,
    historicalOutcomes,
  };
}
