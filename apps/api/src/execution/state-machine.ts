import type { ExecutionStatus } from '../domain/recovery-execution.js';

/**
 * Explicit, deterministic execution state machine. Invalid transitions are
 * rejected — nothing can jump to SUCCEEDED without passing through EXECUTING,
 * and terminal states are immutable.
 *
 *   PENDING    → AUTHORIZED | BLOCKED | CANCELLED
 *   AUTHORIZED → EXECUTING | CANCELLED
 *   EXECUTING  → SUCCEEDED | FAILED
 */
const ALLOWED_TRANSITIONS: Readonly<Record<ExecutionStatus, readonly ExecutionStatus[]>> = {
  PENDING: ['AUTHORIZED', 'BLOCKED', 'CANCELLED'],
  AUTHORIZED: ['EXECUTING', 'CANCELLED'],
  EXECUTING: ['SUCCEEDED', 'FAILED'],
  SUCCEEDED: [],
  FAILED: [],
  BLOCKED: [],
  CANCELLED: [],
};

export const TERMINAL_STATUSES: readonly ExecutionStatus[] = [
  'SUCCEEDED',
  'FAILED',
  'BLOCKED',
  'CANCELLED',
];

export function isTerminal(status: ExecutionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: ExecutionStatus, to: ExecutionStatus): boolean {
  if (from === to) {
    return false; // self-transitions are never meaningful
  }
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Throwing variant used by the service so invalid transitions fail loudly. */
export class InvalidExecutionTransitionError extends Error {
  readonly from: ExecutionStatus;
  readonly to: ExecutionStatus;

  constructor(from: ExecutionStatus, to: ExecutionStatus) {
    super(`Invalid execution transition: ${from} → ${to}`);
    this.name = 'InvalidExecutionTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function requireTransition(from: ExecutionStatus, to: ExecutionStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidExecutionTransitionError(from, to);
  }
}
