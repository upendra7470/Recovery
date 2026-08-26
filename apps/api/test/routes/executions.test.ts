import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import {
  createDbExecutorMock,
  FakeRecoveryExecutionProvider,
  InMemoryPaymentEventStore,
  InMemoryRecoveryExecutionStore,
  makeTestEnv,
} from '../helpers.js';

const MERCHANT_A = '11111111-1111-4111-8111-111111111111';

async function makeApp(options: { enabled?: boolean; provider?: FakeRecoveryExecutionProvider | null } = {}) {
  const opportunityStore = new (await import('../helpers.js')).InMemoryRecoveryOpportunityStore();
  const paymentEvent = new InMemoryPaymentEventStore();
  const recoveryExecution = new InMemoryRecoveryExecutionStore();
  const provider: FakeRecoveryExecutionProvider =
    options.provider === undefined ? new FakeRecoveryExecutionProvider() : options.provider!;
  const app: FastifyInstance = await buildApp({
    env: makeTestEnv({ RECOVERY_EXECUTION_ENABLED: String(options.enabled ?? true) }),
    db: createDbExecutorMock(undefined, {
      recoveryOpportunity: opportunityStore,
      paymentEvent,
      recoveryExecution,
    }),
    // Inject the deterministic fake provider through the composition root.
    executionProvider: provider,
  });
  await app.ready();
  return { app, provider, opportunityStore };
}

async function seedOpenOpportunity(
  store: import('../helpers.js').InMemoryRecoveryOpportunityStore,
  overrides: { failureCode?: string; merchantId?: string; providerPaymentId?: string; sourceEventId?: string } = {}
) {
  return store.insert({
    merchantId: overrides.merchantId ?? MERCHANT_A,
    paymentAccountId: null,
    type: 'FAILED_PAYMENT',
    status: 'OPEN',
    sourceEventId: overrides.sourceEventId ?? '00000000-0000-4000-8000-000000000001',
    providerPaymentId: overrides.providerPaymentId ?? 'pay_retry_me',
    providerOrderId: 'order_retry_me',
    amountAtRisk: 500_000,
    currency: 'INR',
    reason: 'Payment failed and no successful payment was observed within the detection window.',
    evidence: {
      sourceEventId: 'evt_1',
      providerPaymentId: overrides.providerPaymentId ?? 'pay_retry_me',
      providerOrderId: 'order_retry_me',
      eventType: 'payment.failed',
      amount: 500_000,
      currency: 'INR',
      occurredAt: new Date().toISOString(),
      failureCode: overrides.failureCode ?? 'GATEWAY_ERROR',
    },
    detectedAt: new Date(),
    expiresAt: null,
    resolvedAt: null,
    recoveryEventId: null,
  });
}

describe('POST /opportunities/:id/execute', () => {
  it('creates an execution for an eligible opportunity', async () => {
    const { app, provider, opportunityStore } = await makeApp();
    try {
      const opportunity = await seedOpenOpportunity(opportunityStore);
      const res = await app.inject({
        method: 'POST',
        url: `/opportunities/${opportunity.id}/execute`,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<{ outcome: string; execution: Record<string, unknown> }>();
      expect(body.outcome).toBe('created');
      expect(body.execution.status).toBe('SUCCEEDED');
      expect(provider.calls).toHaveLength(1);
      // Caller cannot choose the action or the payment id.
      expect(body.execution.action).toBe('RETRY');
    } finally {
      await app.close();
    }
  });

  it('replays on duplicate requests with a single provider call', async () => {
    const { app, provider, opportunityStore } = await makeApp();
    try {
      const opportunity = await seedOpenOpportunity(opportunityStore);
      await app.inject({ method: 'POST', url: `/opportunities/${opportunity.id}/execute` });
      const second = await app.inject({
        method: 'POST',
        url: `/opportunities/${opportunity.id}/execute`,
      });

      expect(second.statusCode).toBe(200);
      expect(second.json<{ outcome: string }>().outcome).toBe('replayed');
      expect(provider.calls).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('blocks DO_NOT_RETRY opportunities with a stable error envelope', async () => {
    const { app, provider, opportunityStore } = await makeApp();
    try {
      const opportunity = await seedOpenOpportunity(opportunityStore, { failureCode: 'stolen_card', providerPaymentId: 'pay_stolen' });
      const res = await app.inject({
        method: 'POST',
        url: `/opportunities/${opportunity.id}/execute`,
      });

      expect(res.statusCode).toBe(409);
      const body = res.json<{ error: { code: string; details: { reason: string } } }>();
      expect(body.error.code).toBe('EXECUTION_BLOCKED');
      expect(body.error.details.reason).toBe('ACTION_NOT_EXECUTABLE');
      expect(provider.calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('reports EXECUTION_DISABLED without any provider call when disabled', async () => {
    const { app, provider, opportunityStore } = await makeApp({ enabled: false });
    try {
      const opportunity = await seedOpenOpportunity(opportunityStore);
      const res = await app.inject({
        method: 'POST',
        url: `/opportunities/${opportunity.id}/execute`,
      });

      expect(res.statusCode).toBe(503);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('EXECUTION_DISABLED');
      expect(provider.calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('returns 404 for unknown opportunities and 422 for bad UUIDs', async () => {
    const { app } = await makeApp();
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/opportunities/99999999-9999-4999-8999-999999999999/execute',
          })
        ).statusCode
      ).toBe(404);
      expect(
        (await app.inject({ method: 'POST', url: '/opportunities/nope/execute' })).statusCode
      ).toBe(422);
    } finally {
      await app.close();
    }
  });
});

describe('GET /opportunities/:id/executions', () => {
  it('returns eligibility plus history; unknown → 404; bad uuid → 422', async () => {
    const { app, opportunityStore } = await makeApp();
    try {
      const opportunity = await seedOpenOpportunity(opportunityStore);

      const empty = await app.inject({
        method: 'GET',
        url: `/opportunities/${opportunity.id}/executions`,
      });
      expect(empty.statusCode).toBe(200);
      const emptyBody = empty.json<{
        eligibility: { eligible: boolean; action: string };
        executions: unknown[];
      }>();
      expect(emptyBody.eligibility.eligible).toBe(true);
      expect(emptyBody.eligibility.action).toBe('RETRY');
      expect(emptyBody.executions).toEqual([]);

      await app.inject({ method: 'POST', url: `/opportunities/${opportunity.id}/execute` });
      const after = await app.inject({
        method: 'GET',
        url: `/opportunities/${opportunity.id}/executions`,
      });
      const afterBody = after.json<{ executions: { status: string }[] }>();
      expect(afterBody.executions).toHaveLength(1);
      expect(afterBody.executions[0]?.status).toBe('SUCCEEDED');

      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/opportunities/99999999-9999-4999-8999-999999999999/executions',
          })
        ).statusCode
      ).toBe(404);
      expect(
        (await app.inject({ method: 'GET', url: '/opportunities/bad/executions' })).statusCode
      ).toBe(422);
    } finally {
      await app.close();
    }
  });

  it('keeps execution history tenant-scoped per opportunity', async () => {
    const { app, opportunityStore } = await makeApp();
    try {
      const oppA = await seedOpenOpportunity(opportunityStore);
      const oppB = await seedOpenOpportunity(opportunityStore, {
        providerPaymentId: 'pay_B',
        sourceEventId: '00000000-0000-4000-8000-000000000002',
        merchantId: '22222222-2222-4222-8222-222222222222',
      });
      await app.inject({ method: 'POST', url: `/opportunities/${oppA.id}/execute` });

      const resB = await app.inject({
        method: 'GET',
        url: `/opportunities/${oppB.id}/executions`,
      });
      expect(resB.json<{ executions: unknown[] }>().executions).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
