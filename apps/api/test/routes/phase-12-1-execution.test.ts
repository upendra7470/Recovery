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
} from '../helpers.js';

describe('Phase 12.1 — Module Recovery Execution (Routes)', () => {

  describe('Successful module scenarios (recovery verified)', () => {
    for (const scenario of ['subscription_success', 'mandate_success', 'b2b_success', 'checkout_recovery'] as const) {
      it(`${scenario}: executes through full pipeline and recovers`, async () => {
        const paymentEvent = new InMemoryPaymentEventStore();
        const recoveryOpportunity = new InMemoryRecoveryOpportunityStore();
        const recoveryDecision = new InMemoryRecoveryDecisionStore();
        const recoveryAIAdvice = new InMemoryRecoveryAIAdviceStore();
        const recoveryExecution = new InMemoryRecoveryExecutionStore();

        const mockDb = createDbExecutorMock(
          async (strings: TemplateStringsArray) => {
            const query = strings.join(' ');
            if (query.includes('recovery_opportunities')) {
              const rows = [...recoveryOpportunity.rows.values()];
              const openCount = rows.filter((r) => r.status === 'OPEN').length;
              const recoveredCount = rows.filter((r) => r.status === 'RECOVERED').length;
              const riskSum = rows.filter((r) => r.status === 'OPEN').reduce((s, r) => s + r.amountAtRisk, 0);
              const recoveredSum = rows.filter((r) => r.status === 'RECOVERED').reduce((s, r) => s + r.amountAtRisk, 0);
              const totalSum = rows.reduce((s, r) => s + r.amountAtRisk, 0);
              return [{ openCount, recoveredCount, riskSum, recoveredSum, totalSum, count: rows.length }];
            }
            if (query.includes('recovery_executions')) {
              const rows = [...recoveryExecution.rows.values()];
              const blockedCount = rows.filter((r) => r.status === 'BLOCKED').length;
              const succeededCount = rows.filter((r) => r.status === 'SUCCEEDED').length;
              return [{ blockedCount, succeededCount, count: rows.length }];
            }
            if (query.includes('recovery_decisions')) {
              const rows = [...recoveryDecision.rows.values()];
              const reviewCount = rows.filter((r) => r.recommendedAction === 'REVIEW').length;
              return [{ reviewCount, count: rows.length }];
            }
            return [{ count: 0 }];
          },
          { paymentEvent, recoveryOpportunity, recoveryDecision, recoveryAIAdvice, recoveryExecution }
        );

        const app = await buildApp({
          env: makeTestEnv({ DEMO_MODE_ENABLED: 'true' }),
          db: mockDb,
        });

        try {
          const response = await app.inject({
            method: 'POST',
            url: `/demo/run/module/${scenario}`,
          });

          expect(response.statusCode).toBe(201);
          const body: Record<string, unknown> = response.json();

          // Module type detected correctly
          expect(body['moduleType']).toBeTruthy();
          expect(body['scenario']).toBe(scenario);

          // Decision engine ran
          expect(body['decisionAction']).toBe('RETRY');
          expect(typeof body['decisionScore']).toBe('number');
          expect(typeof body['decisionConfidence']).toBe('number');

          // Execution happened through module adapter
          expect(body['executionStatus']).toBe('EXECUTED');
          expect(body['providerReferenceId']).toBeTruthy();

          // Outcome verification: recovery confirmed
          expect(body['recovered']).toBe(true);
          expect(body['recoveredAmount']).toBeGreaterThan(0);

          // Stages trace exists
          expect(Array.isArray(body['stages'])).toBe(true);
          expect(body['stages']).toHaveLength(8);
        } finally {
          await app.close();
        }
      });
    }
  });

  describe('Unsafe module scenarios (safety blocks)', () => {
    for (const scenario of ['subscription_unsafe'] as const) {
      it(`${scenario}: blocks via safety gate, no execution`, async () => {
        const paymentEvent = new InMemoryPaymentEventStore();
        const recoveryOpportunity = new InMemoryRecoveryOpportunityStore();
        const recoveryDecision = new InMemoryRecoveryDecisionStore();
        const recoveryAIAdvice = new InMemoryRecoveryAIAdviceStore();
        const recoveryExecution = new InMemoryRecoveryExecutionStore();

        const mockDb = createDbExecutorMock(
          async (strings: TemplateStringsArray) => {
            const query = strings.join(' ');
            if (query.includes('recovery_opportunities')) {
              const rows = [...recoveryOpportunity.rows.values()];
              return [{ openCount: rows.filter((r) => r.status === 'OPEN').length, recoveredCount: rows.filter((r) => r.status === 'RECOVERED').length, riskSum: 0, recoveredSum: 0, totalSum: 0, count: rows.length }];
            }
            if (query.includes('recovery_executions')) {
              return [{ blockedCount: 0, succeededCount: 0, count: 0 }];
            }
            if (query.includes('recovery_decisions')) {
              return [{ reviewCount: 0, count: 0 }];
            }
            return [{ count: 0 }];
          },
          { paymentEvent, recoveryOpportunity, recoveryDecision, recoveryAIAdvice, recoveryExecution }
        );

        const app = await buildApp({
          env: makeTestEnv({ DEMO_MODE_ENABLED: 'true' }),
          db: mockDb,
        });

        try {
          const response = await app.inject({
            method: 'POST',
            url: `/demo/run/module/${scenario}`,
          });

          expect(response.statusCode).toBe(201);
          const body: Record<string, unknown> = response.json();

          expect(body['moduleType']).toBe('SUBSCRIPTION_RECOVERY');
          expect(body['decisionAction']).toBe('DO_NOT_RETRY');

          // Safety gate blocked execution
          expect(body['executionStatus']).toBe('BLOCKED');

          // No recovery
          expect(body['recovered']).toBe(false);
          expect(body['recoveredAmount']).toBe(0);
        } finally {
          await app.close();
        }
      });
    }
  });

  describe('Review module scenarios (human review required)', () => {
    for (const scenario of ['mandate_unsafe', 'b2b_promise_broken', 'checkout_recent'] as const) {
      it(`${scenario}: routes to review, no automatic execution`, async () => {
        const paymentEvent = new InMemoryPaymentEventStore();
        const recoveryOpportunity = new InMemoryRecoveryOpportunityStore();
        const recoveryDecision = new InMemoryRecoveryDecisionStore();
        const recoveryAIAdvice = new InMemoryRecoveryAIAdviceStore();
        const recoveryExecution = new InMemoryRecoveryExecutionStore();

        const mockDb = createDbExecutorMock(
          async (strings: TemplateStringsArray) => {
            const query = strings.join(' ');
            if (query.includes('recovery_opportunities')) {
              return [{ openCount: 0, recoveredCount: 0, riskSum: 0, recoveredSum: 0, totalSum: 0, count: 0 }];
            }
            if (query.includes('recovery_executions')) {
              return [{ blockedCount: 0, succeededCount: 0, count: 0 }];
            }
            if (query.includes('recovery_decisions')) {
              return [{ reviewCount: 0, count: 0 }];
            }
            return [{ count: 0 }];
          },
          { paymentEvent, recoveryOpportunity, recoveryDecision, recoveryAIAdvice, recoveryExecution }
        );

        const app = await buildApp({
          env: makeTestEnv({ DEMO_MODE_ENABLED: 'true' }),
          db: mockDb,
        });

        try {
          const response = await app.inject({
            method: 'POST',
            url: `/demo/run/module/${scenario}`,
          });

          expect(response.statusCode).toBe(201);
          const body: Record<string, unknown> = response.json();

          // Safety gate blocked (REVIEW is not executable)
          expect(body['executionStatus']).toBe('BLOCKED');

          // No recovery for review scenarios
          expect(body['recovered']).toBe(false);
          expect(body['recoveredAmount']).toBe(0);
        } finally {
          await app.close();
        }
      });
    }
  });

  describe('Degradation scenario', () => {
    it('degradation_incident: circuit breaker blocks execution', async () => {
      const paymentEvent = new InMemoryPaymentEventStore();
      const recoveryOpportunity = new InMemoryRecoveryOpportunityStore();
      const recoveryDecision = new InMemoryRecoveryDecisionStore();
      const recoveryAIAdvice = new InMemoryRecoveryAIAdviceStore();
      const recoveryExecution = new InMemoryRecoveryExecutionStore();

      const mockDb = createDbExecutorMock(
        async (strings: TemplateStringsArray) => {
          const query = strings.join(' ');
          if (query.includes('recovery_opportunities')) {
            return [{ openCount: 0, recoveredCount: 0, riskSum: 0, recoveredSum: 0, totalSum: 0, count: 0 }];
          }
          if (query.includes('recovery_executions')) {
            return [{ blockedCount: 0, succeededCount: 0, count: 0 }];
          }
          if (query.includes('recovery_decisions')) {
            return [{ reviewCount: 0, count: 0 }];
          }
          return [{ count: 0 }];
        },
        { paymentEvent, recoveryOpportunity, recoveryDecision, recoveryAIAdvice, recoveryExecution }
      );

      const app = await buildApp({
        env: makeTestEnv({ DEMO_MODE_ENABLED: 'true' }),
        db: mockDb,
      });

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/demo/run/module/degradation_incident',
        });

        expect(response.statusCode).toBe(201);
        const body: Record<string, unknown> = response.json();

        expect(body['moduleType']).toBe('PAYMENT_DEGRADATION');
        expect(body['executionStatus']).toBe('BLOCKED');
        expect(body['recovered']).toBe(false);
      } finally {
        await app.close();
      }
    });
  });

  describe('Invalid scenarios', () => {
    it('returns 400 for invalid module scenario', async () => {
      const app = await buildApp({
        env: makeTestEnv({ DEMO_MODE_ENABLED: 'true' }),
        db: createDbExecutorMock(),
      });

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/demo/run/module/invalid_scenario_xyz',
        });

        expect(response.statusCode).toBe(400);
        const body: Record<string, unknown> = response.json();
        expect((body['error'] as Record<string, unknown>)['code']).toBe('INVALID_MODULE_SCENARIO');
      } finally {
        await app.close();
      }
    });
  });

  describe('Recovery module routes', () => {
    it('GET /recovery-modules returns overview', async () => {
      const app = await buildApp({
        env: makeTestEnv({ DEMO_MODE_ENABLED: 'true' }),
        db: createDbExecutorMock(),
      });

      try {
        const response = await app.inject({ method: 'GET', url: '/recovery-modules' });
        expect(response.statusCode).toBe(200);
        const body: Record<string, unknown> = response.json();
        expect(body['summary']).toBeDefined();
        expect(body['modules']).toBeDefined();
        expect(body['modules']).toHaveLength(6);
      } finally {
        await app.close();
      }
    });

    it('POST /recovery-modules/detect detects module from evidence', async () => {
      const app = await buildApp({
        env: makeTestEnv({ DEMO_MODE_ENABLED: 'true' }),
        db: createDbExecutorMock(),
      });

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/recovery-modules/detect',
          payload: { evidence: { subscriptionId: 'sub_123' } },
        });

        expect(response.statusCode).toBe(200);
        const body: Record<string, unknown> = response.json();
        expect(body['moduleType']).toBe('SUBSCRIPTION_RECOVERY');
      } finally {
        await app.close();
      }
    });
  });
});
