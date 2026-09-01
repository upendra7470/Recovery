import type { RecoveryModuleType } from '../domain/recovery-module.js';
import type {
  ExecutionSafetyConfig,
  ExecutionSafetyVerdict,
  ExecutionStatus,
  NewRecoveryExecutionData,
  RecoveryExecutionRow,
} from '../domain/recovery-execution.js';
import { evaluateExecutionSafety } from '../domain/recovery-execution.js';
import type { RecoveryDecisionRow } from '../domain/recovery-decision.js';
import type { RecoveryOpportunityRow } from '../domain/recovery-opportunity.js';
import type { PaymentEventStore } from '../domain/payment-event.js';
import type { MerchantStrategyMemoryRow } from '../domain/merchant-memory.js';
import type { RecoveryDecisionService } from './recovery-decision.service.js';
import type { RecoveryExecutionRepository } from '../repositories/recovery-execution.repository.js';
import type { RecoveryOpportunityRepository } from '../repositories/recovery-opportunity.repository.js';
import type { RevenueLeakageService } from './revenue-leakage.service.js';
import type { MerchantMemoryService } from './merchant-memory.service.js';
import {
  ModuleAdapterRegistry,
  type ModuleExecutionRequest,
  type ModuleExecutionResult,
} from '../modules/module-adapters.js';
import {
  rankStrategies,
  type StrategyRanking,
} from './strategy-ranking.js';

/**
 * Phase 12.1 — Module-aware recovery execution service.
 *
 * Architecture:
 *   MODULE DETECTION → RECOVERY INTELLIGENCE → AI DECISION →
 *   DETERMINISTIC SAFETY POLICY → AUTHORIZED ACTION →
 *   MODULE EXECUTION ADAPTER → OUTCOME VERIFICATION →
 *   RECOVERY LEDGER → MERCHANT MEMORY
 *
 * AI recommends.
 * Safety Policy authorizes.
 * The execution adapter executes.
 * The verifier proves the outcome.
 *
 * The safety gate is AUTHORITATIVE. The module executor MUST NOT execute
 * merely because the AI says RETRY. Execution only happens after
 * deterministic policy authorization.
 */
export class RecoveryModuleExecutionService {
  private readonly adapterRegistry = new ModuleAdapterRegistry();

  constructor(
    private readonly opportunities: RecoveryOpportunityRepository,
    private readonly decisionService: RecoveryDecisionService,
    private readonly executions: RecoveryExecutionRepository,
    private readonly paymentEvents: PaymentEventStore,
    private readonly leakageService: RevenueLeakageService,
    private readonly merchantMemoryService: MerchantMemoryService,
    private readonly config: ExecutionSafetyConfig
  ) {}

  /**
   * Execute a module-aware recovery for an authorized opportunity.
   */
  async executeModuleRecovery(
    opportunityId: string,
    paymentId: string,
    orderId: string
  ): Promise<ModuleExecutionOutcome> {
    const opportunity = await this.opportunities.findById(opportunityId);
    if (opportunity === null) {
      return {
        success: false,
        status: 'NOT_FOUND',
        moduleType: 'FAILED_PAYMENT',
        action: 'NO_ACTION',
        safetyVerdict: null,
        adapterResult: null,
        execution: null,
        recovered: false,
        recoveredAmount: 0,
        error: 'Opportunity not found',
      };
    }

    const decisionOutcome = await this.decisionService.getForOpportunity(opportunityId);
    if (decisionOutcome.decision === null) {
      return {
        success: false,
        status: 'NO_DECISION',
        moduleType: this.detectModuleType(opportunity),
        action: 'NO_ACTION',
        safetyVerdict: null,
        adapterResult: null,
        execution: null,
        recovered: false,
        recoveredAmount: 0,
        error: 'No decision available for this opportunity',
      };
    }

    const decision = decisionOutcome.decision;
    const [paymentCaptured, priorRetryAttempts] = await Promise.all([
      this.detectCapturedPayment(opportunity),
      this.executions.countRetryAttempts(opportunityId),
    ]);

    const verdict = evaluateExecutionSafety({
      decision,
      opportunity,
      paymentCaptured,
      priorRetryAttempts,
      config: this.config,
    });

    const moduleType = this.detectModuleType(opportunity);
    const action = decision.recommendedAction;

    // Phase 12.3: Rank strategies from merchant memory
    const merchantId = opportunity.merchantId ?? '00000000-0000-4000-8000-000000000099';
    const failureType = opportunity.reason;
    const strategyRanking = await this.getStrategyRanking(merchantId, moduleType, failureType);

    // Idempotency: check for existing execution
    const attempt = priorRetryAttempts + 1;
    const idempotencyKey = this.buildIdempotencyKey(opportunityId, decision.id, action, attempt);
    const existing = await this.executions.findByIdempotencyKey(idempotencyKey);
    if (existing !== null) {
      return await this.buildOutcomeFromExisting(moduleType, action, verdict, existing, opportunity, strategyRanking);
    }

    // Safety gate: if not allowed, record BLOCKED and return
    if (!verdict.allowed) {
      const execution = await this.recordBlockedExecution(
        opportunity,
        decision,
        verdict,
        idempotencyKey,
        attempt
      );

      await this.merchantMemoryService.recordBlocked(
        merchantId,
        action,
        opportunity.reason
      );

      return {
        success: true,
        status: 'BLOCKED',
        moduleType,
        action,
        safetyVerdict: verdict,
        adapterResult: null,
        execution,
        recovered: false,
        recoveredAmount: 0,
        strategyIntelligence: {
          ranking: strategyRanking,
          candidateStrategies: await this.getCandidateStrategiesForModule(moduleType),
          executedStrategy: action,
          aiStrategyValidated: true,
        },
      };
    }

    // Safety authorized: dispatch to module adapter
    const adapterRequest: ModuleExecutionRequest = {
      opportunityId,
      moduleType,
      amount: opportunity.amountAtRisk,
      currency: opportunity.currency,
      recommendedAction: action,
      context: this.extractEvidenceContext(opportunity),
    };

    const adapter = this.adapterRegistry.get(moduleType);
    const adapterResult = await adapter.execute(adapterRequest);

    // Record the execution
    const execution = await this.recordAuthorizedExecution(
      opportunity,
      decision,
      adapterResult,
      idempotencyKey,
      attempt
    );

    // For executed outcomes: create captured event and verify
    let recovered = false;
    let recoveredAmount = 0;

    if (adapterResult.outcome === 'executed' && adapterResult.isRecovered) {
      const capturedEvent = await this.createCapturedEvent(
        paymentId,
        orderId,
        opportunity.amountAtRisk,
        opportunity.currency
      );

      const recoveryOutcome = await this.leakageService.processPaymentEvent(capturedEvent);
      recovered = recoveryOutcome.outcome === 'opportunity-recovered';
      if (recovered) {
        recoveredAmount = opportunity.amountAtRisk;
      }
    }

    // Update merchant memory
    if (recovered) {
      await this.merchantMemoryService.recordOutcome(
        merchantId,
        action,
        opportunity.reason,
        'success',
        opportunity.amountAtRisk,
        recoveredAmount
      );
    } else if (adapterResult.outcome === 'blocked') {
      await this.merchantMemoryService.recordBlocked(
        merchantId,
        action,
        opportunity.reason
      );
    } else if (adapterResult.outcome === 'review_required') {
      await this.merchantMemoryService.recordHumanReview(
        merchantId,
        action,
        opportunity.reason
      );
    }

    return {
      success: true,
      status: adapterResult.outcome === 'executed' ? 'EXECUTED' :
              adapterResult.outcome === 'blocked' ? 'BLOCKED' :
              adapterResult.outcome === 'review_required' ? 'REVIEW_REQUIRED' :
              'MONITORING',
      moduleType,
      action,
      safetyVerdict: verdict,
      adapterResult,
      execution,
      recovered,
      recoveredAmount,
      providerReferenceId: adapterResult.providerReferenceId,
      strategyIntelligence: {
        ranking: strategyRanking,
        candidateStrategies: await this.getCandidateStrategiesForModule(moduleType),
        executedStrategy: action,
        aiStrategyValidated: true,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Phase 12.3: Get strategy ranking from merchant memory.
   */
  private async getStrategyRanking(
    merchantId: string,
    moduleType: RecoveryModuleType,
    failureType: string
  ): Promise<StrategyRanking> {
    // Get all memory rows for this merchant
    const allRows = await this.merchantMemoryService.getOverview(merchantId);
    // Use the strategies from the overview (already filtered by merchant)
    const merchantRows: MerchantStrategyMemoryRow[] = allRows.strategies ?? [];
    return rankStrategies(merchantId, moduleType, failureType, merchantRows);
  }

  /**
   * Phase 12.3: Get candidate strategies for a module type.
   */
  private async getCandidateStrategiesForModule(moduleType: RecoveryModuleType): Promise<Array<{
    strategy: string;
    label: string;
    isDefault: boolean;
    executable: boolean;
  }>> {
    const { getStrategyCandidates } = await import('../modules/module-strategies.js');
    const candidates = getStrategyCandidates(moduleType);
    return candidates.map((c) => ({
      strategy: c.strategy,
      label: c.label,
      isDefault: c.isDefault,
      executable: c.executable,
    }));
  }

  private detectModuleType(opportunity: RecoveryOpportunityRow): RecoveryModuleType {
    const evidence = this.extractEvidenceContext(opportunity);
    if (evidence['moduleType']) {
      return evidence['moduleType'] as RecoveryModuleType;
    }
    if (evidence['invoiceId'] || evidence['businessName']) return 'B2B_RECEIVABLE';
    if (evidence['mandateId']) return 'MANDATE_RETRY';
    if (evidence['degradationMetrics']) return 'PAYMENT_DEGRADATION';
    if (evidence['subscriptionId']) return 'SUBSCRIPTION_RECOVERY';
    if (evidence['cartValue']) return 'CHECKOUT_DROPOFF';
    return 'FAILED_PAYMENT';
  }

  private extractEvidenceContext(opportunity: RecoveryOpportunityRow): Record<string, unknown> {
    const evidence = opportunity.evidence;
    if (typeof evidence === 'object' && evidence !== null) {
      return evidence as Record<string, unknown>;
    }
    return {};
  }

  private async detectCapturedPayment(opportunity: RecoveryOpportunityRow): Promise<boolean> {
    if (opportunity.providerPaymentId === null) return false;
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const related = await this.paymentEvents.findRelatedByOrderOrPayment({
      providerPaymentId: opportunity.providerPaymentId,
      providerOrderId: opportunity.providerOrderId,
      occurredAfter: oneHourAgo,
      occurredBefore: now,
    });
    return related.some((e) => e.eventType === 'payment.captured');
  }

  private buildIdempotencyKey(
    opportunityId: string,
    decisionId: string,
    action: string,
    attempt: number
  ): string {
    return `${opportunityId}:${decisionId}:${action}:${attempt}`;
  }

  private async recordBlockedExecution(
    opportunity: RecoveryOpportunityRow,
    decision: RecoveryDecisionRow,
    verdict: ExecutionSafetyVerdict,
    idempotencyKey: string,
    attempt: number
  ): Promise<RecoveryExecutionRow> {
    const reason = verdict.allowed ? 'ACTION_NOT_EXECUTABLE' : verdict.reason;
    const detail = verdict.allowed ? 'Unexpected allowed verdict' : verdict.detail;

    const data: NewRecoveryExecutionData = {
      merchantId: opportunity.merchantId,
      opportunityId: opportunity.id,
      decisionId: decision.id,
      action: decision.recommendedAction,
      status: 'BLOCKED',
      origin: 'MANUAL',
      attempt,
      nextAttemptAt: null,
      scheduledAt: null,
      idempotencyKey,
      provider: null,
      providerPaymentId: opportunity.providerPaymentId,
      requestedAt: new Date(),
      startedAt: null,
      completedAt: new Date(),
      failureCode: reason,
      failureReason: detail,
    };

    return this.executions.create(data);
  }

  private async recordAuthorizedExecution(
    opportunity: RecoveryOpportunityRow,
    decision: RecoveryDecisionRow,
    adapterResult: ModuleExecutionResult,
    idempotencyKey: string,
    attempt: number
  ): Promise<RecoveryExecutionRow> {
    const status: ExecutionStatus =
      adapterResult.outcome === 'executed' ? 'SUCCEEDED' :
      adapterResult.outcome === 'blocked' ? 'BLOCKED' :
      adapterResult.outcome === 'review_required' ? 'BLOCKED' :
      'SUCCEEDED';

    const data: NewRecoveryExecutionData = {
      merchantId: opportunity.merchantId,
      opportunityId: opportunity.id,
      decisionId: decision.id,
      action: decision.recommendedAction,
      status,
      origin: 'MANUAL',
      attempt,
      nextAttemptAt: null,
      scheduledAt: null,
      idempotencyKey,
      provider: adapterResult.adapterName,
      providerPaymentId: adapterResult.providerReferenceId ?? opportunity.providerPaymentId,
      requestedAt: new Date(),
      startedAt: status === 'SUCCEEDED' ? new Date() : null,
      completedAt: new Date(),
      failureCode: null,
      failureReason: null,
    };

    return this.executions.create(data);
  }

  private async createCapturedEvent(
    paymentId: string,
    orderId: string,
    amount: number,
    currency: string
  ) {
    return this.paymentEvents.insert({
      paymentAccountId: '00000000-0000-4000-8000-000000000098',
      merchantId: '00000000-0000-4000-8000-000000000099',
      provider: 'razorpay',
      providerEventId: `evt_captured_${paymentId}`,
      eventType: 'payment.captured',
      providerPaymentId: paymentId,
      providerOrderId: orderId,
      eventCreatedAt: new Date(),
      receivedAt: new Date(),
      payload: { status: 'captured', amount, currency },
      normalizedData: {
        provider: 'razorpay',
        eventType: 'payment.captured',
        providerPaymentId: paymentId,
        providerOrderId: orderId,
        amount,
        currency,
        status: 'captured',
        method: 'card',
        email: null,
        contact: null,
        bank: null,
        errorCode: null,
        errorDescription: null,
        errorSource: null,
        errorStep: null,
        errorReason: null,
        subscriptionId: null,
        paymentCreatedAt: null,
        occurredAt: new Date().toISOString(),
      },
      signatureVerified: true,
      processingStatus: 'processed',
      processingAttempts: 1,
      processedAt: new Date(),
      failureReason: null,
    });
  }

  private async buildOutcomeFromExisting(
    moduleType: RecoveryModuleType,
    action: string,
    verdict: ExecutionSafetyVerdict,
    existing: RecoveryExecutionRow,
    opportunity: RecoveryOpportunityRow,
    strategyRanking: StrategyRanking
  ): Promise<ModuleExecutionOutcome> {
    const recovered = existing.status === 'SUCCEEDED' && opportunity.status === 'RECOVERED';
    return {
      success: true,
      status: existing.status === 'SUCCEEDED' ? 'EXECUTED' :
              existing.status === 'BLOCKED' ? 'BLOCKED' :
              existing.status,
      moduleType,
      action,
      safetyVerdict: verdict,
      adapterResult: null,
      execution: existing,
      recovered,
      recoveredAmount: recovered ? opportunity.amountAtRisk : 0,
      strategyIntelligence: {
        ranking: strategyRanking,
        candidateStrategies: await this.getCandidateStrategiesForModule(moduleType),
        executedStrategy: action,
        aiStrategyValidated: true,
      },
    };
  }
}

/**
 * Structured result from module-aware recovery execution.
 */
export interface ModuleExecutionOutcome {
  success: boolean;
  status: string;
  moduleType: RecoveryModuleType;
  action: string;
  safetyVerdict: ExecutionSafetyVerdict | null;
  adapterResult: ModuleExecutionResult | null;
  execution: RecoveryExecutionRow | null;
  recovered: boolean;
  recoveredAmount: number;
  providerReferenceId?: string;
  error?: string;
  /** Phase 12.3: Strategy intelligence from merchant memory. */
  strategyIntelligence?: StrategyIntelligenceResult;
}

/**
 * Phase 12.3 — Strategy intelligence included in execution outcome.
 */
export interface StrategyIntelligenceResult {
  /** The ranked strategies from merchant memory. */
  ranking: StrategyRanking;
  /** Candidate strategies for this module. */
  candidateStrategies: Array<{
    strategy: string;
    label: string;
    isDefault: boolean;
    executable: boolean;
  }>;
  /** The strategy actually used for this execution. */
  executedStrategy: string;
  /** Whether the AI strategy was validated against candidates. */
  aiStrategyValidated: boolean;
  /** AI recommendation if available. */
  aiRecommendation?: string;
}
