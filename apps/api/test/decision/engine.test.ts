import { describe, expect, it } from 'vitest';
import type { DecisionFeatures } from '../../src/domain/recovery-decision.js';
import {
  DECISION_ENGINE_VERSION,
  DeterministicDecisionEngine,
  MIN_HISTORICAL_SAMPLE,
  priorityForScore,
} from '../../src/decision/engine.js';
import { categorizeFailureCode } from '../../src/decision/failure-category.js';

const HOUR_MS = 60 * 60 * 1000;

function makeFeatures(overrides: Partial<DecisionFeatures> = {}): DecisionFeatures {
  return {
    recoverableAmount: 500_000, // ₹5,000
    currency: 'INR',
    opportunityAgeMs: 30 * 60 * 1000, // 30 minutes old
    evaluatedAtMs: 1_800_000_000_000,
    observedFailedRetries: 0,
    lastFailedRetryAt: null,
    failureCategory: 'TRANSIENT',
    failureCode: 'GATEWAY_ERROR',
    opportunityStatus: 'OPEN',
    historicalOutcomes: null,
    ...overrides,
  };
}

const engine = new DeterministicDecisionEngine();

describe('DeterministicDecisionEngine scoring', () => {
  it('scores higher for larger recoverable amounts', () => {
    const small = engine.evaluate(makeFeatures({ recoverableAmount: 100 }));
    const large = engine.evaluate(makeFeatures({ recoverableAmount: 6_000_000 }));
    expect(large.score).toBeGreaterThan(small.score);
  });

  it('keeps the score within 0–100 for every input shape', () => {
    const shapes: DecisionFeatures[] = [
      makeFeatures({ recoverableAmount: 0 }),
      makeFeatures({ recoverableAmount: Number.MAX_SAFE_INTEGER }),
      makeFeatures({ opportunityAgeMs: 365 * 24 * HOUR_MS }),
      makeFeatures({ observedFailedRetries: 50 }),
      makeFeatures({
        historicalOutcomes: { sampleSize: 500, recoveredCount: 500 },
      }),
      makeFeatures({
        failureCategory: 'HARD_DECLINE',
        historicalOutcomes: { sampleSize: 1000, recoveredCount: 0 },
      }),
    ];
    for (const shape of shapes) {
      const { score } = engine.evaluate(shape);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('respects documented amount band boundaries', () => {
    // Value weight is 25; bands at ₹500/₹2,000/₹10,000/₹50,000 (minor units).
    const justBelow = engine.evaluate(
      makeFeatures({ recoverableAmount: 49_999, failureCategory: 'UNKNOWN', failureCode: 'X' })
    ).factors.find((f) => f.name === 'value')!.contribution;
    const justAbove = engine.evaluate(
      makeFeatures({ recoverableAmount: 50_000, failureCategory: 'UNKNOWN', failureCode: 'X' })
    ).factors.find((f) => f.name === 'value')!.contribution;
    expect(justAbove).toBeGreaterThan(justBelow);
  });
});

describe('DeterministicDecisionEngine priority bands', () => {
  it('maps exact band boundaries correctly', () => {
    expect(priorityForScore(0)).toBe('VERY_LOW');
    expect(priorityForScore(19)).toBe('VERY_LOW');
    expect(priorityForScore(20)).toBe('LOW');
    expect(priorityForScore(39)).toBe('LOW');
    expect(priorityForScore(40)).toBe('MEDIUM');
    expect(priorityForScore(59)).toBe('MEDIUM');
    expect(priorityForScore(60)).toBe('HIGH');
    expect(priorityForScore(79)).toBe('HIGH');
    expect(priorityForScore(80)).toBe('CRITICAL');
    expect(priorityForScore(100)).toBe('CRITICAL');
  });

  it('produces a CRITICAL decision for a fresh high-value transient failure', () => {
    const decision = engine.evaluate(
      makeFeatures({
        recoverableAmount: 5_000_000,
        historicalOutcomes: { sampleSize: 100, recoveredCount: 50 },
      })
    );
    // value 25 + recency 15 + recoverability 25 + retryHistory 15 + historical 10
    expect(decision.score).toBe(90);
    expect(decision.priority).toBe('CRITICAL');
  });

  it('produces a LOW decision for an old, small, opaque opportunity', () => {
    const decision = engine.evaluate(
      makeFeatures({
        recoverableAmount: 10,
        opportunityAgeMs: 8 * 24 * HOUR_MS,
        failureCategory: 'UNKNOWN',
        failureCode: 'SOMETHING_UNUSUAL',
        observedFailedRetries: 5,
      })
    );
    expect(decision.score).toBe(22);
    expect(decision.priority).toBe('LOW');
  });
});

describe('DeterministicDecisionEngine confidence vs score', () => {
  it('keeps high priority distinct from confidence', () => {
    const decision = engine.evaluate(
      makeFeatures({
        recoverableAmount: 5_000_000,
        failureCode: null,
        failureCategory: 'UNKNOWN',
        historicalOutcomes: null,
      })
    );
    // Valuable and recent ⇒ meaningful score…
    expect(decision.score).toBeGreaterThanOrEqual(40);
    // …but weak evidence ⇒ modest confidence.
    expect(decision.confidence).toBeLessThan(60);
    expect(decision.riskFlags.some((flag) => flag.flag === 'MISSING_FAILURE_CODE')).toBe(true);
  });

  it('grows confidence only with sufficient historical data', () => {
    const none = engine.evaluate(makeFeatures());
    const few = engine.evaluate(
      makeFeatures({ historicalOutcomes: { sampleSize: 5, recoveredCount: 4 } })
    );
    const enough = engine.evaluate(
      makeFeatures({ historicalOutcomes: { sampleSize: 150, recoveredCount: 90 } })
    );

    expect(none.confidence).toBeLessThan(few.confidence);
    expect(few.confidence).toBeLessThan(enough.confidence);
    expect(none.riskFlags.some((flag) => flag.flag === 'INSUFFICIENT_HISTORICAL_DATA')).toBe(true);
    expect(enough.riskFlags.some((flag) => flag.flag === 'INSUFFICIENT_HISTORICAL_DATA')).toBe(
      false
    );
  });

  it('withholds historical statistics entirely below the minimum sample size', () => {
    const decision = engine.evaluate(
      makeFeatures({ historicalOutcomes: { sampleSize: MIN_HISTORICAL_SAMPLE - 1, recoveredCount: 10 } })
    );
    const support = decision.factors.find((factor) => factor.name === 'historicalSupport');
    expect(support?.contribution).toBe(0);
  });
});

describe('DeterministicDecisionEngine failure categories', () => {
  it.each([
    ['GATEWAY_ERROR', 'TRANSIENT'],
    ['network_timeout', 'TRANSIENT'],
    ['insufficient_funds', 'INSUFFICIENT_FUNDS'],
    ['card_authentication_failed', 'AUTHENTICATION'],
    ['lost_card', 'HARD_DECLINE'],
    ['FRAUD_SUSPECTED', 'HARD_DECLINE'],
    ['totally_unknown_code', 'UNKNOWN'],
    [null, 'UNKNOWN'],
  ])('categorizes %s as %s', (code, expected) => {
    expect(categorizeFailureCode(code).category).toBe(expected);
  });

  it('never recommends RETRY for hard declines even at high scores', () => {
    const decision = engine.evaluate(
      makeFeatures({
        recoverableAmount: 9_000_000,
        failureCategory: 'HARD_DECLINE',
        failureCode: 'stolen_card',
        historicalOutcomes: { sampleSize: 200, recoveredCount: 100 },
      })
    );
    expect(decision.recommendedAction).toBe('DO_NOT_RETRY');
    expect(decision.riskFlags.some((flag) => flag.flag === 'NON_RECOVERABLE_CONDITION')).toBe(
      true
    );
  });

  it('requires customer action for authentication and funding failures', () => {
    const auth = engine.evaluate(
      makeFeatures({ failureCategory: 'AUTHENTICATION', failureCode: 'otp_invalid' })
    );
    const funds = engine.evaluate(
      makeFeatures({ failureCategory: 'INSUFFICIENT_FUNDS', failureCode: 'insuff_funds' })
    );
    expect(auth.recommendedAction).toBe('CUSTOMER_ACTION_REQUIRED');
    expect(funds.recommendedAction).toBe('CUSTOMER_ACTION_REQUIRED');
  });

  it('routes unknown categories to REVIEW instead of guessing', () => {
    const decision = engine.evaluate(
      makeFeatures({
        failureCategory: 'UNKNOWN',
        failureCode: 'mystery_code',
      })
    );
    expect(decision.recommendedAction).toBe('REVIEW');
  });
});

describe('DeterministicDecisionEngine retry behavior', () => {
  const RECENT_RETRY = new Date(1_800_000_000_000 - 10 * 60 * 1000); // 10 min before evaluation

  it('recommends WAIT when several attempts happened moments ago', () => {
    const decision = engine.evaluate(
      makeFeatures({
        observedFailedRetries: 3,
        lastFailedRetryAt: RECENT_RETRY,
      })
    );
    expect(decision.recommendedAction).toBe('WAIT');
    expect(decision.reasons.some((reason) => reason.startsWith('Recommendation: WAIT'))).toBe(
      true
    );
  });

  it('does not recommend WAIT once the last attempt is comfortably old', () => {
    const stale = new Date(1_800_000_000_000 - 6 * HOUR_MS);
    const decision = engine.evaluate(
      makeFeatures({ observedFailedRetries: 2, lastFailedRetryAt: stale })
    );
    expect(decision.recommendedAction).not.toBe('WAIT');
  });

  it('escalates to REVIEW after an aggressive number of failed attempts', () => {
    const decision = engine.evaluate(
      makeFeatures({
        observedFailedRetries: 4,
        lastFailedRetryAt: new Date(1_800_000_000_000 - 3 * 24 * HOUR_MS),
      })
    );
    expect(decision.recommendedAction).toBe('REVIEW');
    expect(decision.riskFlags.some((flag) => flag.flag === 'HIGH_RETRY_COUNT')).toBe(true);
  });

  it('recommends RETRY for a clean transient case', () => {
    const decision = engine.evaluate(
      makeFeatures({
        historicalOutcomes: { sampleSize: 120, recoveredCount: 60 },
      })
    );
    expect(decision.recommendedAction).toBe('RETRY');
  });
});

describe('DeterministicDecisionEngine safety & lifecycle', () => {
  it('takes no action on closed opportunities regardless of signals', () => {
    for (const status of ['RECOVERED', 'EXPIRED', 'DISMISSED'] as const) {
      const decision = engine.evaluate(makeFeatures({ opportunityStatus: status }));
      expect(decision.recommendedAction).toBe('NO_ACTION');
    }
  });
});

describe('DeterministicDecisionEngine determinism & explainability', () => {
  it('produces identical output for identical input', () => {
    const features = makeFeatures();
    const first = engine.evaluate(features);
    const second = engine.evaluate(features);
    expect(second).toEqual(first);
  });

  it('always explains itself: every factor carries a reason', () => {
    const decision = engine.evaluate(makeFeatures());
    expect(decision.factors.length).toBeGreaterThanOrEqual(5);
    for (const factor of decision.factors) {
      expect(factor.name.trim()).not.toBe('');
      expect(factor.explanation.trim()).not.toBe('');
    }
    expect(decision.reasons.length).toBeGreaterThan(0);
  });

  it('always stamps the engine version', () => {
    void engine;
    expect(DECISION_ENGINE_VERSION).toBe('v1');
  });
});
