import { describe, it, expect } from 'vitest';
import { constrainAdvice } from '../../src/ai/safety.js';
import {
  evaluateExecutionSafety,
  type ExecutionSafetyInput,
} from '../../src/domain/recovery-execution.js';
import {
  FakeAIRecoveryAdvisor,
} from '../helpers.js';
import { DeterministicDecisionEngine } from '../../src/decision/engine.js';
import type { DecisionFeatures } from '../../src/domain/recovery-decision.js';

function makeExecutionInput(
  overrides: Partial<ExecutionSafetyInput> = {}
): ExecutionSafetyInput {
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

function makeHardDeclineFeatures(
  overrides: Partial<DecisionFeatures> = {}
): DecisionFeatures {
  return {
    recoverableAmount: 500_000,
    currency: 'INR',
    opportunityAgeMs: 60 * 60 * 1000,
    evaluatedAtMs: Date.now(),
    observedFailedRetries: 0,
    lastFailedRetryAt: null,
    failureCategory: 'HARD_DECLINE',
    failureCode: 'stolen_card',
    opportunityStatus: 'OPEN',
    historicalOutcomes: { sampleSize: 30, recoveredCount: 5 },
    ...overrides,
  };
}

function makeTransientFeatures(
  overrides: Partial<DecisionFeatures> = {}
): DecisionFeatures {
  return {
    recoverableAmount: 500_000,
    currency: 'INR',
    opportunityAgeMs: 60 * 60 * 1000,
    evaluatedAtMs: Date.now(),
    observedFailedRetries: 0,
    lastFailedRetryAt: null,
    failureCategory: 'TRANSIENT',
    failureCode: 'GATEWAY_ERROR',
    opportunityStatus: 'OPEN',
    historicalOutcomes: { sampleSize: 30, recoveredCount: 20 },
    ...overrides,
  };
}

describe('AI safety — AI cannot override safety policy', () => {
  it('AI recommends retry but safety policy says BLOCKED → execution is BLOCKED', () => {
    const constrained = constrainAdvice({
      content: {
        summary: 'Transient error, should retry.',
        explanation: 'The error looks transient and retry should work.',
        nextStep: 'Retry the payment now.',
        customerMessage: null,
        operatorMessage: null,
        confidence: 85,
        warnings: [],
      },
      decision: {
        recommendation: 'DO_NOT_RETRY',
        riskFlags: [
          { flag: 'NON_RECOVERABLE_CONDITION', explanation: 'Hard decline.' },
        ],
        failureCode: 'stolen_card',
        confidence: 80,
      },
    });

    expect(constrained.safetyConstrained).toBe(true);
    expect(
      constrained.content.warnings.some((w) =>
        w.includes('contradicts the authoritative decision "DO_NOT_RETRY"')
      )
    ).toBe(true);

    const verdict = evaluateExecutionSafety(
      makeExecutionInput({
        decision: {
          recommendedAction: 'DO_NOT_RETRY',
          confidence: 80,
          riskFlags: [
            { flag: 'NON_RECOVERABLE_CONDITION', explanation: 'Hard decline.' },
          ],
        },
      })
    );
    expect(verdict.allowed).toBe(false);
  });

  it('AI advisor is unavailable (timeout) → system still works', async () => {
    const advisor = new FakeAIRecoveryAdvisor({ kind: 'timeout' });
    const request = {
      opportunityId: 'opp-1',
      opportunityType: 'FAILED_PAYMENT',
      currency: 'INR',
      amount: 500_000,
      failureCategory: 'TRANSIENT',
      failureCode: 'GATEWAY_ERROR',
      observedFailedRetries: 0,
      opportunityStatus: 'OPEN',
      score: 65,
      priority: 'HIGH',
      confidence: 70,
      recommendation: 'RETRY',
      reasons: ['Looks retryable'],
      riskFlags: [],
      historicalRecoveryRatePercent: 40,
    };

    const result = await advisor.advise(request);
    expect(result.status).toBe('unavailable');

    const verdict = evaluateExecutionSafety(makeExecutionInput());
    expect(verdict.allowed).toBe(true);
    expect(verdict.action).toBe('RETRY');
  });

  it('AI advisor returns garbage content → system still works', async () => {
    const advisor = new FakeAIRecoveryAdvisor({ kind: 'invalid_response_schema' });
    const request = {
      opportunityId: 'opp-1',
      opportunityType: 'FAILED_PAYMENT',
      currency: 'INR',
      amount: 500_000,
      failureCategory: 'TRANSIENT',
      failureCode: 'GATEWAY_ERROR',
      observedFailedRetries: 0,
      opportunityStatus: 'OPEN',
      score: 65,
      priority: 'HIGH',
      confidence: 70,
      recommendation: 'RETRY',
      reasons: [],
      riskFlags: [],
      historicalRecoveryRatePercent: null,
    };

    const result = await advisor.advise(request);
    expect(result.status).toBe('unavailable');

    const verdict = evaluateExecutionSafety(makeExecutionInput());
    expect(verdict.allowed).toBe(true);
  });

  it('AI advisor recommends high-risk action → safety policy blocks it', () => {
    const constrained = constrainAdvice({
      content: {
        summary: 'Hard decline, try again anyway.',
        explanation: 'Even though the card is blocked, retry with a different channel.',
        nextStep: 'Retry immediately.',
        customerMessage: null,
        operatorMessage: null,
        confidence: 90,
        warnings: [],
      },
      decision: {
        recommendation: 'REVIEW',
        riskFlags: [
          { flag: 'NON_RECOVERABLE_CONDITION', explanation: 'Hard decline.' },
        ],
        failureCode: 'stolen_card',
        confidence: 30,
      },
    });

    expect(constrained.safetyConstrained).toBe(true);

    const verdict = evaluateExecutionSafety(
      makeExecutionInput({
        decision: {
          recommendedAction: 'REVIEW',
          confidence: 30,
          riskFlags: [
            { flag: 'NON_RECOVERABLE_CONDITION', explanation: 'Hard decline.' },
          ],
        },
      })
    );
    expect(verdict.allowed).toBe(false);
  });

  it('AI advisor crash (throw) does not prevent execution', async () => {
    const advisor = new FakeAIRecoveryAdvisor({ kind: 'throw' });
    const request = {
      opportunityId: 'opp-1',
      opportunityType: 'FAILED_PAYMENT',
      currency: 'INR',
      amount: 500_000,
      failureCategory: 'TRANSIENT',
      failureCode: 'GATEWAY_ERROR',
      observedFailedRetries: 0,
      opportunityStatus: 'OPEN',
      score: 65,
      priority: 'HIGH',
      confidence: 70,
      recommendation: 'RETRY',
      reasons: [],
      riskFlags: [],
      historicalRecoveryRatePercent: null,
    };

    await expect(advisor.advise(request)).rejects.toThrow('synthetic advisor crash');

    const verdict = evaluateExecutionSafety(makeExecutionInput());
    expect(verdict.allowed).toBe(true);
    expect(verdict.action).toBe('RETRY');
  });

  it('safetyConstrained flag is set when AI content contradicts deterministic decision', () => {
    const constrained = constrainAdvice({
      content: {
        summary: 'Retry the payment now on another channel.',
        explanation: 'Looks like a transient issue.',
        nextStep: 'Try paying again with a different method.',
        customerMessage: null,
        operatorMessage: null,
        confidence: 75,
        warnings: [],
      },
      decision: {
        recommendation: 'DO_NOT_RETRY',
        riskFlags: [],
        failureCode: null,
        confidence: 50,
      },
    });

    expect(constrained.safetyConstrained).toBe(true);
    expect(
      constrained.content.warnings.some((w) =>
        w.includes('Safety constraint applied')
      )
    ).toBe(true);
  });

  it('AI cannot escalate confidence above what the deterministic engine computed', () => {
    const engine = new DeterministicDecisionEngine();
    const features = makeTransientFeatures({
      failureCode: null,
      historicalOutcomes: null,
    });
    const engineResult = engine.evaluate(features);

    const constrained = constrainAdvice({
      content: {
        summary: 'Transient failure.',
        explanation: 'Looks safe.',
        nextStep: 'Retry.',
        customerMessage: null,
        operatorMessage: null,
        confidence: 99,
        warnings: [],
      },
      decision: {
        recommendation: engineResult.recommendedAction,
        riskFlags: engineResult.riskFlags,
        failureCode: features.failureCode,
        confidence: engineResult.confidence,
      },
    });

    expect(constrained.content.confidence).toBe(99);

    const verdict = evaluateExecutionSafety(
      makeExecutionInput({
        decision: {
          recommendedAction: engineResult.recommendedAction,
          confidence: engineResult.confidence,
          riskFlags: engineResult.riskFlags,
        },
      })
    );

    if (engineResult.recommendedAction === 'RETRY') {
      if (engineResult.confidence < 60) {
        expect(verdict.allowed).toBe(false);
        if (!verdict.allowed) expect(verdict.reason).toBe('LOW_CONFIDENCE');
      } else {
        expect(verdict.allowed).toBe(true);
      }
    } else {
      expect(verdict.allowed).toBe(false);
      if (!verdict.allowed) {
        expect(verdict.reason).toBe('ACTION_NOT_EXECUTABLE');
      }
    }
  });

  it('HARD_DECLINE → DO_NOT_RETRY regardless of AI content', () => {
    const engine = new DeterministicDecisionEngine();
    const features = makeHardDeclineFeatures();
    const result = engine.evaluate(features);
    expect(result.recommendedAction).toBe('DO_NOT_RETRY');

    const constrained = constrainAdvice({
      content: {
        summary: 'Try again, it might work this time.',
        explanation: 'Transient failure, worth retrying.',
        nextStep: 'Retry now.',
        customerMessage: null,
        operatorMessage: null,
        confidence: 95,
        warnings: [],
      },
      decision: {
        recommendation: result.recommendedAction,
        riskFlags: result.riskFlags,
        failureCode: features.failureCode,
        confidence: result.confidence,
      },
    });

    expect(constrained.safetyConstrained).toBe(true);
    expect(result.recommendedAction).toBe('DO_NOT_RETRY');

    const verdict = evaluateExecutionSafety(
      makeExecutionInput({
        decision: {
          recommendedAction: 'DO_NOT_RETRY',
          confidence: result.confidence,
          riskFlags: result.riskFlags,
        },
      })
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toBe('ACTION_NOT_EXECUTABLE');
    }
  });
});
