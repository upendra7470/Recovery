import type { FastifyPluginAsync } from 'fastify';
import { NotFoundError } from '../lib/errors.js';
import { parseWith } from '../validation/parse.js';
import {
  DECISION_ENGINE_VERSION,
} from '../decision/engine.js';
import {
  decisionParamsSchema,
  decisionsOverviewQuerySchema,
  type DecisionFactor,
  type DecisionRiskFlagDetail,
  type RecoveryDecisionRow,
} from '../domain/recovery-decision.js';

export interface DecisionSummaryResponse {
  score: number;
  priority: RecoveryDecisionRow['priority'];
  confidence: number;
  recommendedAction: RecoveryDecisionRow['recommendedAction'];
}

/** Decision summary embedded in opportunity list items (additive field). */
export interface OpportunityDecisionSummaryResponse extends DecisionSummaryResponse {
  evaluatedAt: string;
}

export interface DecisionDetailResponse {
  opportunityId: string;
  engineVersion: string;
  score: number;
  priority: RecoveryDecisionRow['priority'];
  confidence: number;
  recommendedAction: RecoveryDecisionRow['recommendedAction'];
  reasons: string[];
  factors: DecisionFactor[];
  riskFlags: DecisionRiskFlagDetail[];
  evaluatedAt: string;
}

export interface DecisionsOverviewResponse {
  criticalOpportunities: number;
  highPriorityOpportunities: number;
  recommendedRetries: number;
  reviewRequired: number;
  doNotRetry: number;
  /** Average confidence across stored decisions; null when none exist. */
  averageConfidence: number | null;
  engineVersion: string;
}

function toDecisionDetail(decision: RecoveryDecisionRow): DecisionDetailResponse {
  return {
    opportunityId: decision.opportunityId,
    engineVersion: decision.engineVersion,
    score: decision.score,
    priority: decision.priority,
    confidence: decision.confidence,
    recommendedAction: decision.recommendedAction,
    reasons: [...decision.reasons],
    factors: decision.factors.map((factor) => ({ ...factor })),
    riskFlags: decision.riskFlags.map((flag) => ({ ...flag })),
    evaluatedAt: decision.evaluatedAt.toISOString(),
  };
}

/**
 * Read API for recovery decisions (Phase 4). The engine is deterministic and
 * every response carries the engine version plus structured explanations, so
 * historical decisions stay auditable.
 *
 * Tenant scoping: overview metrics honor the optional merchantId filter.
 * Per-opportunity decisions are addressed by opportunity id; callers that need
 * strict cross-tenant protection should scope through their own merchant
 * context once authentication lands (documented Phase 1 gap).
 */
export const decisionRoutes: FastifyPluginAsync = async (app) => {
  const service = app.decisionService;

  app.get<{ Params: { id: string }; Reply: DecisionDetailResponse }>(
    '/opportunities/:id/decision',
    async (request, reply) => {
      const { id } = parseWith(decisionParamsSchema, request.params);
      const outcome = await service.getForOpportunity(id);
      if (outcome.decision === null) {
        throw new NotFoundError('Recovery opportunity');
      }
      return reply.send(toDecisionDetail(outcome.decision));
    }
  );

  app.get<{ Querystring: Record<string, unknown>; Reply: DecisionsOverviewResponse }>(
    '/decisions/overview',
    async (request, reply) => {
      const query = parseWith(decisionsOverviewQuerySchema, request.query);
      const metrics = await service.overviewMetrics(query.merchantId);
      const body: DecisionsOverviewResponse = {
        criticalOpportunities: metrics.criticalCount,
        highPriorityOpportunities: metrics.highCount,
        recommendedRetries: metrics.recommendedRetries,
        reviewRequired: metrics.reviewRequired,
        doNotRetry: metrics.doNotRetry,
        averageConfidence: metrics.averageConfidence,
        engineVersion: DECISION_ENGINE_VERSION,
      };
      return reply.send(body);
    }
  );
};
