import { describe, expect, it } from 'vitest';
import {
  evaluateExecutionSafety,
  type ExecutionSafetyInput,
} from '../../src/domain/recovery-execution.js';
import type { DecisionRiskFlagDetail } from '../../src/domain/recovery-decision.js';

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

function flag(name: string, explanation = 'test'): DecisionRiskFlagDetail {
  return { flag: name as DecisionRiskFlagDetail['flag'], explanation };
}

describe('Safety policy attack scenarios', () => {
  it('1. blocks excessive retries when prior attempts >= maxRetries', () => {
    const verdict = evaluateExecutionSafety(makeInput({ priorRetryAttempts: 3 }));
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toBe('RETRY_LIMIT_REACHED');
      expect(verdict.action).toBe('RETRY');
    }
  });

  it('2. blocks execution when confidence is below minConfidence', () => {
    const verdict = evaluateExecutionSafety(
      makeInput({ decision: { recommendedAction: 'RETRY', confidence: 45, riskFlags: [] } })
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toBe('LOW_CONFIDENCE');
      expect(verdict.action).toBe('RETRY');
    }
  });

  it('3a. blocks DO_NOT_RETRY as ACTION_NOT_EXECUTABLE', () => {
    const verdict = evaluateExecutionSafety(
      makeInput({ decision: { recommendedAction: 'DO_NOT_RETRY', confidence: 90, riskFlags: [] } })
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toBe('ACTION_NOT_EXECUTABLE');
      expect(verdict.action).toBe('DO_NOT_RETRY');
    }
  });

  it('3b. blocks NO_ACTION as ACTION_NOT_EXECUTABLE', () => {
    const verdict = evaluateExecutionSafety(
      makeInput({ decision: { recommendedAction: 'NO_ACTION', confidence: 90, riskFlags: [] } })
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toBe('ACTION_NOT_EXECUTABLE');
      expect(verdict.action).toBe('NO_ACTION');
    }
  });

  it('4. blocks execution when a BLOCKING_RISK_FLAG is present', () => {
    const verdict = evaluateExecutionSafety(
      makeInput({
        decision: {
          recommendedAction: 'RETRY',
          confidence: 85,
          riskFlags: [flag('NON_RECOVERABLE_CONDITION', 'payment permanently failed')],
        },
      })
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toBe('BLOCKING_RISK_FLAG');
      expect(verdict.detail).toContain('NON_RECOVERABLE_CONDITION');
    }
  });

  it('5. blocks execution when opportunity is RECOVERED', () => {
    const verdict = evaluateExecutionSafety(
      makeInput({ opportunity: { status: 'RECOVERED', providerPaymentId: 'pay_123' } })
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toBe('OPPORTUNITY_NOT_OPEN');
      expect(verdict.detail).toContain('RECOVERED');
    }
  });

  it('6. blocks execution when opportunity is EXPIRED', () => {
    const verdict = evaluateExecutionSafety(
      makeInput({ opportunity: { status: 'EXPIRED', providerPaymentId: 'pay_123' } })
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toBe('OPPORTUNITY_NOT_OPEN');
      expect(verdict.detail).toContain('EXPIRED');
    }
  });

  it('7. blocks execution when providerPaymentId is null', () => {
    const verdict = evaluateExecutionSafety(
      makeInput({ opportunity: { status: 'OPEN', providerPaymentId: null } })
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toBe('MISSING_PAYMENT_IDENTIFIER');
    }
  });

  it('8. duplicate execution returns idempotent replay, not duplicate execution', () => {
    const input = makeInput();
    const first = evaluateExecutionSafety(input);
    expect(first.allowed).toBe(true);

    const second = evaluateExecutionSafety(input);
    expect(second.allowed).toBe(true);

    expect(first).toEqual(second);
  });

  it('9. malformed decision with invalid fields is handled gracefully', () => {
    const malformedInput = {
      decision: {
        recommendedAction: 'RETRY' as const,
        confidence: 70,
        riskFlags: [],
      },
      opportunity: {
        status: 'OPEN' as const,
        providerPaymentId: 'pay_valid',
      },
      paymentCaptured: false,
      priorRetryAttempts: 0,
      config: { minConfidence: 60, maxRetries: 3 },
    };

    const verdict = evaluateExecutionSafety(malformedInput);
    expect(verdict.allowed).toBe(true);
  });

  it('10. WAIT action is allowed without a provider', () => {
    const verdict = evaluateExecutionSafety(
      makeInput({
        decision: {
          recommendedAction: 'WAIT',
          confidence: 30,
          riskFlags: [],
        },
        opportunity: { status: 'OPEN', providerPaymentId: null },
      })
    );
    expect(verdict).toEqual({ allowed: true, action: 'WAIT' });
  });
});
