import { describe, expect, it } from 'vitest';
import {
  computeBackoffDelaySeconds,
  decideRetry,
} from '../../src/execution/retry-policy.js';

describe('retry policy', () => {
  const config = { maxAttempts: 3, backoffSeconds: 300 };

  it('schedules a deterministic exponential retry for transient failures', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const decision = decideRetry({
      failedAttempt: 1,
      failureCode: 'PROVIDER_UNAVAILABLE',
      config,
      now,
    });
    expect(decision).toEqual({
      retry: true,
      nextAttemptAt: new Date('2026-01-01T00:05:00.000Z'),
      nextAttempt: 2,
    });
  });

  it('doubles the delay on each subsequent attempt', () => {
    expect(computeBackoffDelaySeconds(2, 300)).toBe(600);
    expect(computeBackoffDelaySeconds(3, 300)).toBe(1200);
  });

  it('caps the backoff at six hours', () => {
    expect(computeBackoffDelaySeconds(10, 300)).toBe(6 * 60 * 60);
  });

  it('is terminal once the attempt limit is reached', () => {
    const decision = decideRetry({
      failedAttempt: 3,
      failureCode: 'PROVIDER_UNAVAILABLE',
      config,
    });
    expect(decision).toEqual({ retry: false, terminalStatus: 'FAILED' });
  });

  it.each([
    ['payment_declined'],
    ['provider_http_402'],
    ['STALE_MAX_AGE'],
    [null],
  ])('never retries deterministic failures (%s)', (failureCode) => {
    const decision = decideRetry({ failedAttempt: 1, failureCode, config });
    expect(decision.retry).toBe(false);
  });
});
