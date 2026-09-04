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
import { InternalError } from '../lib/errors.js';
import type { RecoveryDecisionService } from './recovery-decision.service.js';
import type { RecoveryExecutionRepository } from '../repositories/recovery-execution.repository.js';
import type { RecoveryOpportunityRepository } from '../repositories/recovery-opportunity.repository.js';

export interface RecoveryExecutionServiceConfig extends ExecutionSafetyConfig {
  enabled: boolean;
  /** When true, execution is allowed even if RECOVERY_EXECUTION_ENABLED is false.
   *  Used by Demo Mode to demonstrate the full lifecycle without real credentials. */
  demoMode?: boolean;
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
  | { outcome: 'replayed'; execution: RecoveryExecutionRow; providerReferenceId?: string }
  | { outcome: 'created'; execution: RecoveryExecutionRow; providerReferenceId?: string }
  | { outcome: 'provider-rejected'; execution: RecoveryExecutionRow }
  | { outcome: 'provider-unavailable'; execution: RecoveryExecutionRow; reason: string };

export type ScheduledRunResult =
  | { outcome: 'not-found' }
  | { outcome: 'not-pending'; execution: RecoveryExecutionRow }
  | { outcome: 'already-in-progress' }
  | { outcome: 'blocked-audited'; execution: RecoveryExecutionRow; reason: string; detail: string }
  | { outcome: 'rescheduled'; execution: RecoveryExecutionRow }
  | { outcome: 'accepted'; execution: RecoveryExecutionRow }
  | { outcome: 'failed-permanent'; execution: RecoveryExecutionRow }
  | { outcome: 'failed-retryable'; execution: RecoveryExecutionRow; reason: string }
  | { outcome: 'cancelled'; execution: RecoveryExecutionRow; reason: string };

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

    if (!this.config.enabled && !this.config.demoMode) {
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
        origin: 'MANUAL',
        attempt,
        nextAttemptAt: null,
        scheduledAt: null,
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
      origin: 'MANUAL',
      attempt,
      nextAttemptAt: null,
      scheduledAt: null,
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

  /**
   * Phase 7 entry point for AUTOMATED runs. Shares the exact same
   * assess → gate → state-machine → provider pipeline as manual execution;
   * the only difference is that the PENDING record already exists (created by
   * the scheduler's planning phase) and ownership is established with an
   * atomic conditional transition so concurrent ticks/manual races are safe.
   */
  async runScheduledExecution(executionId: string): Promise<ScheduledRunResult> {
    const scheduled = await this.executions.findById(executionId);
    if (scheduled === null) {
      return { outcome: 'not-found' };
    }
    if (scheduled.status !== 'PENDING') {
      return { outcome: 'not-pending', execution: scheduled };
    }

    // Fresh stale-aware assessment through the shared pipeline.
    const assessment = await this.assess(scheduled.opportunityId);
    if (assessment === null) {
      const cancelled = await this.executions.transitionStatus({
        id: executionId,
        from: 'PENDING',
        to: 'CANCELLED',
        completedAt: new Date(),
        failureCode: 'OPPORTUNITY_MISSING',
        failureReason: 'The opportunity no longer exists.',
      });
      return cancelled === null
        ? { outcome: 'already-in-progress' }
        : { outcome: 'cancelled', execution: cancelled, reason: 'opportunity_missing' };
    }

    if (!assessment.eligibility.eligible) {
      // Audited deterministic block — PENDING→BLOCKED is a legal transition.
      const blocked = await this.executions.transitionStatus({
        id: executionId,
        from: 'PENDING',
        to: 'BLOCKED',
        completedAt: new Date(),
        failureCode: assessment.eligibility.reason,
        failureReason: assessment.eligibility.detail,
      });
      if (blocked === null) {
        return { outcome: 'already-in-progress' };
      }
      this.logger?.warn(
        {
          event: 'scheduled_execution_blocked',
          opportunityId: scheduled.opportunityId,
          executionId,
          reason: assessment.eligibility.reason,
        },
        'Scheduled execution blocked by the deterministic safety gate'
      );
      return {
        outcome: 'blocked-audited',
        execution: blocked,
        reason: assessment.eligibility.reason!,
        detail: assessment.eligibility.detail ?? 'Blocked by the safety gate.',
      };
    }

    if (assessment.eligibility.action === 'WAIT') {
      // Still WAITing per policy — push the due time forward, keep PENDING.
      const rescheduled = await this.executions.setNextAttemptAt({
        id: executionId,
        nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      return { outcome: 'rescheduled', execution: rescheduled };
    }

    // RETRY path: claim ownership atomically before any provider interaction.
    const claimed = await this.executions.transitionStatus({
      id: executionId,
      from: 'PENDING',
      to: 'AUTHORIZED',
      startedAt: new Date(),
    });
    if (claimed === null) {
      // Another worker (or a racing manual request) owns this execution.
      return { outcome: 'already-in-progress' };
    }

    const result = await this.runAuthorizedRetry(assessment, claimed);
    return mapToScheduledOutcome(result);
  }

  listExecutions(opportunityId: string): Promise<RecoveryExecutionRow[]> {
    return this.executions.listByOpportunity(opportunityId);
  }

  // -------------------------------------------------------------------------

  private async executeRetry(
    assessment: ExecutionAssessment,
    pending: RecoveryExecutionRow
  ): Promise<ExecutionRequestResult> {
    requireTransition(pending.status, 'AUTHORIZED');
    const authorized = await this.executions.transitionStatus({
      id: pending.id,
      from: 'PENDING',
      to: 'AUTHORIZED',
      startedAt: new Date(),
    });

    if (authorized === null) {
      // Another caller already transitioned this execution — replay the existing record
      const existing = await this.executions.findById(pending.id);
      if (existing !== null) {
        return { outcome: 'replayed', execution: existing };
      }
      return {
        outcome: 'blocked',
        reason: 'OPPORTUNITY_NOT_OPEN',
        detail: 'Execution was claimed by another concurrent request.',
        execution: null,
      };
    }

    if (this.provider === null) {
      requireTransition('AUTHORIZED', 'CANCELLED');
      const execution = await this.executions.transitionStatus({
        id: authorized.id,
        from: 'AUTHORIZED',
        to: 'CANCELLED',
        completedAt: new Date(),
        failureCode: 'PROVIDER_UNAVAILABLE',
        failureReason: 'No recovery execution provider is configured.',
      });
      return {
        outcome: 'provider-unavailable',
        execution: execution ?? authorized,
        reason: 'not_configured',
      };
    }

    return this.runAuthorizedRetry(assessment, authorized);
  }

  /**
   * Shared provider-attempt pipeline for MANUAL and AUTOMATED runs. The row
   * must already be AUTHORIZED (ownership established by the caller).
   */
  private async runAuthorizedRetry(
    assessment: ExecutionAssessment,
    authorized: RecoveryExecutionRow
  ): Promise<ExecutionRequestResult> {
    let execution = authorized;
    const opportunityId = authorized.opportunityId;

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
        return { outcome: 'created', execution, providerReferenceId: result.providerReferenceId };
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
  const { action, reason, detail } = verdict;
  return {
    eligible: false,
    action,
    reason,
    detail,
  };
}

/** Transient provider failures are retryable; deterministic ones are not. */
const RETRYABLE_PROVIDER_REASONS: readonly string[] = [
  'timeout',
  'rate_limited',
  'network_error',
  'provider_error',
];

function mapToScheduledOutcome(result: ExecutionRequestResult): ScheduledRunResult {
  switch (result.outcome) {
    case 'created':
      return { outcome: 'accepted', execution: result.execution };
    case 'provider-rejected':
      return { outcome: 'failed-permanent', execution: result.execution };
    case 'provider-unavailable':
      if (RETRYABLE_PROVIDER_REASONS.includes(result.reason)) {
        return { outcome: 'failed-retryable', execution: result.execution, reason: result.reason };
      }
      return { outcome: 'cancelled', execution: result.execution, reason: result.reason };
    default:
      // Manual-only outcomes cannot occur on the scheduled path.
      throw new InternalError(`Unexpected outcome on scheduled path: ${String(result.outcome)}`);
  }
}

function buildIdempotencyKey(
  opportunityId: string,
  decisionId: string,
  action: ExecutionAction,
  attempt: number
): string {
  return `${opportunityId}:${decisionId}:${action}:${attempt}`;
}
