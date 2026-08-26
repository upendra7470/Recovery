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
import {
  aiAdviceParamsSchema,
  type RecoveryAIAdviceRow,
} from '../domain/recovery-ai-advice.js';

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
export interface DecisionSummaryForAIResponse {
  engineVersion: string;
  score: number;
  priority: RecoveryDecisionRow['priority'];
  confidence: number;
  recommendedAction: RecoveryDecisionRow['recommendedAction'];
  riskFlags: DecisionRiskFlagDetail[];
}

export interface AIAdviceAvailableResponse {
  status: 'available';
  provider: string;
  model: string;
  advisorVersion: string;
  promptVersion: string;
  summary: string;
  explanation: string;
  nextStep: string;
  customerMessage: string | null;
  operatorMessage: string | null;
  /** Model self-reported confidence — never mixed with deterministic confidence. */
  confidence: number;
  warnings: string[];
  safetyConstrained: boolean;
  /** First generation time of this advice row. */
  generatedAt: string;
  /** Last refresh time (changes when a stale decision triggers regeneration). */
  refreshedAt: string;
}

export interface AIAdviceUnavailableStateResponse {
  status: 'unavailable';
  reason: string;
  message: string;
}

export interface AIAdviceDisabledStateResponse {
  status: 'disabled';
  message: string;
}

export type AIAdviceStateResponse =
  | AIAdviceAvailableResponse
  | AIAdviceUnavailableStateResponse
  | AIAdviceDisabledStateResponse;

export interface AIAdviceResponse {
  opportunityId: string;
  decision: DecisionSummaryForAIResponse;
  ai: AIAdviceStateResponse;
}

const UNAVAILABLE_MESSAGES: Record<string, string> = {
  timeout: 'AI assistance timed out. The deterministic recovery decision remains valid.',
  rate_limited:
    'AI assistance is temporarily rate limited. The deterministic recovery decision remains valid.',
  provider_error:
    'AI assistance is temporarily unavailable. The deterministic recovery decision remains valid.',
  network_error:
    'AI assistance is unreachable right now. The deterministic recovery decision remains valid.',
  invalid_response: 'The AI response could not be validated. The deterministic recovery decision remains valid.',
};

function toDecisionSummary(decision: RecoveryDecisionRow): DecisionSummaryForAIResponse {
  return {
    engineVersion: decision.engineVersion,
    score: decision.score,
    priority: decision.priority,
    confidence: decision.confidence,
    recommendedAction: decision.recommendedAction,
    riskFlags: decision.riskFlags.map((flag) => ({ ...flag })),
  };
}

function toAvailableAI(advice: RecoveryAIAdviceRow): AIAdviceAvailableResponse {
  return {
    status: 'available',
    provider: advice.provider,
    model: advice.model,
    advisorVersion: advice.advisorVersion,
    promptVersion: advice.promptVersion,
    summary: advice.summary,
    explanation: advice.explanation,
    nextStep: advice.nextStep,
    customerMessage: advice.customerMessage,
    operatorMessage: advice.operatorMessage,
    confidence: advice.confidence,
    warnings: [...advice.warnings],
    safetyConstrained: advice.safetyConstrained,
    generatedAt: advice.createdAt.toISOString(),
    refreshedAt: advice.updatedAt.toISOString(),
  };
}

/**
 * Advisory AI intelligence for one opportunity (Phase 5). The authoritative
 * deterministic decision is ALWAYS included; the AI section degrades to an
 * explicit disabled/unavailable state instead of failing the request.
 * Provider errors and secrets are never exposed.
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

  app.get<{ Params: { id: string }; Reply: AIAdviceResponse }>(
    '/opportunities/:id/ai-advice',
    async (request, reply) => {
      const { id } = parseWith(aiAdviceParamsSchema, request.params);
      const outcome = await app.aiAdvisorService.getAdviceForOpportunity(id);
      if (outcome.status === 'not-found' || outcome.decision === null) {
        throw new NotFoundError('Recovery opportunity');
      }

      let ai: AIAdviceStateResponse;
      if (outcome.ai.status === 'available') {
        ai = toAvailableAI(outcome.ai.advice);
      } else if (outcome.ai.status === 'unavailable') {
        ai = {
          status: 'unavailable',
          reason: outcome.ai.reason,
          message:
            UNAVAILABLE_MESSAGES[outcome.ai.reason] ??
            'AI assistance is unavailable. The deterministic recovery decision remains valid.',
        };
      } else {
        ai = {
          status: 'disabled',
          message:
            'AI assistance is disabled. Deterministic recovery analysis remains active.',
        };
      }

      const body: AIAdviceResponse = {
        opportunityId: id,
        decision: toDecisionSummary(outcome.decision),
        ai,
      };
      return reply.send(body);
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
