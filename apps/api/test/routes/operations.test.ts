import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import {
  createDbExecutorMock,
  InMemoryPaymentEventStore,
  InMemoryRecoveryExecutionStore,
  makeTestEnv,
} from '../helpers.js';

const MERCHANT_A = '11111111-1111-4111-8111-111111111111';
const MERCHANT_B = '22222222-2222-4222-8222-222222222222';

async function makeApp() {
  const opportunityStore = new (await import('../helpers.js')).InMemoryRecoveryOpportunityStore();
  const paymentEvent = new InMemoryPaymentEventStore();
  const executionStore = new InMemoryRecoveryExecutionStore();
  const app: FastifyInstance = await buildApp({
    env: makeTestEnv({ RECOVERY_EXECUTION_ENABLED: 'true' }),
    db: createDbExecutorMock(undefined, {
      recoveryOpportunity: opportunityStore,
      paymentEvent,
      recoveryExecution: executionStore,
    }),
  });
  await app.ready();

  async function seedOpportunity(merchantId: string) {
    return opportunityStore.insert({
      merchantId,
      paymentAccountId: null,
      type: 'FAILED_PAYMENT',
      status: 'OPEN',
      sourceEventId: '00000000-0000-4000-8000-000000000001',
      providerPaymentId: 'pay_ops',
      providerOrderId: 'order_ops',
      amountAtRisk: 500_000,
      currency: 'INR',
      reason: 'ops case',
      evidence: {
        sourceEventId: 'evt',
        providerPaymentId: 'pay_ops',
        providerOrderId: 'order_ops',
        eventType: 'payment.failed',
        amount: 500_000,
        currency: 'INR',
        occurredAt: new Date().toISOString(),
        failureCode: 'GATEWAY_ERROR',
      },
      detectedAt: new Date(),
      expiresAt: null,
      resolvedAt: null,
      recoveryEventId: null,
    });
  }

  return { app, executionStore, opportunityStore, seedOpportunity };
}

describe('GET /operations/overview', () => {
  it('reports honest zeros and flags when automation is off', async () => {
    const { app } = await makeApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/operations/overview' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        automationEnabled: false,
        providerConfigured: false,
        countsByStatus: {},
        dueCount: 0,
      });
    } finally {
      await app.close();
    }
  });

  it('counts executions by status and reports due work', async () => {
    const { app, executionStore } = await makeApp();
    try {
      await executionStore.insert({
        merchantId: MERCHANT_A,
        opportunityId: '00000000-0000-4000-8000-000000000001',
        decisionId: '00000000-0000-4000-8000-000000000002',
        action: 'RETRY',
        status: 'PENDING',
        origin: 'AUTOMATED',
        attempt: 1,
        nextAttemptAt: new Date(Date.now() - 1000),
        scheduledAt: new Date(),
        idempotencyKey: 'k1',
        provider: null,
        providerPaymentId: 'pay_ops',
        requestedAt: new Date(),
        startedAt: null,
        completedAt: null,
        failureCode: null,
        failureReason: null,
      });
      await executionStore.insert({
        merchantId: MERCHANT_A,
        opportunityId: '00000000-0000-4000-8000-000000000001',
        decisionId: '00000000-0000-4000-8000-000000000002',
        action: 'RETRY',
        status: 'SUCCEEDED',
        origin: 'AUTOMATED',
        attempt: 1,
        nextAttemptAt: null,
        scheduledAt: null,
        idempotencyKey: 'k2',
        provider: 'fake',
        providerPaymentId: 'pay_ops',
        requestedAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
        failureCode: null,
        failureReason: null,
      });

      const res = await app.inject({ method: 'GET', url: '/operations/overview' });
      const body = res.json<{ countsByStatus: Record<string, number>; dueCount: number }>();
      expect(body.countsByStatus.PENDING).toBe(1);
      expect(body.countsByStatus.SUCCEEDED).toBe(1);
      expect(body.dueCount).toBeGreaterThanOrEqual(1);
    } finally {
      await app.close();
    }
  });
});

describe('GET /operations/executions', () => {
  it('lists recent executions with reconciliation status', async () => {
    const { app, executionStore, opportunityStore, seedOpportunity } = await makeApp();
    try {
      const opp = await seedOpportunity(MERCHANT_A);

      // Accepted request on an OPEN opportunity → awaiting outcome.
      await executionStore.insert({
        merchantId: MERCHANT_A,
        opportunityId: opp.id,
        decisionId: '00000000-0000-4000-8000-0000000000d1',
        action: 'RETRY',
        status: 'SUCCEEDED',
        origin: 'AUTOMATED',
        attempt: 1,
        nextAttemptAt: null,
        scheduledAt: null,
        idempotencyKey: 'k-acc',
        provider: 'fake',
        providerPaymentId: 'pay_ops',
        requestedAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
        failureCode: null,
        failureReason: null,
      });

      const res = await app.inject({ method: 'GET', url: '/operations/executions' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        total: number;
        executions: { reconciliation: string; opportunityStatus: string | null; origin: string }[];
      }>();
      expect(body.total).toBe(1);
      expect(body.executions[0]?.reconciliation).toBe('awaiting_payment_outcome');
      expect(body.executions[0]?.origin).toBe('AUTOMATED');

      // After webhook-driven recovery the same execution reconciles as recovered.
      await opportunityStore.markRecovered({
        id: opp.id,
        recoveryEventId: '00000000-0000-4000-8000-000000000099',
        resolvedAt: new Date(),
      });
      const after = await app.inject({ method: 'GET', url: '/operations/executions' });
      expect(
        after.json<{ executions: { reconciliation: string }[] }>().executions[0]
          ?.reconciliation
      ).toBe('recovered');
    } finally {
      await app.close();
    }
  });

  it('supports the status filter', async () => {
    const { app, executionStore } = await makeApp();
    try {
      for (const [key, status] of [
        ['k1', 'PENDING'],
        ['k2', 'SUCCEEDED'],
      ] as const) {
        await executionStore.insert({
          merchantId: MERCHANT_A,
          opportunityId: '00000000-0000-4000-8000-000000000001',
          decisionId: '00000000-0000-4000-8000-000000000002',
          action: 'RETRY',
          status,
          origin: 'AUTOMATED',
          attempt: 1,
          nextAttemptAt: null,
          scheduledAt: null,
          idempotencyKey: key,
          provider: null,
          providerPaymentId: 'pay_ops',
          requestedAt: new Date(),
          startedAt: null,
          completedAt: null,
          failureCode: null,
          failureReason: null,
        });
      }

      const res = await app.inject({
        method: 'GET',
        url: '/operations/executions?status=SUCCEEDED',
      });
      const body = res.json<{ total: number; executions: { status: string }[] }>();
      expect(body.total).toBe(1);
      expect(body.executions[0]?.status).toBe('SUCCEEDED');
    } finally {
      await app.close();
    }
  });

  it('scopes by merchantId so tenants never see each other’s executions', async () => {
    const { app, executionStore } = await makeApp();
    try {
      await executionStore.insert({
        merchantId: MERCHANT_A,
        opportunityId: '00000000-0000-4000-8000-000000000001',
        decisionId: '00000000-0000-4000-8000-000000000002',
        action: 'RETRY',
        status: 'SUCCEEDED',
        origin: 'AUTOMATED',
        attempt: 1,
        nextAttemptAt: null,
        scheduledAt: null,
        idempotencyKey: 'k-a',
        provider: null,
        providerPaymentId: 'pay_ops',
        requestedAt: new Date(),
        startedAt: null,
        completedAt: new Date(),
        failureCode: null,
        failureReason: null,
      });

      const scopedA = await app.inject({
        method: 'GET',
        url: `/operations/executions?merchantId=${MERCHANT_A}`,
      });
      expect(scopedA.json<{ total: number }>().total).toBe(1);

      const scopedB = await app.inject({
        method: 'GET',
        url: `/operations/executions?merchantId=${MERCHANT_B}`,
      });
      expect(scopedB.json<{ total: number }>().total).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('rejects invalid filters with 422', async () => {
    const { app } = await makeApp();
    try {
      expect(
        (
          await app.inject({ method: 'GET', url: '/operations/executions?status=NOPE' })
        ).statusCode
      ).toBe(422);
      expect(
        (
          await app.inject({ method: 'GET', url: '/operations/executions?limit=999' })
        ).statusCode
      ).toBe(422);
    } finally {
      await app.close();
    }
  });
});

describe('GET /operations/executions/:id', () => {
  it('returns detail linking execution, opportunity and decision', async () => {
    const { app, executionStore, seedOpportunity } = await makeApp();
    try {
      const opp = await seedOpportunity(MERCHANT_A);
      const execution = await executionStore.insert({
        merchantId: MERCHANT_A,
        opportunityId: opp.id,
        decisionId: '00000000-0000-4000-8000-0000000000d1',
        action: 'RETRY',
        status: 'SUCCEEDED',
        origin: 'AUTOMATED',
        attempt: 1,
        nextAttemptAt: null,
        scheduledAt: null,
        idempotencyKey: 'k-detail',
        provider: 'fake',
        providerPaymentId: 'pay_ops',
        requestedAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
        failureCode: null,
        failureReason: null,
      });

      const res = await app.inject({
        method: 'GET',
        url: `/operations/executions/${execution.id}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        execution: { reconciliation: string; id: string };
        opportunity: { id: string; status: string } | null;
        decision: Record<string, unknown> | null;
      }>();
      expect(body.execution.id).toBe(execution.id);
      expect(body.opportunity?.id).toBe(opp.id);
      expect(body.opportunity?.status).toBe('OPEN');
      // Decision row does not exist in this fixture — honest null.
      expect(body.decision).toBeNull();

      expect(
        (
          await app.inject({ method: 'GET', url: '/operations/executions/not-a-uuid' })
        ).statusCode
      ).toBe(422);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/operations/executions/99999999-9999-4999-8999-999999999999',
          })
        ).statusCode
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
});
