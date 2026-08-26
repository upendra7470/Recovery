import { describe, expect, it } from 'vitest';
import { constrainAdvice } from '../../src/ai/safety.js';
import type { RecoveryAIAdviceRequest } from '../../src/domain/recovery-ai-advice.js';

function decisionContext(overrides: Partial<RecoveryAIAdviceRequest> = {}) {
  return {
    recommendation: 'RETRY',
    riskFlags: [],
    failureCode: 'GATEWAY_ERROR' as string | null,
    confidence: 71,
    ...overrides,
  };
}

const safeContent = {
  summary: 'Transient gateway failure shortly after checkout.',
  explanation:
    'The gateway timed out during processing; the authoritative retry decision fits this pattern.',
  nextStep: 'Schedule one retry within the standard backoff window.',
  customerMessage: null,
  operatorMessage: null,
  confidence: 70,
  warnings: [],
};

describe('constrainAdvice safety guard', () => {
  it('leaves consistent advice untouched', () => {
    const guarded = constrainAdvice({ content: safeContent, decision: decisionContext() });
    expect(guarded.safetyConstrained).toBe(false);
    expect(guarded.content.warnings).toEqual([]);
  });

  it('keeps the deterministic DO_NOT_RETRY decision when AI text suggests a retry', () => {
    const guarded = constrainAdvice({
      content: {
        ...safeContent,
        summary: 'Card was reported stolen; you should retry immediately on another channel.',
        nextStep: 'Retry now with a different payment method.',
      },
      decision: decisionContext({ recommendation: 'DO_NOT_RETRY' }),
    });

    // The guard cannot rewrite the model text, but it MUST flag it and never
    // let it touch the authoritative action (which lives outside advice).
    expect(guarded.safetyConstrained).toBe(true);
    expect(
      guarded.content.warnings.some((warning) =>
        warning.includes('contradicts the authoritative decision "DO_NOT_RETRY"')
      )
    ).toBe(true);
  });

  it('flags retry suggestions whenever NON_RECOVERABLE_CONDITION is flagged', () => {
    const guarded = constrainAdvice({
      content: {
        ...safeContent,
        explanation:
          'Even though this card was blocked, an attempt to try again later may work.',
      },
      decision: decisionContext({
        recommendation: 'REVIEW',
        riskFlags: [
          {
            flag: 'NON_RECOVERABLE_CONDITION',
            explanation: 'Failure code matches a hard-decline condition.',
          },
        ],
      }),
    });

    expect(guarded.safetyConstrained).toBe(true);
  });

  it('does not flag neutral operational wording that merely mentions past retries', () => {
    const guarded = constrainAdvice({
      content: {
        ...safeContent,
        explanation:
          'No further failed retries were observed after the source failure; the case remains open per the authoritative decision.',
      },
      decision: decisionContext({ recommendation: 'WAIT' }),
    });
    expect(guarded.safetyConstrained).toBe(false);
  });

  it('records an evidence-gap warning when no failure code exists', () => {
    const guarded = constrainAdvice({
      content: safeContent,
      decision: decisionContext({ failureCode: null }),
    });
    expect(guarded.content.warnings.some((w) => /no provider failure code/i.test(w))).toBe(true);
    expect(guarded.safetyConstrained).toBe(false);
  });

  it('never manufactures certainty: low deterministic confidence stays visible in warnings trail', () => {
    // The guard does not alter confidence fields — it only adds warnings.
    // This test pins that behavior: advice passes through unchanged except
    // for evidence-gap annotation.
    const guarded = constrainAdvice({
      content: { ...safeContent, confidence: 95 },
      decision: decisionContext({ confidence: 12, failureCode: null }),
    });
    // AI's self-confidence is preserved verbatim (it is advisory metadata),
    // while the deterministic confidence (12) remains the one shown as the
    // decision's confidence elsewhere. Guard only annotates the gap.
    expect(guarded.content.confidence).toBe(95);
    expect(guarded.content.warnings.some((w) => /failure code/i.test(w))).toBe(true);
  });
});
