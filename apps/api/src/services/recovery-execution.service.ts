import type { AILogger } from './recovery-ai-advisor.service.js';
import type { PaymentEventRow, PaymentEventStore } from '../domain/payment-event.js';
import type {
  ExecutionAction,
  ExecutionBlockReason,
  ExecutionSafetyConfig,
  ExecutionSafetyVerdict,
  RecoveryExecutionProvider,
  RecoveryExecutionRow,
} from '../domain/recovery-execution.js';
import { evaluateExecutionSafety } from '../domain/recovery-execution.js';
import type { RecoveryDecisionRow } from '../domain/recovery-decision.js';
import type { RecoveryOpportunityRow } from '../domain/recovery-opportunity.js';
import { requireTransition } from '../execution/state-machine.js';
import type { RecoveryDecisionService } from './recovery-decision.service.js';
import type { RecoveryExecutionRepository } from '../repositories/recovery-execution.repository.js';
import type { RecoveryOpportunityRepository } from '../repositories/recovery-opportunity.repository.js';

export interface RecoveryExecutionServiceConfig extends ExecutionSafetyConfig {
  enabled: boolean;
}

export interface ExecutionEligibility {
  eligible: boolean;
  action: ExecutionAction;
  reason: ExecutionBlockReason | null;
  detail: string | null;
}

export interface ExecutionAssessment {
  opportunity: RecoveryOpportunityRow;
  decision: RecoveryDecisionRow;
  eligibility: ExecutionEligibility;
  priorRetryAttempts: number;
}

export type ExecutionRequestResult =
  | { outcome: 'not-found' }
  | { outcome: 'disabled'; assessment: ExecutionAssessment }
  | {
      outcome: 'blocked';
      reason: ExecutionBlockReason;
      detail: string;
      execution: RecoveryExecutionRow | null;
    }
  | { outcome: 'replayed'; execution: RecoveryExecutionRow }
  | { outcome: 'created'; execution: RecoveryExecutionRow }
  | { outcome: 'provider-rejected'; execution: RecoveryExecutionRow }
  | { outcome: 'provider-unavailable'; execution: RecoveryExecutionRow; reason: string };

/**
 * Controlled recovery execution orchestration.
 *
 * Safety architecture (all deterministic):
 *   load opportunity → FRESH stale-aware decision (existing Phase 4 service,
 *   never duplicated here) → pure safety gate → idempotent record creation →
 *   state-machine-guarded provider call.
 *
 * A provider ACCEPTING a retry is recorded as SUCCEEDED *for the request* —
 * it is NEVER treated as payment recovery. Recovery remains exclusively
 * confirmed by the existing Phase 3 payment-event outcome flow.
 */
export class RecoveryExecutionService {
  constructor(
    private readonly opportunities: RecoveryOpportunityRepository,
    private readonly decisionService: RecoveryDecisionService,
    private readonly executions: RecoveryExecutionRepository,
    private readonly paymentEvents: PaymentEventStore,
    private readonly provider: RecoveryExecutionProvider | null,
    private readonly config: RecoveryExecutionServiceConfig,
    private readonly logger?: AILogger
  ) {}

  /**
   * Live eligibility snapshot used by the read API; works identically whether
   * execution is enabled or disabled (safety evaluation always runs).
   */
  async assess(opportunityId: string): Promise<ExecutionAssessment | null> {
    const opportunity = await this.opportunities.findById(opportunityId);
    if (opportunity === null) {
      return null;
    }

    // Stale-aware: re-evaluates through the existing Phase 4 service when the
    // stored decision no longer reflects current state. Never duplicated here.
    const decisionOutcome = await this.decisionService.getForOpportunity(opportunityId);
    if (decisionOutcome.decision === null) {
      return null;
    }

    const [paymentCaptured, priorRetryAttempts] = await Promise.all([
      this.detectCapturedPayment(opportunity),
      this.executions.countRetryAttempts(opportunityId),
    ]);

    const verdict = this.evaluate(opportunity, decisionOutcome.decision, paymentCaptured, priorRetryAttempts);

    return {
      opportunity,
      decision: decisionOutcome.decision,
      eligibility: toEligibility(verdict),
      priorRetryAttempts,
    };
  }

  async requestExecution(opportunityId: string): Promise<ExecutionRequestResult> {
    this.logger?.info(
      { event: 'execution_requested', opportunityId },
      'Recovery execution requested'
    );

    const assessment = await this.assess(opportunityId);
    if (assessment === null) {
      return { outcome: 'not-found' };
    }

    const action = assessment.eligibility.action;
    const attempt = assessment.priorRetryAttempts + 1;
    const idempotencyKey = buildIdempotencyKey(
      opportunityId,
      assessment.decision.id,
      action,
      attempt
    );

    // Idempotency first: a repeated request returns the existing execution —
    // including BLOCKED records — without any new provider interaction.
    const existing = await this.executions.findByIdempotencyKey(idempotencyKey);
    if (existing !== null) {
      this.logger?.info(
        {
          event: 'execution_replayed',
          opportunityId,
          executionId: existing.id,
          status: existing.status,
        },
        'Returning existing execution for repeated request'
      );
      return { outcome: 'replayed', execution: existing };
    }

    if (!this.config.enabled) {
      // Disabled mode: safety evaluation already ran above; nothing executes.
      return { outcome: 'disabled', assessment };
    }

    // Duplicate-request guard: while an execution of this action is still
    // in-flight OR has been accepted (awaiting payment outcome), repeated
    // requests replay it instead of firing another provider operation. Only a
    // terminal FAILED/CANCELLED result allows a genuinely new attempt.
    const latest = await this.executions.findLatestByOpportunityAndAction(
      opportunityId,
      action
    );
    if (
      latest !== null &&
      ['PENDING', 'AUTHORIZED', 'EXECUTING', 'SUCCEEDED'].includes(latest.status)
    ) {
      this.logger?.info(
        {
          event: 'execution_replayed',
          opportunityId,
          executionId: latest.id,
          status: latest.status,
        },
        'Returning in-flight/accepted execution for repeated request'
      );
      return { outcome: 'replayed', execution: latest };
    }

    if (!assessment.eligibility.eligible) {
      const execution = await this.executions.create({
        merchantId: assessment.opportunity.merchantId,
        opportunityId,
        decisionId: assessment.decision.id,
        action,
        status: 'BLOCKED',
        attempt,
        idempotencyKey,
        provider: null,
        providerPaymentId: assessment.opportunity.providerPaymentId,
        requestedAt: new Date(),
        startedAt: null,
        completedAt: new Date(),
        failureCode: assessment.eligibility.reason,
        failureReason: assessment.eligibility.detail,
      });
      this.logger?.warn(
        {
          event: 'execution_blocked',
          opportunityId,
          executionId: execution.id,
          action,
          reason: assessment.eligibility.reason,
        },
        'Execution blocked by the deterministic safety gate'
      );
      return {
        outcome: 'blocked',
        reason: assessment.eligibility.reason!,
        detail: assessment.eligibility.detail ?? 'Blocked by the safety gate.',
        execution,
      };
    }

    const execution = await this.executions.create({
      merchantId: assessment.opportunity.merchantId,
      opportunityId,
      decisionId: assessment.decision.id,
      action,
      status: 'PENDING',
      attempt,
      idempotencyKey,
      provider: this.provider?.provider ?? null,
      providerPaymentId: assessment.opportunity.providerPaymentId,
      requestedAt: new Date(),
      startedAt: null,
      completedAt: null,
      failureCode: null,
      failureReason: null,
    });

    if (action === 'WAIT') {
      // WAIT becomes a scheduled PENDING record — deliberately NO provider call.
      this.logger?.info(
        { event: 'execution_scheduled', opportunityId, executionId: execution.id },
        'WAIT recommendation recorded as scheduled execution'
      );
      return { outcome: 'created', execution };
    }

    return this.executeRetry(assessment, execution);
  }

  listExecutions(opportunityId: string): Promise<RecoveryExecutionRow[]> {
    return this.executions.listByOpportunity(opportunityId);
  }

  // -------------------------------------------------------------------------

  private async executeRetry(
    assessment: ExecutionAssessment,
    pending: RecoveryExecutionRow
  ): Promise<ExecutionRequestResult> {
    const opportunityId = pending.opportunityId;

    requireTransition(pending.status, 'AUTHORIZED');
    let execution = await this.executions.updateStatus({
      id: pending.id,
      status: 'AUTHORIZED',
    });

    if (this.provider === null) {
      requireTransition('AUTHORIZED', 'CANCELLED');
      execution = await this.executions.updateStatus({
        id: execution.id,
        status: 'CANCELLED',
        completedAt: new Date(),
        failureCode: 'PROVIDER_UNAVAILABLE',
        failureReason: 'No recovery execution provider is configured.',
      });
      return { outcome: 'provider-unavailable', execution, reason: 'not_configured' };
    }

    requireTransition('AUTHORIZED', 'EXECUTING');
    execution = await this.executions.updateStatus({
      id: execution.id,
      status: 'EXECUTING',
      startedAt: new Date(),
    });

    let result;
    try {
      result = await this.provider.retryPayment({
        executionId: execution.id,
        opportunityId,
        providerPaymentId: assessment.opportunity.providerPaymentId!,
        providerOrderId: assessment.opportunity.providerOrderId,
        amount: assessment.opportunity.amountAtRisk,
        currency: assessment.opportunity.currency,
      });
    } catch (error) {
      // Defensive boundary: providers are expected to return results, never
      // throw — but a crash must degrade safely, not fail the API. An attempt
      // that did not complete is recorded as FAILED (the only terminal state
      // reachable from EXECUTING besides SUCCEEDED).
      requireTransition('EXECUTING', 'FAILED');
      execution = await this.executions.updateStatus({
        id: execution.id,
        status: 'FAILED',
        completedAt: new Date(),
        failureCode: 'PROVIDER_ERROR',
        failureReason: error instanceof Error ? error.message : String(error),
      });
      this.logger?.error(
        { event: 'execution_provider_error', opportunityId, executionId: execution.id },
        'Recovery execution provider threw unexpectedly'
      );
      return { outcome: 'provider-unavailable', execution, reason: 'provider_error' };
    }

    switch (result.kind) {
      case 'accepted': {
        requireTransition('EXECUTING', 'SUCCEEDED');
        execution = await this.executions.updateStatus({
          id: execution.id,
          status: 'SUCCEEDED',
          completedAt: new Date(),
        });
        this.logger?.info(
          {
            event: 'execution_provider_accepted',
            opportunityId,
            executionId: execution.id,
            provider: this.provider.provider,
          },
          'Provider accepted the retry request — awaiting payment outcome'
        );
        return { outcome: 'created', execution };
      }
      case 'rejected': {
        requireTransition('EXECUTING', 'FAILED');
        execution = await this.executions.updateStatus({
          id: execution.id,
          status: 'FAILED',
          completedAt: new Date(),
          failureCode: result.failureCode,
          failureReason: result.failureReason,
        });
        this.logger?.warn(
          {
            event: 'execution_provider_rejected',
            opportunityId,
            executionId: execution.id,
            failureCode: result.failureCode,
          },
          'Provider rejected the retry request'
        );
        return { outcome: 'provider-rejected', execution };
      }
      case 'unavailable': {
        requireTransition('EXECUTING', 'FAILED');
        execution = await this.executions.updateStatus({
          id: execution.id,
          status: 'FAILED',
          completedAt: new Date(),
          failureCode: 'PROVIDER_UNAVAILABLE',
          failureReason: result.reason,
        });
        return { outcome: 'provider-unavailable', execution, reason: result.reason };
      }
    }
  }

  private evaluate(
    opportunity: RecoveryOpportunityRow,
    decision: RecoveryDecisionRow,
    paymentCaptured: boolean,
    priorRetryAttempts: number
  ): ExecutionSafetyVerdict {
    return evaluateExecutionSafety({
      decision,
      opportunity,
      paymentCaptured,
      priorRetryAttempts,
      config: {
        minConfidence: this.config.minConfidence,
        maxRetries: this.config.maxRetries,
      },
    });
  }

  /** Captured-payment observation via the EXISTING payment-event store. */
  private async detectCapturedPayment(opportunity: RecoveryOpportunityRow): Promise<boolean> {
    const sourceEvent = await this.paymentEvents.findById(opportunity.sourceEventId);
    if (
      sourceEvent === null ||
      (sourceEvent.providerPaymentId === null && sourceEvent.providerOrderId === null)
    ) {
      return false;
    }

    let related: PaymentEventRow[] = [];
    try {
      related = await this.paymentEvents.findRelatedByOrderOrPayment({
        providerPaymentId: sourceEvent.providerPaymentId,
        providerOrderId: sourceEvent.providerOrderId,
        occurredAfter: sourceEvent.eventCreatedAt,
        occurredBefore: new Date(sourceEvent.eventCreatedAt.getTime() + 365 * 24 * 60 * 60 * 1000),
      });
    } catch {
      return false;
    }

    return related.some(
      (row) => row.eventType === 'payment.captured' && row.id !== sourceEvent.id
    );
  }
}

function toEligibility(verdict: ExecutionSafetyVerdict): ExecutionEligibility {
  if (verdict.allowed) {
    return { eligible: true, action: verdict.action, reason: null, detail: null };
  }
  return {
    eligible: false,
    action: verdict.action,
    reason: verdict.reason,
    detail: verdict.detail,
  };
}

function buildIdempotencyKey(
  opportunityId: string,
  decisionId: string,
  action: ExecutionAction,
  attempt: number
): string {
  return `${opportunityId}:${decisionId}:${action}:${attempt}`;
}
