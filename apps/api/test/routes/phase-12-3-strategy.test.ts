import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import {
  createDbExecutorMock,
  makeTestEnv,
  InMemoryPaymentEventStore,
  InMemoryRecoveryOpportunityStore,
  InMemoryRecoveryDecisionStore,
  InMemoryRecoveryAIAdviceStore,
  InMemoryRecoveryExecutionStore,
  createMerchantStrategyMemoryStoreMock,
} from '../helpers.js';
import { rankStrategies, calculateStrategyScore, validateAiStrategy } from '../../src/services/strategy-ranking.js';
import {
  getStrategyCandidates,
  getDefaultStrategy,
  isValidStrategyForModule,
  actionToStrategy,
} from '../../src/modules/module-strategies.js';
import type { MerchantStrategyMemoryRow } from '../../src/domain/merchant-memory.js';

/**
 * Phase 12.3 — Adaptive Module Strategy Selection Tests
 *
 * Tests:
 * A. Strategy ranking from merchant memory
 * B. Highest-performing strategy ranked first
 * C. Cold-start behavior
 * D. Insufficient sample handling
 * E. Merchant isolation
 * F. Failure-type isolation
 * G. Module strategy validation
 * H. Invalid AI strategy rejected
 * I. AI cannot bypass safety policy
 * J. Historical evidence comes from database
 * K. Successful recovery updates memory
 * L. Next decision sees updated memory
 * M. Existing module execution remains functional
 * N. Existing /demo remains functional
 * O. Existing Phase 12.2 tests remain passing
 * P. No paid/external AI dependency required
 */

function createMockStores() {
  const paymentEvent = new InMemoryPaymentEventStore();
  const recoveryOpportunity = new InMemoryRecoveryOpportunityStore();
  const recoveryDecision = new InMemoryRecoveryDecisionStore();
  const recoveryAIAdvice = new InMemoryRecoveryAIAdviceStore();
  const recoveryExecution = new InMemoryRecoveryExecutionStore();
  const merchantStrategyMemory = createMerchantStrategyMemoryStoreMock();
  return { paymentEvent, recoveryOpportunity, recoveryDecision, recoveryAIAdvice, recoveryExecution, merchantStrategyMemory };
}

function createMockDb(stores: ReturnType<typeof createMockStores>) {
  return createDbExecutorMock(
    async (strings: TemplateStringsArray) => {
      const query = strings.join(' ');
      if (query.includes('recovery_opportunities')) {
        const rows = [...stores.recoveryOpportunity.rows.values()];
        const openCount = rows.filter((r) => r.status === 'OPEN').length;
        const recoveredCount = rows.filter((r) => r.status === 'RECOVERED').length;
        const riskSum = rows.filter((r) => r.status === 'OPEN').reduce((s, r) => s + r.amountAtRisk, 0);
        const recoveredSum = rows.filter((r) => r.status === 'RECOVERED').reduce((s, r) => s + r.amountAtRisk, 0);
        const totalSum = rows.reduce((s, r) => s + r.amountAtRisk, 0);
        return [{ openCount, recoveredCount, riskSum, recoveredSum, totalSum, count: rows.length }];
      }
      if (query.includes('recovery_executions')) {
        const rows = [...stores.recoveryExecution.rows.values()];
        const blockedCount = rows.filter((r) => r.status === 'BLOCKED').length;
        const succeededCount = rows.filter((r) => r.status === 'SUCCEEDED').length;
        return [{ blockedCount, succeededCount, count: rows.length }];
      }
      if (query.includes('recovery_decisions')) {
        const rows = [...stores.recoveryDecision.rows.values()];
        const reviewCount = rows.filter((r) => r.recommendedAction === 'REVIEW').length;
        return [{ reviewCount, count: rows.length }];
      }
      return [{ count: 0 }];
    },
    stores
  );
}

// ---------------------------------------------------------------------------
// A. Strategy ranking from merchant memory
// ---------------------------------------------------------------------------
describe('Phase 12.3 — A. Strategy ranking from merchant memory', () => {
  it('rankStrategies returns ranked strategies for a merchant', () => {
    const rows: MerchantStrategyMemoryRow[] = [
      {
        id: '1', merchantId: 'm1', strategy: 'RETRY', failureType: 'GATEWAY_ERROR',
        attempts: 10, successes: 8, failures: 2, blocked: 0, humanReviews: 0,
        totalAmountAttempted: 10000, totalAmountRecovered: 8000,
        successRate: 0.8, recoveryRate: 0.8, sampleCount: 10,
        confidence: 68, effectivenessScore: 72.5, lastObservedAt: new Date(),
        createdAt: new Date(), updatedAt: new Date(),
      },
      {
        id: '2', merchantId: 'm1', strategy: 'PAYMENT_LINK', failureType: 'GATEWAY_ERROR',
        attempts: 5, successes: 2, failures: 3, blocked: 0, humanReviews: 0,
        totalAmountAttempted: 5000, totalAmountRecovered: 2000,
        successRate: 0.4, recoveryRate: 0.4, sampleCount: 5,
        confidence: 40, effectivenessScore: 38.0, lastObservedAt: new Date(),
        createdAt: new Date(), updatedAt: new Date(),
      },
    ];

    const result = rankStrategies('m1', 'FAILED_PAYMENT', 'GATEWAY_ERROR', rows);

    expect(result.strategies.length).toBeGreaterThanOrEqual(2);
    expect(result.strategies[0]!.strategy).toBe('RETRY');
    expect(result.strategies[0]!.score).toBeGreaterThan(result.strategies[1]!.score);
    expect(result.recommended).toBe('RETRY');
    expect(result.confidence).toBe('SUFFICIENT');
    expect(result.isColdStart).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B. Highest-performing strategy ranked first
// ---------------------------------------------------------------------------
describe('Phase 12.3 — B. Highest-performing strategy ranked first', () => {
  it('ranks PAYMENT_LINK above RETRY when it has better performance', () => {
    const rows: MerchantStrategyMemoryRow[] = [
      {
        id: '1', merchantId: 'm1', strategy: 'RETRY', failureType: 'INVOICE_OVERDUE',
        attempts: 10, successes: 3, failures: 7, blocked: 0, humanReviews: 0,
        totalAmountAttempted: 10000, totalAmountRecovered: 3000,
        successRate: 0.3, recoveryRate: 0.3, sampleCount: 10,
        confidence: 68, effectivenessScore: 35.0, lastObservedAt: new Date(),
        createdAt: new Date(), updatedAt: new Date(),
      },
      {
        id: '2', merchantId: 'm1', strategy: 'PAYMENT_LINK', failureType: 'INVOICE_OVERDUE',
        attempts: 15, successes: 12, failures: 3, blocked: 0, humanReviews: 0,
        totalAmountAttempted: 15000, totalAmountRecovered: 12000,
        successRate: 0.8, recoveryRate: 0.8, sampleCount: 15,
        confidence: 80, effectivenessScore: 85.0, lastObservedAt: new Date(),
        createdAt: new Date(), updatedAt: new Date(),
      },
    ];

    const result = rankStrategies('m1', 'B2B_RECEIVABLE', 'INVOICE_OVERDUE', rows);

    expect(result.strategies[0]!.strategy).toBe('PAYMENT_LINK');
    expect(result.strategies[1]!.strategy).toBe('RETRY');
    expect(result.recommended).toBe('PAYMENT_LINK');
    expect(result.confidence).toBe('SUFFICIENT');
  });
});

// ---------------------------------------------------------------------------
// C. Cold-start behavior
// ---------------------------------------------------------------------------
describe('Phase 12.3 — C. Cold-start behavior', () => {
  it('returns INSUFFICIENT confidence with default strategy when no memory rows exist', () => {
    const result = rankStrategies('m_new', 'FAILED_PAYMENT', 'GATEWAY_ERROR', []);

    expect(result.confidence).toBe('INSUFFICIENT');
    expect(result.isColdStart).toBe(true);
    expect(result.recommended).toBe('RETRY'); // default for FAILED_PAYMENT
    expect(result.reason).toContain('Insufficient merchant history');
    expect(result.totalSamples).toBe(0);
  });

  it('uses module-specific default strategy during cold-start', () => {
    const resultB2B = rankStrategies('m_new', 'B2B_RECEIVABLE', 'INVOICE_OVERDUE', []);
    expect(resultB2B.recommended).toBe('PAYMENT_LINK'); // default for B2B

    const resultSub = rankStrategies('m_new', 'SUBSCRIPTION_RECOVERY', 'GATEWAY_ERROR', []);
    expect(resultSub.recommended).toBe('RETRY'); // default for SUBSCRIPTION

    const resultDeg = rankStrategies('m_new', 'PAYMENT_DEGRADATION', 'GATEWAY_TIMEOUT', []);
    expect(resultDeg.recommended).toBe('REVIEW'); // default for DEGRADATION
  });
});

// ---------------------------------------------------------------------------
// D. Insufficient sample handling
// ---------------------------------------------------------------------------
describe('Phase 12.3 — D. Insufficient sample handling', () => {
  it('returns LOW confidence when samples exist but below threshold', () => {
    const rows: MerchantStrategyMemoryRow[] = [
      {
        id: '1', merchantId: 'm1', strategy: 'RETRY', failureType: 'GATEWAY_ERROR',
        attempts: 2, successes: 1, failures: 1, blocked: 0, humanReviews: 0,
        totalAmountAttempted: 2000, totalAmountRecovered: 1000,
        successRate: 0.5, recoveryRate: 0.5, sampleCount: 2,
        confidence: 15, effectivenessScore: 40.0, lastObservedAt: new Date(),
        createdAt: new Date(), updatedAt: new Date(),
      },
    ];

    const result = rankStrategies('m1', 'FAILED_PAYMENT', 'GATEWAY_ERROR', rows);

    expect(result.confidence).toBe('LOW');
    expect(result.isColdStart).toBe(false);
    expect(result.strategies[0]!.strategy).toBe('RETRY');
    expect(result.strategies[0]!.sampleCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// E. Merchant isolation
// ---------------------------------------------------------------------------
describe('Phase 12.3 — E. Merchant isolation', () => {
  it('only uses memory rows for the specified merchant', () => {
    const rows: MerchantStrategyMemoryRow[] = [
      {
        id: '1', merchantId: 'm1', strategy: 'RETRY', failureType: 'GATEWAY_ERROR',
        attempts: 20, successes: 18, failures: 2, blocked: 0, humanReviews: 0,
        totalAmountAttempted: 20000, totalAmountRecovered: 18000,
        successRate: 0.9, recoveryRate: 0.9, sampleCount: 20,
        confidence: 88, effectivenessScore: 90.0, lastObservedAt: new Date(),
        createdAt: new Date(), updatedAt: new Date(),
      },
      {
        id: '2', merchantId: 'm2', strategy: 'RETRY', failureType: 'GATEWAY_ERROR',
        attempts: 1, successes: 0, failures: 1, blocked: 0, humanReviews: 0,
        totalAmountAttempted: 1000, totalAmountRecovered: 0,
        successRate: 0, recoveryRate: 0, sampleCount: 1,
        confidence: 4, effectivenessScore: 5.0, lastObservedAt: new Date(),
        createdAt: new Date(), updatedAt: new Date(),
      },
    ];

    const resultM1 = rankStrategies('m1', 'FAILED_PAYMENT', 'GATEWAY_ERROR', rows);
    const resultM2 = rankStrategies('m2', 'FAILED_PAYMENT', 'GATEWAY_ERROR', rows);

    expect(resultM1.confidence).toBe('SUFFICIENT');
    expect(resultM1.strategies[0]!.sampleCount).toBe(20);

    expect(resultM2.confidence).toBe('LOW');
    expect(resultM2.strategies[0]!.sampleCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F. Failure-type isolation
// ---------------------------------------------------------------------------
describe('Phase 12.3 — F. Failure-type isolation', () => {
  it('only uses memory rows for the specified failure type', () => {
    const rows: MerchantStrategyMemoryRow[] = [
      {
        id: '1', merchantId: 'm1', strategy: 'RETRY', failureType: 'GATEWAY_ERROR',
        attempts: 15, successes: 12, failures: 3, blocked: 0, humanReviews: 0,
        totalAmountAttempted: 15000, totalAmountRecovered: 12000,
        successRate: 0.8, recoveryRate: 0.8, sampleCount: 15,
        confidence: 80, effectivenessScore: 82.0, lastObservedAt: new Date(),
        createdAt: new Date(), updatedAt: new Date(),
      },
      {
        id: '2', merchantId: 'm1', strategy: 'RETRY', failureType: 'expired_card',
        attempts: 5, successes: 1, failures: 4, blocked: 0, humanReviews: 0,
        totalAmountAttempted: 5000, totalAmountRecovered: 1000,
        successRate: 0.2, recoveryRate: 0.2, sampleCount: 5,
        confidence: 40, effectivenessScore: 25.0, lastObservedAt: new Date(),
        createdAt: new Date(), updatedAt: new Date(),
      },
    ];

    const resultGateway = rankStrategies('m1', 'FAILED_PAYMENT', 'GATEWAY_ERROR', rows);
    const resultExpired = rankStrategies('m1', 'FAILED_PAYMENT', 'expired_card', rows);

    expect(resultGateway.confidence).toBe('SUFFICIENT');
    expect(resultGateway.strategies[0]!.successRate).toBe(0.8);

    expect(resultExpired.confidence).toBe('SUFFICIENT');
    expect(resultExpired.strategies[0]!.successRate).toBe(0.2);
  });
});

// ---------------------------------------------------------------------------
// G. Module strategy validation
// ---------------------------------------------------------------------------
describe('Phase 12.3 — G. Module strategy validation', () => {
  it('getStrategyCandidates returns correct candidates per module', () => {
    const failedPayment = getStrategyCandidates('FAILED_PAYMENT');
    expect(failedPayment.length).toBe(4);
    expect(failedPayment.map((c) => c.strategy)).toContain('RETRY');
    expect(failedPayment.find((c) => c.strategy === 'RETRY')?.isDefault).toBe(true);

    const b2b = getStrategyCandidates('B2B_RECEIVABLE');
    expect(b2b.length).toBe(4);
    expect(b2b.find((c) => c.strategy === 'PAYMENT_LINK')?.isDefault).toBe(true);

    const degradation = getStrategyCandidates('PAYMENT_DEGRADATION');
    expect(degradation.length).toBe(3);
    expect(degradation.find((c) => c.strategy === 'REVIEW')?.isDefault).toBe(true);
  });

  it('isValidStrategyForModule returns true for valid strategies', () => {
    expect(isValidStrategyForModule('FAILED_PAYMENT', 'RETRY')).toBe(true);
    expect(isValidStrategyForModule('FAILED_PAYMENT', 'PAYMENT_LINK')).toBe(true);
    expect(isValidStrategyForModule('FAILED_PAYMENT', 'INVALID_STRATEGY')).toBe(false);
  });

  it('getDefaultStrategy returns the default for each module', () => {
    expect(getDefaultStrategy('FAILED_PAYMENT')).toBe('RETRY');
    expect(getDefaultStrategy('B2B_RECEIVABLE')).toBe('PAYMENT_LINK');
    expect(getDefaultStrategy('PAYMENT_DEGRADATION')).toBe('REVIEW');
    expect(getDefaultStrategy('CHECKOUT_DROPOFF')).toBe('PAYMENT_LINK');
  });

  it('actionToStrategy maps actions to memory strategies', () => {
    expect(actionToStrategy('RETRY')).toBe('RETRY');
    expect(actionToStrategy('RETRY_LATER')).toBe('RETRY');
    expect(actionToStrategy('SEND_PAYMENT_LINK')).toBe('PAYMENT_LINK');
    expect(actionToStrategy('DO_NOT_RETRY')).toBe('DO_NOT_RETRY');
    expect(actionToStrategy('HUMAN_REVIEW')).toBe('REVIEW');
  });
});

// ---------------------------------------------------------------------------
// H. Invalid AI strategy rejected
// ---------------------------------------------------------------------------
describe('Phase 12.3 — H. Invalid AI strategy rejected', () => {
  it('validateAiStrategy rejects unknown strategy', () => {
    const candidates = getStrategyCandidates('FAILED_PAYMENT');
    const result = validateAiStrategy('FAILED_PAYMENT', 'INVALID_STRATEGY', candidates);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not a valid candidate');
  });

  it('validateAiStrategy accepts valid strategy', () => {
    const candidates = getStrategyCandidates('FAILED_PAYMENT');
    const result = validateAiStrategy('FAILED_PAYMENT', 'RETRY', candidates);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// I. AI cannot bypass safety policy
// ---------------------------------------------------------------------------
describe('Phase 12.3 — I. AI cannot bypass safety policy', () => {
  it('module scenario with unsafe evidence is blocked regardless of AI', async () => {
    const stores = createMockStores();
    const app = await buildApp({
      env: makeTestEnv({ DEMO_MODE_ENABLED: 'true' }),
      db: createMockDb(stores),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/demo/run/module/subscription_unsafe',
      });

      expect(response.statusCode).toBe(201);
      const body: Record<string, unknown> = response.json();
      expect(body['executionStatus']).toBe('BLOCKED');
      expect(body['recovered']).toBe(false);
      expect(body['recoveredAmount']).toBe(0);

      // Strategy intelligence should still be present even when blocked
      const strategyIntel = body['strategyIntelligence'] as Record<string, unknown> | undefined;
      expect(strategyIntel).toBeDefined();
      expect(strategyIntel!['ranking']).toBeDefined();
      expect(strategyIntel!['candidateStrategies']).toBeDefined();
      expect(typeof strategyIntel!['executedStrategy']).toBe('string');
      expect(typeof strategyIntel!['aiStrategyValidated']).toBe('boolean');
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// J. Historical evidence comes from database
// ---------------------------------------------------------------------------
describe('Phase 12.3 — J. Historical evidence comes from database', () => {
  it('module scenario includes strategy intelligence from merchant memory', async () => {
    const stores = createMockStores();
    const app = await buildApp({
      env: makeTestEnv({ DEMO_MODE_ENABLED: 'true' }),
      db: createMockDb(stores),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/demo/run/module/subscription_success',
      });

      expect(response.statusCode).toBe(201);
      const body: Record<string, unknown> = response.json();

      // Strategy intelligence should be present
      const strategyIntel = body['strategyIntelligence'] as Record<string, unknown> | undefined;
      expect(strategyIntel).toBeDefined();

      if (strategyIntel) {
        const ranking = strategyIntel['ranking'] as Record<string, unknown>;
        expect(ranking).toBeDefined();
        expect(ranking['confidence']).toBeDefined();
        expect(ranking['recommended']).toBeDefined();
        expect(ranking['reason']).toBeDefined();
        expect(ranking['totalSamples']).toBeDefined();

        const candidates = strategyIntel['candidateStrategies'] as Array<Record<string, unknown>>;
        expect(candidates).toBeDefined();
        expect(candidates.length).toBeGreaterThanOrEqual(3);

        expect(strategyIntel['executedStrategy']).toBeDefined();
        expect(typeof strategyIntel['aiStrategyValidated']).toBe('boolean');
      }
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// K. Successful recovery updates memory
// ---------------------------------------------------------------------------
describe('Phase 12.3 — K. Successful recovery updates memory', () => {
  it('successful module scenario records outcome in merchant memory', async () => {
    const stores = createMockStores();
    const app = await buildApp({
      env: makeTestEnv({ DEMO_MODE_ENABLED: 'true' }),
      db: createMockDb(stores),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/demo/run/module/subscription_success',
      });

      expect(response.statusCode).toBe(201);
      const body: Record<string, unknown> = response.json();
      expect(body['recovered']).toBe(true);
      expect(body['recoveredAmount']).toBeGreaterThan(0);

      // Verify merchant memory was updated
      const memoryRows = await stores.merchantStrategyMemory.listByMerchant(
        '00000000-0000-4000-8000-000000000099'
      );
      expect(memoryRows.length).toBeGreaterThanOrEqual(1);
      const successRow = memoryRows.find((r) => r.successes > 0);
      expect(successRow).toBeDefined();
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// L. Next decision sees updated memory
// ---------------------------------------------------------------------------
describe('Phase 12.3 — L. Next decision sees updated memory', () => {
  it('second run of same module shows updated strategy evidence in merchant memory', async () => {
    const stores = createMockStores();
    const app = await buildApp({
      env: makeTestEnv({ DEMO_MODE_ENABLED: 'true' }),
      db: createMockDb(stores),
    });

    try {
      // Run 1: No history → cold start
      const response1 = await app.inject({
        method: 'POST',
        url: '/demo/run/module/subscription_success',
      });
      expect(response1.statusCode).toBe(201);
      const body1: Record<string, unknown> = response1.json();
      expect(body1['recovered']).toBe(true);

      // Verify memory was updated after run 1
      const memoryAfterRun1 = await stores.merchantStrategyMemory.listByMerchant(
        '00000000-0000-4000-8000-000000000099'
      );
      expect(memoryAfterRun1.length).toBeGreaterThanOrEqual(1);
      expect(memoryAfterRun1.some((r) => r.successes > 0)).toBe(true);

      // Run 2: Memory now has data from run 1
      const response2 = await app.inject({
        method: 'POST',
        url: '/demo/run/module/subscription_success',
      });
      expect(response2.statusCode).toBe(201);
      const body2: Record<string, unknown> = response2.json();
      expect(body2['recovered']).toBe(true);

      // Verify memory was updated again
      const memoryAfterRun2 = await stores.merchantStrategyMemory.listByMerchant(
        '00000000-0000-4000-8000-000000000099'
      );
      expect(memoryAfterRun2.length).toBeGreaterThanOrEqual(1);
      // At least one row should have more than 1 attempt
      expect(memoryAfterRun2.some((r) => r.attempts >= 2)).toBe(true);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// M. Existing module execution remains functional
// ---------------------------------------------------------------------------
describe('Phase 12.3 — M. Existing module execution remains functional', () => {
  for (const scenario of ['subscription_success', 'mandate_success', 'b2b_success', 'checkout_recovery'] as const) {
    it(`${scenario}: still recovers with strategy intelligence`, async () => {
      const stores = createMockStores();
      const app = await buildApp({
        env: makeTestEnv({ DEMO_MODE_ENABLED: 'true' }),
        db: createMockDb(stores),
      });

      try {
        const response = await app.inject({
          method: 'POST',
          url: `/demo/run/module/${scenario}`,
        });

        expect(response.statusCode).toBe(201);
        const body: Record<string, unknown> = response.json();
        expect(body['recovered']).toBe(true);
        expect(body['recoveredAmount']).toBeGreaterThan(0);
        expect(body['executionStatus']).toBe('EXECUTED');

        // Strategy intelligence should be present
        const strategyIntel = body['strategyIntelligence'] as Record<string, unknown> | undefined;
        expect(strategyIntel).toBeDefined();
      } finally {
        await app.close();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// N. Existing /demo remains functional
// ---------------------------------------------------------------------------
describe('Phase 12.3 — N. Existing /demo remains functional', () => {
  it('POST /demo/run/all still works with 3 scenarios', async () => {
    const stores = createMockStores();
    const app = await buildApp({
      env: makeTestEnv({ DEMO_MODE_ENABLED: 'true' }),
      db: createMockDb(stores),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/demo/run',
        payload: { scenario: 'all' },
      });

      expect(response.statusCode).toBe(201);
      const body: Record<string, unknown> = response.json();
      expect(body['demoRunId']).toBeTruthy();
      expect((body['scenarios'] as unknown[]).length).toBe(3);

      const summary = body['summary'] as Record<string, unknown>;
      expect(summary['totalScenarios']).toBe(3);
      expect(summary['successfulRecovery']).toBe(1);
      expect(summary['unsafeRecovery']).toBe(1);
      expect(summary['reviewCase']).toBe(1);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// O. Existing Phase 12.2 tests remain passing (checked via full test suite)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// P. No paid/external AI dependency required
// ---------------------------------------------------------------------------
describe('Phase 12.3 — P. No paid/external AI dependency required', () => {
  it('strategy ranking works without AI provider', () => {
    const rows: MerchantStrategyMemoryRow[] = [
      {
        id: '1', merchantId: 'm1', strategy: 'RETRY', failureType: 'GATEWAY_ERROR',
        attempts: 10, successes: 8, failures: 2, blocked: 0, humanReviews: 0,
        totalAmountAttempted: 10000, totalAmountRecovered: 8000,
        successRate: 0.8, recoveryRate: 0.8, sampleCount: 10,
        confidence: 68, effectivenessScore: 72.5, lastObservedAt: new Date(),
        createdAt: new Date(), updatedAt: new Date(),
      },
    ];

    const result = rankStrategies('m1', 'FAILED_PAYMENT', 'GATEWAY_ERROR', rows);
    expect(result.recommended).toBe('RETRY');
    expect(result.confidence).toBe('SUFFICIENT');
  });

  it('calculateStrategyScore is deterministic', () => {
    const score1 = calculateStrategyScore(0.8, 72.5, 68);
    const score2 = calculateStrategyScore(0.8, 72.5, 68);
    expect(score1).toBe(score2);
    expect(score1).toBeGreaterThan(0);
    expect(score1).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Strategy intelligence in demo route responses
// ---------------------------------------------------------------------------
describe('Phase 12.3 — Strategy intelligence in demo routes', () => {
  it('module scenario includes strategy intelligence in response', async () => {
    const stores = createMockStores();
    const app = await buildApp({
      env: makeTestEnv({ DEMO_MODE_ENABLED: 'true' }),
      db: createMockDb(stores),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/demo/run/module/b2b_success',
      });

      expect(response.statusCode).toBe(201);
      const body: Record<string, unknown> = response.json();

      const strategyIntel = body['strategyIntelligence'] as Record<string, unknown>;
      expect(strategyIntel).toBeDefined();

      // Verify all required fields
      expect(strategyIntel['ranking']).toBeDefined();
      expect(strategyIntel['candidateStrategies']).toBeDefined();
      expect(strategyIntel['executedStrategy']).toBeDefined();
      expect(typeof strategyIntel['aiStrategyValidated']).toBe('boolean');

      // Verify candidates are valid for B2B module
      const candidates = strategyIntel['candidateStrategies'] as Array<Record<string, unknown>>;
      const strategies = candidates.map((c) => c['strategy']);
      expect(strategies).toContain('PAYMENT_LINK');
      expect(strategies).toContain('RETRY');
      expect(strategies).toContain('REVIEW');
    } finally {
      await app.close();
    }
  });

  it('degradation scenario includes REVIEW as default strategy', async () => {
    const stores = createMockStores();
    const app = await buildApp({
      env: makeTestEnv({ DEMO_MODE_ENABLED: 'true' }),
      db: createMockDb(stores),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/demo/run/module/degradation_incident',
      });

      expect(response.statusCode).toBe(201);
      const body: Record<string, unknown> = response.json();

      const strategyIntel = body['strategyIntelligence'] as Record<string, unknown>;
      expect(strategyIntel).toBeDefined();

      const ranking = strategyIntel['ranking'] as Record<string, unknown>;
      expect(ranking['recommended']).toBe('REVIEW');
      expect(ranking['confidence']).toBe('INSUFFICIENT');
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Score calculation tests
// ---------------------------------------------------------------------------
describe('Phase 12.3 — Score calculation', () => {
  it('score increases with better success rate', () => {
    const low = calculateStrategyScore(0.3, 40, 30);
    const high = calculateStrategyScore(0.9, 90, 90);
    expect(high).toBeGreaterThan(low);
  });

  it('score is bounded between 0 and 100', () => {
    const score = calculateStrategyScore(1, 100, 100);
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThan(0);
  });

  it('score with zero metrics is 0', () => {
    const score = calculateStrategyScore(0, 0, 0);
    expect(score).toBe(0);
  });
});
