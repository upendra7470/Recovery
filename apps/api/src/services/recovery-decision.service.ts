import type { PaymentEventRow, PaymentEventStore } from '../domain/payment-event.js';
import type {
  DecisionFeatures,
  RecoveryDecisionRow,
} from '../domain/recovery-decision.js';
import type { RecoveryOpportunityRow } from '../domain/recovery-opportunity.js';
import type { DetectionWindowConfig } from '../detection/detection-rule.js';
import { toEventView } from '../detection/event-view.js';
import {
  DECISION_ENGINE_VERSION,
  DeterministicDecisionEngine,
} from '../decision/engine.js';
import { extractDecisionFeatures } from '../decision/features.js';
import type { RecoveryDecisionRepository } from '../repositories/recovery-decision.repository.js';
import type { RecoveryOpportunityRepository } from '../repositories/recovery-opportunity.repository.js';

export interface EvaluationOutcome {
  opportunityId: string;
  status: 'evaluated' | 'not-found';
  decision: RecoveryDecisionRow | null;
}

/**
 * Orchestration for the intelligent recovery decision engine.
 *
 * Flow: persisted opportunity → correlated retry observation → feature
 * extraction → deterministic engine → persist (upsert). The engine itself is
 * pure; this service owns I/O and the evaluation timestamp. Decisions are
 * attributed only from the stored opportunity (tenant isolation) inside the
 * repository.
 */
export class RecoveryDecisionService {
  private readonly engine = new DeterministicDecisionEngine();

  constructor(
    private readonly opportunities: RecoveryOpportunityRepository,
    private readonly decisions: RecoveryDecisionRepository,
    private readonly paymentEvents: PaymentEventStore,
    private readonly config: DetectionWindowConfig
  ) {}

  /**
   * Evaluate an opportunity NOW and persist the result (upsert per engine
   * version). `evaluatedAt` defaults to wall-clock time here at the boundary;
   * the engine receives it explicitly and stays deterministic.
   */
  async evaluateForOpportunity(
    opportunityId: string,
    evaluatedAt: Date = new Date()
  ): Promise<EvaluationOutcome> {
    const opportunity = await this.opportunities.findById(opportunityId);
    if (opportunity === null) {
      return { opportunityId, status: 'not-found', decision: null };
    }

    const features = await this.extractFeatures(opportunity, evaluatedAt);
    const result = this.engine.evaluate(features);

    const decision = await this.decisions.persistResult({
      opportunity,
      result,
      engineVersion: this.engine.version,
      evaluatedAt,
    });

    return { opportunityId, status: 'evaluated', decision };
  }

  /**
   * Stored decision for an opportunity, evaluated lazily on first read and
   * re-evaluated when the opportunity changed after the last evaluation
   * (staleness check via opportunity.updatedAt — no background workers in
   * Phase 4).
   */
  async getForOpportunity(
    opportunityId: string,
    now: Date = new Date()
  ): Promise<EvaluationOutcome> {
    const opportunity = await this.opportunities.findById(opportunityId);
    if (opportunity === null) {
      return { opportunityId, status: 'not-found', decision: null };
    }

    const existing = await this.decisions.findByOpportunityAndEngineVersion(
      opportunityId,
      DECISION_ENGINE_VERSION
    );

    // Fresh only when evaluated STRICTLY after the last opportunity change.
    // On equal timestamps (same-millisecond mutations) we re-evaluate — it is
    // deterministic and cheap, whereas serving a stale decision would be wrong.
    if (existing !== null && existing.evaluatedAt > opportunity.updatedAt) {
      return { opportunityId, status: 'evaluated', decision: existing };
    }

    return this.evaluateForOpportunity(opportunityId, now);
  }

  overviewMetrics(merchantId?: string) {
    return this.decisions.overviewMetrics(merchantId);
  }

  findDecisionById(id: string) {
    return this.decisions.findById(id);
  }

  /**
   * Opportunity + extracted features for downstream consumers (e.g. the AI
   * advisor's minimized input). Reuses the same deterministic extraction the
   * scoring pipeline uses; returns null when the opportunity does not exist.
   */
  async featuresForOpportunity(
    opportunityId: string
  ): Promise<{ opportunity: RecoveryOpportunityRow; features: DecisionFeatures } | null> {
    const opportunity = await this.opportunities.findById(opportunityId);
    if (opportunity === null) {
      return null;
    }
    const features = await this.extractFeatures(opportunity, new Date());
    return { opportunity, features };
  }

  /** Batch convenience: evaluate many opportunities in order. */
  async evaluateMany(opportunityIds: readonly string[]): Promise<EvaluationOutcome[]> {
    const outcomes: EvaluationOutcome[] = [];
    for (const id of opportunityIds) {
      outcomes.push(await this.evaluateForOpportunity(id));
    }
    return outcomes;
  }

  private async extractFeatures(
    opportunity: RecoveryOpportunityRow,
    evaluatedAt: Date
  ): Promise<DecisionFeatures> {
    const stats = await this.opportunities.outcomeStatsByType(opportunity.type);
    const historicalOutcomes =
      stats.total > 0
        ? { sampleSize: stats.total, recoveredCount: stats.recovered }
        : null;

    const sourceEvent = await this.paymentEvents.findById(opportunity.sourceEventId);
    // Without the source event we cannot observe retries; extraction degrades
    // honestly to "no retries observed" rather than fabricating history.
    if (sourceEvent === null) {
      return extractDecisionFeatures({
        opportunity,
        failedRetriesAfterSource: [],
        historicalOutcomes,
        evaluatedAt,
      });
    }

    const view = toEventView(sourceEvent);
    let related: PaymentEventRow[] = [];
    if (view.providerPaymentId !== null || view.providerOrderId !== null) {
      related = await this.paymentEvents.findRelatedByOrderOrPayment({
        providerPaymentId: view.providerPaymentId,
        providerOrderId: view.providerOrderId,
        occurredAfter: new Date(view.occurredAt.getTime() + 1),
        occurredBefore: evaluatedAt,
      });
    }

    const failedRetriesAfterSource = related.filter(
      (row) => row.eventType === 'payment.failed' && row.id !== sourceEvent.id
    );

    return extractDecisionFeatures({
      opportunity,
      failedRetriesAfterSource,
      historicalOutcomes,
      evaluatedAt,
    });
  }
}
