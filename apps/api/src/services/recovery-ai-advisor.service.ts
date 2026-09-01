import { createHash } from 'node:crypto';
import type {
  AIAdviceUnavailableReason,
  AIAdvisorResult,
  NewRecoveryAIAdviceData,
  RecoveryAIAdviceRequest,
  RecoveryAIAdviceRow,
  RecoveryAIAdviceStore,
  RecoveryAIAdvisor,
} from '../domain/recovery-ai-advice.js';
import { decisionFingerprintParts } from '../domain/recovery-ai-advice.js';
import type { RecoveryDecisionRow } from '../domain/recovery-decision.js';
import { PROMPT_VERSION } from '../ai/prompt.js';
import { constrainAdvice } from '../ai/safety.js';
import type { RecoveryDecisionService } from './recovery-decision.service.js';

/**
 * Narrow structural logging boundary (satisfied by the Fastify/pino logger)
 * so this service stays decoupled from any concrete logging framework.
 */
export interface AILogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

/** How the AI layer answered for one opportunity. */
export type AIAdviceState =
  | { status: 'available'; advice: RecoveryAIAdviceRow }
  | { status: 'disabled' }
  | { status: 'unavailable'; reason: AIAdviceUnavailableReason };

export interface AIAdviceOutcome {
  opportunityId: string;
  status: 'evaluated' | 'not-found';
  /** The authoritative deterministic decision — always present when found. */
  decision: RecoveryDecisionRow | null;
  ai: AIAdviceState;
}

export interface AIAdvisorServiceConfig {
  enabled: boolean;
  provider: string;
  model: string;
  advisorVersion: string;
}

/**
 * Orchestrates advisory AI intelligence on top of the authoritative
 * deterministic decision.
 *
 * Guarantees:
 * - the deterministic decision is NEVER mutated by model output;
 * - any advisor/provider failure degrades to an explicit unavailable state;
 * - advice is cached per (decision fingerprint, advisor version, model) and
 *   regenerated only when the decision content actually changed;
 * - merchant attribution flows only from persisted opportunity data.
 */
export class RecoveryAIAdvisorService {
  constructor(
    private readonly decisionService: RecoveryDecisionService,
    private readonly adviceStore: RecoveryAIAdviceStore,
    private readonly advisor: RecoveryAIAdvisor | null,
    private readonly config: AIAdvisorServiceConfig,
    private readonly logger?: AILogger
  ) {}

  async getAdviceForOpportunity(
    opportunityId: string,
    strategyContext?: {
      moduleType: string;
      candidateStrategies: Array<{
        strategy: string;
        label: string;
        isDefault: boolean;
        executable: boolean;
      }>;
      merchantHistory?: {
        confidence: 'SUFFICIENT' | 'LOW' | 'INSUFFICIENT';
        totalSamples: number;
        strategyPerformance: Array<{
          strategy: string;
          successRate: number;
          effectivenessScore: number;
          confidence: number;
          sampleCount: number;
        }>;
      };
      deterministicStrategyRecommendation?: {
        strategy: string;
        reason: string;
        score: number;
      };
    }
  ): Promise<AIAdviceOutcome> {
    const startedAt = Date.now();
    this.logger?.info(
      { event: 'ai_advice_requested', opportunityId },
      'AI advice requested'
    );

    const resolved = await this.decisionService.featuresForOpportunity(opportunityId);
    if (resolved === null) {
      return { opportunityId, status: 'not-found', decision: null, ai: { status: 'disabled' } };
    }

    // The deterministic decision is stale-aware and lazily evaluated (Phase 4).
    const outcome = await this.decisionService.getForOpportunity(opportunityId);
    if (outcome.decision === null) {
      return { opportunityId, status: 'not-found', decision: null, ai: { status: 'disabled' } };
    }

    if (!this.config.enabled || this.advisor === null) {
      return {
        opportunityId,
        status: 'evaluated',
        decision: outcome.decision,
        ai: { status: 'disabled' },
      };
    }

    const fingerprint = sha256(decisionFingerprintParts(outcome.decision));
    const existing = await this.adviceStore.findByDecision({
      decisionId: outcome.decision.id,
      advisorVersion: this.config.advisorVersion,
      model: this.config.model,
    });

    if (existing !== null && existing.decisionFingerprint === fingerprint) {
      this.logger?.info(
        {
          event: 'ai_advice_reused',
          opportunityId,
          provider: this.config.provider,
          model: this.config.model,
          advisorVersion: this.config.advisorVersion,
        },
        'Reusing cached AI advice for unchanged deterministic decision'
      );
      return {
        opportunityId,
        status: 'evaluated',
        decision: outcome.decision,
        ai: { status: 'available', advice: existing },
      };
    }

    const request = buildRequestFrom(
      resolved.opportunity,
      resolved.features,
      outcome.decision,
      strategyContext
    );
    const result = await this.generateSafely(request);

    if (result.status === 'unavailable') {
      return {
        opportunityId,
        status: 'evaluated',
        decision: outcome.decision,
        ai: { status: 'unavailable', reason: result.reason },
      };
    }

    const guarded = constrainAdvice({ content: result.content, decision: request });
    if (guarded.safetyConstrained) {
      this.logger?.warn(
        {
          event: 'ai_advice_safety_constrained',
          opportunityId,
          provider: this.config.provider,
          model: this.config.model,
        },
        'AI advice contradicted the deterministic safety decision and was constrained'
      );
    }

    const data: NewRecoveryAIAdviceData = {
      // Attribution flows ONLY from persisted opportunity data (tenant isolation).
      merchantId: resolved.opportunity.merchantId,
      opportunityId,
      decisionId: outcome.decision.id,
      provider: this.config.provider,
      model: this.config.model,
      advisorVersion: this.config.advisorVersion,
      promptVersion: PROMPT_VERSION,
      status: 'AVAILABLE',
      summary: guarded.content.summary,
      explanation: guarded.content.explanation,
      nextStep: guarded.content.nextStep,
      customerMessage: guarded.content.customerMessage,
      operatorMessage: guarded.content.operatorMessage,
      confidence: guarded.content.confidence,
      warnings: [...guarded.content.warnings],
      safetyConstrained: guarded.safetyConstrained,
      decisionFingerprint: fingerprint,
    };
    const advice = await this.adviceStore.upsert(data);

    this.logger?.info(
      {
        event: 'ai_advice_generated',
        opportunityId,
        provider: this.config.provider,
        model: this.config.model,
        advisorVersion: this.config.advisorVersion,
        latencyMs: Date.now() - startedAt,
        safetyConstrained: guarded.safetyConstrained,
      },
      'AI advice generated and persisted'
    );

    return {
      opportunityId,
      status: 'evaluated',
      decision: outcome.decision,
      ai: { status: 'available', advice },
    };
  }

  /**
   * Calls the advisor with a strict timeout boundary of last resort; any
   * unexpected error degrades to a safe unavailable state instead of failing
   * the request. Model output is validated inside the provider; validation
   * failures surface as `invalid_response`, never as exceptions.
   */
  private async generateSafely(request: RecoveryAIAdviceRequest): Promise<AIAdvisorResult> {
    try {
      return await this.advisor!.advise(request);
    } catch (error) {
      this.logger?.error(
        {
          event: 'ai_advice_unavailable',
          opportunityId: request.opportunityId,
          provider: this.config.provider,
          model: this.config.model,
          reason: 'provider_error',
        },
        `AI advisor threw unexpectedly: ${error instanceof Error ? error.message : String(error)}`
      );
      return { status: 'unavailable', reason: 'provider_error' };
    }
  }
}

function buildRequestFrom(
  opportunity: { id: string; amountAtRisk: number; currency: string; type: string; status: string },
  features: {
    failureCategory: string;
    failureCode: string | null;
    observedFailedRetries: number;
    historicalOutcomes: { sampleSize: number; recoveredCount: number } | null;
  },
  decision: RecoveryDecisionRow,
  strategyContext?: {
    moduleType: string;
    candidateStrategies: Array<{
      strategy: string;
      label: string;
      isDefault: boolean;
      executable: boolean;
    }>;
    merchantHistory?: {
      confidence: 'SUFFICIENT' | 'LOW' | 'INSUFFICIENT';
      totalSamples: number;
      strategyPerformance: Array<{
        strategy: string;
        successRate: number;
        effectivenessScore: number;
        confidence: number;
        sampleCount: number;
      }>;
    };
    deterministicStrategyRecommendation?: {
      strategy: string;
      reason: string;
      score: number;
    };
  }
): RecoveryAIAdviceRequest {
  const stats = features.historicalOutcomes;
  const request: RecoveryAIAdviceRequest = {
    opportunityId: opportunity.id,
    opportunityType: opportunity.type,
    currency: opportunity.currency,
    amount: opportunity.amountAtRisk,
    failureCategory: features.failureCategory,
    failureCode: features.failureCode,
    observedFailedRetries: features.observedFailedRetries,
    opportunityStatus: opportunity.status,
    score: decision.score,
    priority: decision.priority,
    confidence: decision.confidence,
    recommendation: decision.recommendedAction,
    reasons: decision.reasons,
    riskFlags: decision.riskFlags.map((flag) => ({ ...flag })),
    historicalRecoveryRatePercent:
      stats === null || stats.sampleSize === 0
        ? null
        : Math.round((stats.recoveredCount / stats.sampleSize) * 1000) / 10,
  };

  // Phase 12.3: Add strategy intelligence context if available
  if (strategyContext !== undefined) {
    request.moduleType = strategyContext.moduleType;
    request.candidateStrategies = strategyContext.candidateStrategies;
    request.merchantHistory = strategyContext.merchantHistory;
    request.deterministicStrategyRecommendation = strategyContext.deterministicStrategyRecommendation;
  }

  return request;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
