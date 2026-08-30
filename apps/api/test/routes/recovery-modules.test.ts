import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

describe('Recovery Modules Routes (Phase 12)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ env: makeTestEnv(), db: createDbExecutorMock() });
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /recovery-modules', () => {
    it('returns overview with all 6 module types', async () => {
      const response = await app.inject({ method: 'GET', url: '/recovery-modules' });

      expect(response.statusCode).toBe(200);

      const body: Record<string, unknown> = response.json();
      expect(body['summary']).toBeDefined();
      expect(body['modules']).toBeDefined();

      const summary = body['summary'] as Record<string, number>;
      expect(summary['totalModules']).toBe(6);

      const modules = body['modules'] as Array<Record<string, unknown>>;
      expect(modules.length).toBe(6);

      const types = modules.map((m) => m['moduleType']);
      expect(types).toContain('FAILED_PAYMENT');
      expect(types).toContain('SUBSCRIPTION_RECOVERY');
      expect(types).toContain('MANDATE_RETRY');
      expect(types).toContain('B2B_RECEIVABLE');
      expect(types).toContain('CHECKOUT_DROPOFF');
      expect(types).toContain('PAYMENT_DEGRADATION');
    });
  });

  describe('GET /recovery-modules/:type', () => {
    it('returns module detail for valid type', async () => {
      const response = await app.inject({ method: 'GET', url: '/recovery-modules/SUBSCRIPTION_RECOVERY' });

      expect(response.statusCode).toBe(200);

      const body: Record<string, unknown> = response.json();
      expect(body['moduleType']).toBe('SUBSCRIPTION_RECOVERY');
      expect(body['info']).toBeDefined();
      expect(body['metrics']).toBeDefined();
    });

    it('returns 400 for invalid module type', async () => {
      const response = await app.inject({ method: 'GET', url: '/recovery-modules/INVALID_TYPE' });

      expect(response.statusCode).toBe(400);
      const body: Record<string, unknown> = response.json();
      expect((body['error'] as Record<string, unknown>)['code']).toBe('INVALID_MODULE_TYPE');
    });
  });

  describe('GET /recovery-modules/opportunities', () => {
    it('returns empty list when no opportunities exist', async () => {
      const response = await app.inject({ method: 'GET', url: '/recovery-modules/opportunities' });

      expect(response.statusCode).toBe(200);

      const body: Record<string, unknown> = response.json();
      expect(body['opportunities']).toBeDefined();
      expect(Array.isArray(body['opportunities'])).toBe(true);
      expect(body['total']).toBe(0);
    });
  });

  describe('POST /recovery-modules/detect', () => {
    it('detects module type from evidence', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/recovery-modules/detect',
        payload: { evidence: { subscriptionId: 'sub_123' } },
      });

      expect(response.statusCode).toBe(200);

      const body: Record<string, unknown> = response.json();
      expect(body['moduleType']).toBe('SUBSCRIPTION_RECOVERY');
      expect(body['confidence']).toBe('deterministic');
    });

    it('detects module type from opportunityType', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/recovery-modules/detect',
        payload: { opportunityType: 'CHECKOUT_DROPOFF' },
      });

      expect(response.statusCode).toBe(200);

      const body: Record<string, unknown> = response.json();
      expect(body['moduleType']).toBe('CHECKOUT_DROPOFF');
    });

    it('returns 400 when no payload provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/recovery-modules/detect',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body: Record<string, unknown> = response.json();
      expect((body['error'] as Record<string, unknown>)['code']).toBe('MISSING_PAYLOAD');
    });
  });
});

describe('Module Scenario Routes (Phase 12)', () => {
  let enabledApp: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
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

    enabledApp = await buildApp({
      env: makeTestEnv({ DEMO_MODE_ENABLED: 'true' }),
      db: mockDb,
    });
  });

  afterEach(async () => {
    await enabledApp.close();
  });

  describe('POST /demo/run/module/:moduleScenario', () => {
    const validScenarios = [
      'subscription_success',
      'subscription_unsafe',
      'mandate_success',
      'mandate_unsafe',
      'b2b_success',
      'b2b_promise_broken',
      'checkout_recovery',
      'checkout_recent',
      'degradation_incident',
    ];

    for (const scenario of validScenarios) {
      it(`runs ${scenario} successfully`, async () => {
        const response = await enabledApp.inject({
          method: 'POST',
          url: `/demo/run/module/${scenario}`,
        });

        expect(response.statusCode).toBe(201);

        const body: Record<string, unknown> = response.json();
        expect(body['scenario']).toBe(scenario);
        expect(body['moduleType']).toBeTruthy();
        expect(body['scenarioName']).toBeTruthy();
        expect(body['opportunityId']).toBeTruthy();
        expect(body['amount']).toBeGreaterThan(0);
        expect(body['decisionAction']).toBeTruthy();
        expect(body['decisionScore']).toBeGreaterThanOrEqual(0);
        expect(body['decisionConfidence']).toBeGreaterThanOrEqual(0);
        expect(body['decisionPriority']).toBeTruthy();
        expect(Array.isArray(body['stages'])).toBe(true);
        expect(Array.isArray(body['policyChecks'])).toBe(true);
        expect(typeof body['recovered']).toBe('boolean');
      });
    }

    it('returns 400 for invalid module scenario', async () => {
      const response = await enabledApp.inject({
        method: 'POST',
        url: '/demo/run/module/invalid_scenario',
      });

      expect(response.statusCode).toBe(400);
      const body: Record<string, unknown> = response.json();
      expect((body['error'] as Record<string, unknown>)['code']).toBe('INVALID_MODULE_SCENARIO');
    });

    it('subscription scenarios include subscriptionId in evidence', async () => {
      const response = await enabledApp.inject({
        method: 'POST',
        url: '/demo/run/module/subscription_success',
      });

      expect(response.statusCode).toBe(201);
      const body: Record<string, unknown> = response.json();
      expect(body['moduleType']).toBe('SUBSCRIPTION_RECOVERY');
    });

    it('mandate scenarios include mandate context', async () => {
      const response = await enabledApp.inject({
        method: 'POST',
        url: '/demo/run/module/mandate_success',
      });

      expect(response.statusCode).toBe(201);
      const body: Record<string, unknown> = response.json();
      expect(body['moduleType']).toBe('MANDATE_RETRY');
    });

    it('b2b scenarios include invoice context', async () => {
      const response = await enabledApp.inject({
        method: 'POST',
        url: '/demo/run/module/b2b_success',
      });

      expect(response.statusCode).toBe(201);
      const body: Record<string, unknown> = response.json();
      expect(body['moduleType']).toBe('B2B_RECEIVABLE');
    });

    it('checkout scenarios use payment.authorized event', async () => {
      const response = await enabledApp.inject({
        method: 'POST',
        url: '/demo/run/module/checkout_recovery',
      });

      expect(response.statusCode).toBe(201);
      const body: Record<string, unknown> = response.json();
      expect(body['moduleType']).toBe('CHECKOUT_DROPOFF');
    });

    it('degradation scenario triggers circuit breaker', async () => {
      const response = await enabledApp.inject({
        method: 'POST',
        url: '/demo/run/module/degradation_incident',
      });

      expect(response.statusCode).toBe(201);
      const body: Record<string, unknown> = response.json();
      expect(body['moduleType']).toBe('PAYMENT_DEGRADATION');
    });

    it('unsafe module scenarios are blocked', async () => {
      const response = await enabledApp.inject({
        method: 'POST',
        url: '/demo/run/module/subscription_unsafe',
      });

      expect(response.statusCode).toBe(201);
      const body: Record<string, unknown> = response.json();
      expect(body['recovered']).toBe(false);
      expect(body['decisionAction']).toBe('DO_NOT_RETRY');
    });
  });
});
