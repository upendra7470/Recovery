import type { AILogger } from './recovery-ai-advisor.service.js';
import type {
  ExecutionAction,
  ExecutionStatus,
} from '../domain/recovery-execution.js';
import type { RecoveryDecisionService } from './recovery-decision.service.js';
import type { RecoveryExecutionRepository } from '../repositories/recovery-execution.repository.js';
import type { RecoveryOpportunityRepository } from '../repositories/recovery-opportunity.repository.js';
import type { RecoveryExecutionService } from './recovery-execution.service.js';
import { decideRetry, type RetryPolicyConfig } from '../execution/retry-policy.js';

export interface RecoveryAutomationConfig extends RetryPolicyConfig {
  maxAgeHours: number;
  batchSize: number;
}

export interface OperationTickSummary {
  /** PENDING executions cancelled for exceeding the maximum age. */
  staleCancelled: number;
  /** New automated PENDING executions planned from eligible decisions. */
  planned: number;
  /** Due PENDING executions claimed and run through the shared pipeline. */
  executed: number;
  accepted: number;
  failedPermanent: number;
  retryScheduled: number;
  blockedAudited: number;
  rescheduled: number;
  alreadyInProgress: number;
}

/**
 * Recovery operations scheduler (Phase 7).
 *
 * Deterministic tick-based orchestrator that NEVER bypasses the Phase 6
 * pipeline: planning only CREATES audited PENDING records; execution always
 * goes through `RecoveryExecutionService.runScheduledExecution`, which
 * re-runs the fresh-decision safety gate and claims ownership atomically.
 *
 * Replaceable by an external job queue: the queue would simply invoke
 * `tick()` (or `runScheduledExecution`) with the same injected dependencies.
 */
export class RecoveryOperationScheduler {
  constructor(
    private readonly opportunities: RecoveryOpportunityRepository,
    private readonly decisionService: RecoveryDecisionService,
    private readonly executions: RecoveryExecutionRepository,
    private readonly executionService: RecoveryExecutionService,
    private readonly config: RecoveryAutomationConfig,
    private readonly logger?: AILogger
  ) {}

  async tick(now: Date = new Date()): Promise<OperationTickSummary> {
    const summary: OperationTickSummary = emptySummary();
    const createdBefore = new Date(now.getTime() - this.config.maxAgeHours * 60 * 60 * 1000);

    // Phase A — stale handling: old PENDING records are deterministically
    // CANCELLED (never silently deleted).
    summary.staleCancelled = await this.cancelStale(createdBefore);

    // Phase B — planning: create automated PENDING records for OPEN
    // opportunities whose fresh decision is actionable and which have no
    // active/accepted execution yet.
    summary.planned = await this.planAutomatedExecutions();

    // Phase C — execution of due PENDING records via the SHARED pipeline.
    const due = await this.executions.findDuePending({
      dueBefore: now,
      limit: this.config.batchSize,
    });
    for (const execution of due) {
      await this.runDue(execution.id, summary);
    }

    this.logger?.info(
      {
        event: 'operations_tick',
        ...summary,
      },
      'Recovery operations tick complete'
    );
    return summary;
  }

  private async cancelStale(createdBefore: Date): Promise<number> {
    const stale = await this.executions.findStalePending({
      createdBefore,
      limit: 100,
    });
    let cancelled = 0;
    for (const row of stale) {
      const updated = await this.executions.transitionStatus({
        id: row.id,
        from: 'PENDING',
        to: 'CANCELLED',
        completedAt: new Date(),
        failureCode: 'STALE_MAX_AGE',
        failureReason: `PENDING execution exceeded the maximum age of ${this.config.maxAgeHours}h.`,
      });
      if (updated !== null) {
        cancelled += 1;
      }
    }
    return cancelled;
  }

  private async planAutomatedExecutions(): Promise<number> {
    const openOpportunities = await this.opportunities.list({ status: 'OPEN' });
    let planned = 0;

    for (const opportunity of openOpportunities) {
      if (planned >= this.config.batchSize) break;

      // Skip when an execution is already in-flight or awaiting outcome.
      const active = await this.executions.findActiveByOpportunity(opportunity.id);
      if (active !== null) continue;

      const assessment = await this.executionService.assess(opportunity.id);
      if (assessment === null) continue;
      if (!assessment.eligibility.eligible) continue; // gate decides; planner never overrides

      const action: ExecutionAction = assessment.eligibility.action;
      const attempt = assessment.priorRetryAttempts + 1;
      if (attempt > this.config.maxAttempts) continue;

      const idempotencyKey = `${opportunity.id}:${assessment.decision.id}:${action}:${attempt}:auto`;
      const existing = await this.executions.findByIdempotencyKey(idempotencyKey);
      if (existing !== null) continue;

      try {
        await this.executions.create({
          merchantId: opportunity.merchantId,
          opportunityId: opportunity.id,
          decisionId: assessment.decision.id,
          action,
          status: 'PENDING',
          origin: 'AUTOMATED',
          attempt,
          nextAttemptAt: new Date(), // RETRY: immediately due · WAIT: re-checked on next ticks
          scheduledAt: new Date(),
          idempotencyKey,
          provider: null,
          providerPaymentId: opportunity.providerPaymentId,
          requestedAt: new Date(),
          startedAt: null,
          completedAt: null,
          failureCode: null,
          failureReason: null,
        });
        planned += 1;
        this.logger?.info(
          {
            event: 'operation_planned',
            opportunityId: opportunity.id,
            action,
            attempt,
            origin: 'AUTOMATED',
          },
          'Automated execution planned'
        );
      } catch (error) {
        // Concurrent planner lost the unique-key race — safe to skip.
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }
    }
    return planned;
  }

  private async runDue(executionId: string, summary: OperationTickSummary): Promise<void> {
    const result = await this.executionService.runScheduledExecution(executionId);

    switch (result.outcome) {
      case 'accepted':
        summary.executed += 1;
        summary.accepted += 1;
        return;
      case 'failed-permanent':
        summary.executed += 1;
        summary.failedPermanent += 1;
        return;
      case 'failed-retryable': {
        summary.executed += 1;
        const decision = decideRetry({
          failedAttempt: result.execution.attempt,
          failureCode: result.execution.failureCode,
          config: {
            maxAttempts: this.config.maxAttempts,
            backoffSeconds: this.config.backoffSeconds,
          },
        });
        if (decision.retry) {
          await this.scheduleNextAttempt(result.execution, decision.nextAttemptAt, decision.nextAttempt);
          summary.retryScheduled += 1;
        } else {
          summary.failedPermanent += 1;
          this.logger?.warn(
            {
              event: 'operation_attempts_exhausted',
              opportunityId: result.execution.opportunityId,
              executionId: result.execution.id,
              attempts: result.execution.attempt,
            },
            'Automated attempts exhausted — terminal failure'
          );
        }
        return;
      }
      case 'blocked-audited':
        summary.blockedAudited += 1;
        return;
      case 'rescheduled':
        summary.rescheduled += 1;
        return;
      case 'already-in-progress':
        summary.alreadyInProgress += 1;
        return;
      default:
        // not-found / not-pending: nothing to count.
        return;
    }
  }

  /**
   * Schedules the next automated attempt as a NEW audited PENDING row
   * (one row per attempt, matching the existing idempotency design).
   */
  private async scheduleNextAttempt(
    failedExecution: {
      merchantId: string | null;
      opportunityId: string;
      decisionId: string;
      providerPaymentId: string | null;
    },
    nextAttemptAt: Date,
    nextAttempt: number
  ): Promise<void> {
    await this.executions.create({
      // Attribution flows from the prior audited attempt (same opportunity).
      merchantId: failedExecution.merchantId,
      opportunityId: failedExecution.opportunityId,
      decisionId: failedExecution.decisionId,
      action: 'RETRY',
      status: 'PENDING',
      origin: 'AUTOMATED',
      attempt: nextAttempt,
      nextAttemptAt,
      scheduledAt: new Date(),
      idempotencyKey: `${failedExecution.opportunityId}:${failedExecution.decisionId}:RETRY:${nextAttempt}:auto`,
      provider: null,
      providerPaymentId: failedExecution.providerPaymentId,
      requestedAt: new Date(),
      startedAt: null,
      completedAt: null,
      failureCode: null,
      failureReason: null,
    });
  }

  statusCounts(): Promise<{ status: ExecutionStatus; count: number }[]> {
    return this.executions.countByStatus();
  }
}

function emptySummary(): OperationTickSummary {
  return {
    staleCancelled: 0,
    planned: 0,
    executed: 0,
    accepted: 0,
    failedPermanent: 0,
    retryScheduled: 0,
    blockedAudited: 0,
    rescheduled: 0,
    alreadyInProgress: 0,
  };
}
