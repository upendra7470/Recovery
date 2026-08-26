import type { ExecutionStatus } from '../domain/recovery-execution.js';
import { isRetryableFailure } from '../domain/recovery-execution.js';

/**
 * Deterministic, bounded retry policy for automated recovery attempts.
 *
 * - Only transient provider failures (PROVIDER_UNAVAILABLE family) are
 *   retried; deterministic rejections (payment declined etc.) are terminal.
 * - Backoff is pure exponential with NO randomness: base × 2^(attempt−1),
 *   capped at MAX_BACKOFF_SECONDS so delays stay bounded.
 * - The attempt limit is absolute: once reached, failures are terminal.
 */

export interface RetryPolicyConfig {
  maxAttempts: number;
  backoffSeconds: number;
}

export type RetryDecision =
  | { retry: true; nextAttemptAt: Date; nextAttempt: number }
  | { retry: false; terminalStatus: Extract<ExecutionStatus, 'FAILED' | 'CANCELLED'> };

export const MAX_BACKOFF_SECONDS = 6 * 60 * 60; // 6h ceiling

/** Pure: delay for the transition INTO attempt `nextAttempt`. */
export function computeBackoffDelaySeconds(attempt: number, baseSeconds: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(MAX_BACKOFF_SECONDS, baseSeconds * 2 ** exponent);
}

export function decideRetry(args: {
  failedAttempt: number;
  failureCode: string | null;
  config: RetryPolicyConfig;
  now?: Date;
}): RetryDecision {
  const { failedAttempt, failureCode, config } = args;
  const now = args.now ?? new Date();

  if (!isRetryableFailure(failureCode)) {
    return { retry: false, terminalStatus: 'FAILED' };
  }
  if (failedAttempt >= config.maxAttempts) {
    return { retry: false, terminalStatus: 'FAILED' };
  }

  const nextAttempt = failedAttempt + 1;
  // Exponent grows with the failed attempt: 1st retry waits base, 2nd waits
  // base×2, etc. — deterministic and bounded.
  const delaySeconds = computeBackoffDelaySeconds(
    Math.max(1, failedAttempt),
    config.backoffSeconds
  );
  return {
    retry: true,
    nextAttemptAt: new Date(now.getTime() + delaySeconds * 1000),
    nextAttempt,
  };
}
