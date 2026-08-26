import { describe, expect, it } from 'vitest';
import {
  evaluateExecutionSafety,
  type ExecutionSafetyInput,
} from '../../src/domain/recovery-execution.js';

function makeInput(overrides: Partial<ExecutionSafetyInput> = {}): ExecutionSafetyInput {
  return {
    decision: {
      recommendedAction: 'RETRY',
      confidence: 71,
      riskFlags: [],
    },
    opportunity: {
      status: 'OPEN',
      providerPaymentId: 'pay_123',
    },
    paymentCaptured: false,
    priorRetryAttempts: 0,
    config: { minConfidence: 60, maxRetries: 3 },
    ...overrides,
  };
}

describe('execution safety gate', () => {
  it('allows a clean RETRY', () => {
    const verdict = evaluateExecutionSafety(makeInput());
    expect(verdict).toEqual({ allowed: true, action: 'RETRY' });
  });

  it('blocks every non-RETRY/WAIT action regardless of context', () => {
    for (const recommendedAction of [
      'DO_NOT_RETRY',
      'NO_ACTION',
      'REVIEW',
      'CUSTOMER_ACTION_REQUIRED',
    ] as const) {
      const verdict = evaluateExecutionSafety(
        makeInput({ decision: { recommendedAction, confidence: 100, riskFlags: [] } })
      );
      expect(verdict.allowed).toBe(false);
      if (!verdict.allowed) {
        expect(verdict.reason).toBe('ACTION_NOT_EXECUTABLE');
      }
    }
  });

  it('treats WAIT as schedulable but never provider-executable', () => {
    const verdict = evaluateExecutionSafety(
      makeInput({ decision: { recommendedAction: 'WAIT', confidence: 30, riskFlags: [] } })
    );
    // WAIT is allowed as a scheduled action even with low confidence — it
    // performs no provider call.
    expect(verdict).toEqual({ allowed: true, action: 'WAIT' });
  });

  it('blocks RETRY below the configured minimum confidence', () => {
    const verdict = evaluateExecutionSafety(
      makeInput({ decision: { recommendedAction: 'RETRY', confidence: 59, riskFlags: [] } })
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toBe('LOW_CONFIDENCE');
  });

  it('blocks RETRY on any blocking risk flag', () => {
    for (const flag of ['NON_RECOVERABLE_CONDITION', 'HIGH_RETRY_COUNT'] as const) {
      const verdict = evaluateExecutionSafety(
        makeInput({
          decision: {
            recommendedAction: 'RETRY',
            confidence: 90,
            riskFlags: [{ flag, explanation: 'test flag' }],
          },
        })
      );
      expect(verdict.allowed).toBe(false);
      if (!verdict.allowed) expect(verdict.reason).toBe('BLOCKING_RISK_FLAG');
    }
  });

  it('does not treat non-blocking flags as blockers', () => {
    const verdict = evaluateExecutionSafety(
      makeInput({
        decision: {
          recommendedAction: 'RETRY',
          confidence: 80,
          riskFlags: [
            { flag: 'INSUFFICIENT_HISTORICAL_DATA', explanation: 'context only' },
          ],
        },
      })
    );
    expect(verdict.allowed).toBe(true);
  });

  it('blocks when the opportunity is no longer OPEN (recovered/expired/dismissed)', () => {
    for (const status of ['RECOVERED', 'EXPIRED', 'DISMISSED'] as const) {
      const verdict = evaluateExecutionSafety(makeInput({ opportunity: { status, providerPaymentId: 'pay_1' } }));
      expect(verdict.allowed).toBe(false);
      if (!verdict.allowed) expect(verdict.reason).toBe('OPPORTUNITY_NOT_OPEN');
    }
  });

  it('blocks when the payment was already captured', () => {
    const verdict = evaluateExecutionSafety(makeInput({ paymentCaptured: true }));
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toBe('PAYMENT_ALREADY_CAPTURED');
  });

  it('blocks when the retry limit is reached', () => {
    const verdict = evaluateExecutionSafety(makeInput({ priorRetryAttempts: 3 }));
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toBe('RETRY_LIMIT_REACHED');
  });

  it('allows attempts up to (but not including) the limit', () => {
    const atLimitMinusOne = evaluateExecutionSafety(makeInput({ priorRetryAttempts: 2 }));
    expect(atLimitMinusOne.allowed).toBe(true);
  });

  it('blocks when no payment identifier is available', () => {
    const verdict = evaluateExecutionSafety(
      makeInput({ opportunity: { status: 'OPEN', providerPaymentId: null } })
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toBe('MISSING_PAYMENT_IDENTIFIER');
  });
});
