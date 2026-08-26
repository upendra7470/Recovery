import { z } from 'zod';
import type { RecoveryDecisionRow } from './recovery-decision.js';
import type { RecoveryOpportunityRow } from './recovery-opportunity.js';

/**
 * Phase 6 — controlled recovery execution & outcome tracking.
 *
 * Safety architecture:
 * - the deterministic decision engine remains AUTHORITATIVE;
 * - only RETRY is ever automatically executable, and only through the safety
 *   gate; WAIT creates a scheduled PENDING record without a provider call;
 * - every other action is recorded as BLOCKED for auditability;
 * - a provider ACCEPTING a retry request is NOT payment recovery — recovery
 *   is confirmed exclusively by the existing payment-event outcome flow.
 */

/**
 * Execution lifecycle. Mirrors the ExecutionStatus Prisma enum. Transitions
 * are restricted by the pure state machine in execution/state-machine.ts:
 *
 *   PENDING → AUTHORIZED | BLOCKED | CANCELLED
 *   AUTHORIZED → EXECUTING | CANCELLED
 *   EXECUTING → SUCCEEDED | FAILED
 *   terminal: SUCCEEDED · FAILED · BLOCKED · CANCELLED
 */
export const EXECUTION_STATUSES = [
  'PENDING',
  'AUTHORIZED',
  'EXECUTING',
  'SUCCEEDED',
  'FAILED',
  'BLOCKED',
  'CANCELLED',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/** Actions an execution record can represent. Reuses the deterministic
 * recommendation vocabulary — callers can NEVER invent new actions. */
export type ExecutionAction = RecoveryDecisionRow['recommendedAction'];

/** Stable reason codes attached to BLOCKED executions (safe to render). */
export const EXECUTION_BLOCK_REASONS = [
  'ACTION_NOT_EXECUTABLE',
  'DECISION_STALE',
  'LOW_CONFIDENCE',
  'BLOCKING_RISK_FLAG',
  'OPPORTUNITY_NOT_OPEN',
  'PAYMENT_ALREADY_CAPTURED',
  'RETRY_LIMIT_REACHED',
  'MISSING_PAYMENT_IDENTIFIER',
] as const;
export type ExecutionBlockReason = (typeof EXECUTION_BLOCK_REASONS)[number];

/** Risk flags that make automated retry unsafe regardless of score. */
export const BLOCKING_RISK_FLAGS: readonly string[] = [
  'NON_RECOVERABLE_CONDITION',
  'HIGH_RETRY_COUNT',
];

// ---------------------------------------------------------------------------
// Safety gate (pure)
// ---------------------------------------------------------------------------

export interface ExecutionSafetyConfig {
  minConfidence: number;
  maxRetries: number;
}

export interface ExecutionSafetyInput {
  /** The FRESH authoritative decision (staleness handled by the caller via
   * the existing stale-aware decision service — never cached values). */
  decision: Pick<
    RecoveryDecisionRow,
    'recommendedAction' | 'confidence' | 'riskFlags'
  >;
  opportunity: Pick<RecoveryOpportunityRow, 'status' | 'providerPaymentId'>;
  /** True when the payment-event flow already observed a captured payment. */
  paymentCaptured: boolean;
  /** Prior non-blocked RETRY attempts already recorded for this opportunity. */
  priorRetryAttempts: number;
  config: ExecutionSafetyConfig;
}

export type ExecutionSafetyVerdict =
  | { allowed: true; action: 'RETRY' | 'WAIT' }
  | { allowed: false; action: ExecutionAction; reason: ExecutionBlockReason; detail: string };

/**
 * Deterministic execution gate. Pure: no I/O, no clock reads — freshness and
 * captured-payment detection arrive pre-computed so verdicts are testable and
 * reproducible.
 */
export function evaluateExecutionSafety(input: ExecutionSafetyInput): ExecutionSafetyVerdict {
  const { decision, opportunity, paymentCaptured, priorRetryAttempts, config } = input;
  const action = decision.recommendedAction;

  if (action !== 'RETRY' && action !== 'WAIT') {
    return {
      allowed: false,
      action,
      reason: 'ACTION_NOT_EXECUTABLE',
      detail: `The deterministic action "${action}" is never executed automatically.`,
    };
  }

  if (action === 'WAIT') {
    // WAIT becomes a scheduled PENDING record — never a provider call.
    return { allowed: true, action: 'WAIT' };
  }

  if (opportunity.status !== 'OPEN') {
    return {
      allowed: false,
      action,
      reason: 'OPPORTUNITY_NOT_OPEN',
      detail: `Opportunity status is "${opportunity.status}"; only OPEN opportunities can be executed.`,
    };
  }

  if (paymentCaptured) {
    return {
      allowed: false,
      action,
      reason: 'PAYMENT_ALREADY_CAPTURED',
      detail: 'A captured payment was already observed for this payment/order identity.',
    };
  }

  if (decision.confidence < config.minConfidence) {
    return {
      allowed: false,
      action,
      reason: 'LOW_CONFIDENCE',
      detail: `Decision confidence ${decision.confidence} is below the configured minimum ${config.minConfidence}.`,
    };
  }

  const blockingFlag = decision.riskFlags.find((flag) =>
    BLOCKING_RISK_FLAGS.includes(flag.flag)
  );
  if (blockingFlag !== undefined) {
    return {
      allowed: false,
      action,
      reason: 'BLOCKING_RISK_FLAG',
      detail: `Risk flag "${blockingFlag.flag}" blocks automated execution: ${blockingFlag.explanation}`,
    };
  }

  if (priorRetryAttempts >= config.maxRetries) {
    return {
      allowed: false,
      action,
      reason: 'RETRY_LIMIT_REACHED',
      detail: `${priorRetryAttempts} prior attempt(s) reached the configured limit of ${config.maxRetries}.`,
    };
  }

  if (opportunity.providerPaymentId === null || opportunity.providerPaymentId.trim() === '') {
    return {
      allowed: false,
      action,
      reason: 'MISSING_PAYMENT_IDENTIFIER',
      detail: 'No provider payment id is available to reference for the retry.',
    };
  }

  return { allowed: true, action: 'RETRY' };
}

// ---------------------------------------------------------------------------
// Provider capability (explicit — no generic execute(action))
// ---------------------------------------------------------------------------

export interface RetryPaymentRequest {
  executionId: string;
  opportunityId: string;
  providerPaymentId: string;
  providerOrderId: string | null;
  amount: number;
  currency: string;
}

/** Normalized provider result — raw provider payloads never cross this boundary. */
export type RetryPaymentResult =
  | { kind: 'accepted'; providerReferenceId: string }
  | { kind: 'rejected'; failureCode: string; failureReason: string }
  | { kind: 'unavailable'; reason: string };

/**
 * Narrow provider capability for safe recovery execution. Deliberately NOT a
 * generic execute(action) surface: only operations that pass the safety gate
 * have a method here, so future unsafe actions cannot slip through typing.
 */
export interface RecoveryExecutionProvider {
  readonly provider: string;
  retryPayment(request: RetryPaymentRequest): Promise<RetryPaymentResult>;
}

// ---------------------------------------------------------------------------
// Persistence shapes
// ---------------------------------------------------------------------------

/** Persisted shape of a recovery_executions row. */
export interface RecoveryExecutionRow {
  id: string;
  merchantId: string | null;
  opportunityId: string;
  decisionId: string;
  action: ExecutionAction;
  status: ExecutionStatus;
  attempt: number;
  idempotencyKey: string;
  provider: string | null;
  providerPaymentId: string | null;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  failureCode: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Data required to create an execution record. */
export interface NewRecoveryExecutionData {
  merchantId: string | null;
  opportunityId: string;
  decisionId: string;
  action: ExecutionAction;
  status: ExecutionStatus;
  attempt: number;
  idempotencyKey: string;
  provider: string | null;
  providerPaymentId: string | null;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  failureCode: string | null;
  failureReason: string | null;
}

/** Persistence boundary for execution records (Prisma adapter in prisma-stores.ts). */
export interface RecoveryExecutionStore {
  insert(data: NewRecoveryExecutionData): Promise<RecoveryExecutionRow>;
  findByIdempotencyKey(idempotencyKey: string): Promise<RecoveryExecutionRow | null>;
  updateStatus(args: {
    id: string;
    status: ExecutionStatus;
    startedAt?: Date;
    completedAt?: Date;
    failureCode?: string | null;
    failureReason?: string | null;
  }): Promise<RecoveryExecutionRow>;
  listByOpportunity(opportunityId: string): Promise<RecoveryExecutionRow[]>;
  /** Most recent execution of one action for an opportunity (null when none). */
  findLatestByOpportunityAndAction(
    opportunityId: string,
    action: ExecutionAction
  ): Promise<RecoveryExecutionRow | null>;
  countRetryAttempts(opportunityId: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// Route schemas
// ---------------------------------------------------------------------------

export const executionParamsSchema = z.object({
  id: z.string().uuid(),
});
