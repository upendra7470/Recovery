import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { DemoRetryAdapter } from '../../src/execution/providers/demo-retry.adapter.js';
import { DemoAIAdvisor } from '../../src/ai/providers/demo-ai.adapter.js';
import {
  createDbExecutorMock,
  makeTestEnv,
  InMemoryPaymentEventStore,
  InMemoryRecoveryOpportunityStore,
  InMemoryRecoveryDecisionStore,
  InMemoryRecoveryAIAdviceStore,
  InMemoryRecoveryExecutionStore,
} from '../helpers.js';

describe('Demo Mode Routes (Phase 11.2 Command Center)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ env: makeTestEnv(), db: createDbExecutorMock() });
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /demo/status', () => {
    it('returns 403 when demo mode is disabled', async () => {
      const response = await app.inject({ method: 'GET', url: '/demo/status' });

      expect(response.statusCode).toBe(403);

      const body: Record<string, unknown> = response.json();
      expect(body['error']).toBeDefined();
      expect((body['error'] as Record<string, unknown>)['code']).toBe('DEMO_MODE_DISABLED');
    });
  });

  describe('POST /demo/run', () => {
    it('returns 403 when demo mode is disabled', async () => {
      const response = await app.inject({ method: 'POST', url: '/demo/run' });

      expect(response.statusCode).toBe(403);

      const body: Record<string, unknown> = response.json();
      expect(body['error']).toBeDefined();
      expect((body['error'] as Record<string, unknown>)['code']).toBe('DEMO_MODE_DISABLED');
    });
  });

  describe('POST /demo/run/:scenario', () => {
    it('returns 403 when demo mode is disabled', async () => {
      const response = await app.inject({ method: 'POST', url: '/demo/run/successful' });

      expect(response.statusCode).toBe(403);

      const body: Record<string, unknown> = response.json();
      expect(body['error']).toBeDefined();
      expect((body['error'] as Record<string, unknown>)['code']).toBe('DEMO_MODE_DISABLED');
    });
  });

  describe('DELETE /demo/reset', () => {
    it('returns 403 when demo mode is disabled', async () => {
      const response = await app.inject({ method: 'DELETE', url: '/demo/reset' });

      expect(response.statusCode).toBe(403);

      const body: Record<string, unknown> = response.json();
      expect(body['error']).toBeDefined();
      expect((body['error'] as Record<string, unknown>)['code']).toBe('DEMO_MODE_DISABLED');
    });
  });

  describe('When demo mode is enabled', () => {
    let enabledApp: Awaited<ReturnType<typeof buildApp>>;
    let paymentEvent: InMemoryPaymentEventStore;
    let recoveryOpportunity: InMemoryRecoveryOpportunityStore;
    let recoveryDecision: InMemoryRecoveryDecisionStore;
    let recoveryAIAdvice: InMemoryRecoveryAIAdviceStore;
    let recoveryExecution: InMemoryRecoveryExecutionStore;

    beforeEach(async () => {
      paymentEvent = new InMemoryPaymentEventStore();
      recoveryOpportunity = new InMemoryRecoveryOpportunityStore();
      recoveryDecision = new InMemoryRecoveryDecisionStore();
      recoveryAIAdvice = new InMemoryRecoveryAIAdviceStore();
      recoveryExecution = new InMemoryRecoveryExecutionStore();

      const mockDb = createDbExecutorMock(
        async (strings: TemplateStringsArray) => {
          const query = strings.join(' ');
          if (query.includes('recovery_opportunities')) {
            const rows = [...recoveryOpportunity.rows.values()];
            const openCount = rows.filter((r) => r.status === 'OPEN').length;
            const recoveredCount = rows.filter((r) => r.status === 'RECOVERED').length;
            const riskSum = rows
              .filter((r) => r.status === 'OPEN')
              .reduce((s, r) => s + r.amountAtRisk, 0);
            const recoveredSum = rows
              .filter((r) => r.status === 'RECOVERED')
              .reduce((s, r) => s + r.amountAtRisk, 0);
            const totalSum = rows.reduce((s, r) => s + r.amountAtRisk, 0);
            return [
              { openCount, recoveredCount, riskSum, recoveredSum, totalSum, count: rows.length },
            ];
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
        {
          paymentEvent,
          recoveryOpportunity,
          recoveryDecision,
          recoveryAIAdvice,
          recoveryExecution,
        }
      );
      enabledApp = await buildApp({
        env: makeTestEnv({ DEMO_MODE_ENABLED: 'true' }),
        db: mockDb,
      });
    });

    afterEach(async () => {
      await enabledApp.close();
    });

    it('GET /demo/status returns enabled status with metrics and counts', async () => {
      const response = await enabledApp.inject({ method: 'GET', url: '/demo/status' });

      expect(response.statusCode).toBe(200);

      const body: Record<string, unknown> = response.json();
      expect(body['enabled']).toBe(true);
      expect(body['hasDemoData']).toBe(false);
      expect(body['isRunning']).toBe(false);
      expect(body['counts']).toBeDefined();
      expect(body['metrics']).toBeDefined();

      const metrics = body['metrics'] as Record<string, unknown>;
      expect(metrics['revenueAtRisk']).toBe(0);
      expect(metrics['recoveredRevenue']).toBe(0);
      expect(metrics['recoveryRate']).toBe(0);
    });

    it('POST /demo/run creates demo scenarios with 10-stage lifecycle trace', async () => {
      const response = await enabledApp.inject({ method: 'POST', url: '/demo/run' });

      expect(response.statusCode).toBe(201);

      const body: Record<string, unknown> = response.json();
      expect(body['demoRunId']).toBeDefined();
      expect(body['scenarios']).toBeDefined();
      expect(Array.isArray(body['scenarios'])).toBe(true);
      expect(body['summary']).toBeDefined();
      expect(body['metrics']).toBeDefined();

      const summary = body['summary'] as Record<string, number>;
      expect(summary['totalScenarios']).toBe(3);
      expect(summary['successfulRecovery']).toBe(1);
      expect(summary['unsafeRecovery']).toBe(1);
      expect(summary['reviewCase']).toBe(1);
      expect(summary['recoveredAmount']).toBe(249900);

      // Verify scenario structure & stages
      const scenarios = body['scenarios'] as Array<Record<string, unknown>>;
      expect(scenarios.length).toBe(3);

      const successful = scenarios.find((s) => s['scenario'] === 'SUCCESSFUL_RECOVERY');
      expect(successful).toBeDefined();
      expect(successful?.['recovered']).toBe(true);
      expect(successful?.['recoveredAmount']).toBe(249900);
      expect(successful?.['decisionAction']).toBe('RETRY');
      expect(Array.isArray(successful?.['stages'])).toBe(true);
      expect((successful?.['stages'] as unknown[]).length).toBe(10);
      expect(Array.isArray(successful?.['policyChecks'])).toBe(true);
      expect(successful?.['aiAdvice']).toBeDefined();

      const unsafe = scenarios.find((s) => s['scenario'] === 'UNSAFE_RECOVERY');
      expect(unsafe).toBeDefined();
      expect(unsafe?.['recovered']).toBe(false);
      expect(unsafe?.['recoveredAmount']).toBe(0);
      expect(unsafe?.['decisionAction']).toBe('DO_NOT_RETRY');
      expect(unsafe?.['executionOutcome']).toBe('blocked');
      expect(Array.isArray(unsafe?.['stages'])).toBe(true);

      const review = scenarios.find((s) => s['scenario'] === 'REVIEW_CASE');
      expect(review).toBeDefined();
      expect(review?.['recovered']).toBe(false);
      expect(review?.['recoveredAmount']).toBe(0);
      expect(review?.['decisionAction']).toBe('REVIEW');
      expect(Array.isArray(review?.['stages'])).toBe(true);
    });

    it('POST /demo/run/successful executes only Scenario A (Successful Recovery)', async () => {
      const response = await enabledApp.inject({
        method: 'POST',
        url: '/demo/run/successful',
      });

      expect(response.statusCode).toBe(201);

      const body: Record<string, unknown> = response.json();
      const scenarios = body['scenarios'] as Array<Record<string, unknown>>;
      expect(scenarios.length).toBe(1);
      expect(scenarios[0]?.['scenario']).toBe('SUCCESSFUL_RECOVERY');
      expect(scenarios[0]?.['recovered']).toBe(true);
      expect(scenarios[0]?.['recoveredAmount']).toBe(249900);
      expect(scenarios[0]?.['amount']).toBe(249900);
    });

    it('POST /demo/run/unsafe executes only Scenario B (Unsafe Recovery / Blocked)', async () => {
      const response = await enabledApp.inject({
        method: 'POST',
        url: '/demo/run/unsafe',
      });

      expect(response.statusCode).toBe(201);

      const body: Record<string, unknown> = response.json();
      const scenarios = body['scenarios'] as Array<Record<string, unknown>>;
      expect(scenarios.length).toBe(1);
      expect(scenarios[0]?.['scenario']).toBe('UNSAFE_RECOVERY');
      expect(scenarios[0]?.['recovered']).toBe(false);
      expect(scenarios[0]?.['recoveredAmount']).toBe(0);
      expect(scenarios[0]?.['decisionAction']).toBe('DO_NOT_RETRY');
    });

    it('POST /demo/run/review executes only Scenario C (Review Case / Human in loop)', async () => {
      const response = await enabledApp.inject({
        method: 'POST',
        url: '/demo/run/review',
      });

      expect(response.statusCode).toBe(201);

      const body: Record<string, unknown> = response.json();
      const scenarios = body['scenarios'] as Array<Record<string, unknown>>;
      expect(scenarios.length).toBe(1);
      expect(scenarios[0]?.['scenario']).toBe('REVIEW_CASE');
      expect(scenarios[0]?.['recovered']).toBe(false);
      expect(scenarios[0]?.['recoveredAmount']).toBe(0);
      expect(scenarios[0]?.['decisionAction']).toBe('REVIEW');
    });

    it('POST /demo/run/invalid returns 400 Bad Request', async () => {
      const response = await enabledApp.inject({
        method: 'POST',
        url: '/demo/run/unknown-scenario',
      });

      expect(response.statusCode).toBe(400);
      const body: Record<string, unknown> = response.json();
      expect((body['error'] as Record<string, unknown>)['code']).toBe('INVALID_SCENARIO');
    });

    it('DELETE /demo/reset removes demo data cleanly', async () => {
      await enabledApp.inject({ method: 'POST', url: '/demo/run' });

      const response = await enabledApp.inject({ method: 'DELETE', url: '/demo/reset' });

      expect(response.statusCode).toBe(200);

      const body: Record<string, unknown> = response.json();
      expect(body['deleted']).toBeDefined();
      expect(typeof body['deleted']).toBe('number');
    });

    it('GET /demo/status shows demo data after run', async () => {
      await enabledApp.inject({ method: 'POST', url: '/demo/run' });

      const response = await enabledApp.inject({ method: 'GET', url: '/demo/status' });

      expect(response.statusCode).toBe(200);

      const body: Record<string, unknown> = response.json();
      expect(body['enabled']).toBe(true);
      expect(body['metrics']).toBeDefined();
    });

    it('repeated demo runs reset previous data cleanly (idempotency)', async () => {
      // First run
      const first = await enabledApp.inject({ method: 'POST', url: '/demo/run' });
      const firstBody: Record<string, unknown> = first.json();
      const firstRunId = firstBody['demoRunId'];

      // Second run
      const second = await enabledApp.inject({ method: 'POST', url: '/demo/run' });
      const secondBody: Record<string, unknown> = second.json();
      const secondRunId = secondBody['demoRunId'];

      // Run IDs should be different (unique UUIDs)
      expect(firstRunId).not.toBe(secondRunId);

      // Both should succeed
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);

      const firstScenarios = firstBody['scenarios'] as unknown[];
      const secondScenarios = secondBody['scenarios'] as unknown[];
      expect(firstScenarios.length).toBe(3);
      expect(secondScenarios.length).toBe(3);
    });
  });
});

describe('DemoRetryAdapter', () => {
  it('returns accepted with deterministic reference ID', async () => {
    const adapter = new DemoRetryAdapter();
    const result = await adapter.retryPayment({
      executionId: '550e8400-e29b-41d4-a716-446655440000',
      opportunityId: 'opportunity-1',
      providerPaymentId: 'pay_demo_001',
      providerOrderId: 'order_demo_001',
      amount: 249900,
      currency: 'INR',
    });

    expect(result.kind).toBe('accepted');
    if (result.kind === 'accepted') {
      expect(result.providerReferenceId).toMatch(/^demo_order_/);
    }
  });

  it('always returns accepted (never rejects)', async () => {
    const adapter = new DemoRetryAdapter();
    const result = await adapter.retryPayment({
      executionId: 'test-execution-id',
      opportunityId: 'test-opportunity',
      providerPaymentId: 'pay_test',
      providerOrderId: null,
      amount: 10000,
      currency: 'INR',
    });

    expect(result.kind).toBe('accepted');
  });

  it('has provider name "demo"', () => {
    const adapter = new DemoRetryAdapter();
    expect(adapter.provider).toBe('demo');
  });
});

describe('DemoAIAdvisor', () => {
  it('generates transparent AI advice for RETRY recommendation', async () => {
    const advisor = new DemoAIAdvisor();
    const result = await advisor.advise({
      opportunityId: '00000000-0000-4000-8000-000000000001',
      opportunityType: 'FAILED_PAYMENT',
      currency: 'INR',
      amount: 249900,
      failureCategory: 'TRANSIENT',
      failureCode: 'GATEWAY_ERROR',
      observedFailedRetries: 0,
      opportunityStatus: 'OPEN',
      score: 87,
      priority: 'HIGH',
      confidence: 91,
      recommendation: 'RETRY',
      reasons: ['Transient decline', 'Low retry history'],
      riskFlags: [],
      historicalRecoveryRatePercent: 88,
    });

    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.content.summary).toContain('Transient');
      expect(result.content.confidence).toBe(91);
      expect(result.content.warnings.length).toBe(0);
      expect(result.content.nextStep).toContain('retry');
    }
  });

  it('generates safety-conscious AI advice for DO_NOT_RETRY recommendation', async () => {
    const advisor = new DemoAIAdvisor();
    const result = await advisor.advise({
      opportunityId: '00000000-0000-4000-8000-000000000002',
      opportunityType: 'FAILED_PAYMENT',
      currency: 'INR',
      amount: 150000,
      failureCategory: 'HARD_DECLINE',
      failureCode: 'expired_card',
      observedFailedRetries: 0,
      opportunityStatus: 'OPEN',
      score: 15,
      priority: 'LOW',
      confidence: 96,
      recommendation: 'DO_NOT_RETRY',
      reasons: ['Permanent decline (expired card)'],
      riskFlags: [{ flag: 'NON_RECOVERABLE_CONDITION', explanation: 'Card has expired' }],
      historicalRecoveryRatePercent: 0,
    });

    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.content.summary).toContain('Permanent');
      expect(result.content.explanation).toContain('expired');
      expect(result.content.warnings.length).toBeGreaterThan(0);
    }
  });

  it('generates operator-centric AI advice for REVIEW recommendation', async () => {
    const advisor = new DemoAIAdvisor();
    const result = await advisor.advise({
      opportunityId: '00000000-0000-4000-8000-000000000003',
      opportunityType: 'FAILED_PAYMENT',
      currency: 'INR',
      amount: 99900,
      failureCategory: 'UNKNOWN',
      failureCode: 'UNKNOWN_ERROR',
      observedFailedRetries: 0,
      opportunityStatus: 'OPEN',
      score: 45,
      priority: 'MEDIUM',
      confidence: 45,
      recommendation: 'REVIEW',
      reasons: ['Ambiguous failure code'],
      riskFlags: [],
      historicalRecoveryRatePercent: null,
    });

    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.content.summary).toContain('Ambiguous');
      expect(result.content.confidence).toBe(45);
      expect(result.content.warnings.length).toBeGreaterThan(0);
    }
  });
});
