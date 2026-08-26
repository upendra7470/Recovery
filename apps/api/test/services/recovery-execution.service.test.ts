import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { RecoveryExecutionService } from '../../src/services/recovery-execution.service.js';
import {
  createDbExecutorMock,
  FakeRecoveryExecutionProvider,
  InMemoryPaymentEventStore,
  InMemoryRecoveryExecutionStore,
  makeTestEnv,
} from '../helpers.js';

const MERCHANT_A = '11111111-1111-4111-8111-111111111111';

async function makeService(options: {
  enabled?: boolean;
  provider?: FakeRecoveryExecutionProvider | null;
  minConfidence?: number;
  maxRetries?: number;
} = {}) {
  const opportunityStore = new (await import('../helpers.js')).InMemoryRecoveryOpportunityStore();
  const eventStore = new InMemoryPaymentEventStore();
  const executionStore = new InMemoryRecoveryExecutionStore();
  const app: FastifyInstance = await buildApp({
    env: makeTestEnv(),
    db: createDbExecutorMock(undefined, {
      recoveryOpportunity: opportunityStore,
      paymentEvent: eventStore,
      recoveryExecution: executionStore,
    }),
  });
  await app.ready();

  const provider: FakeRecoveryExecutionProvider =
    options.provider === undefined ? new FakeRecoveryExecutionProvider() : options.provider!;
  const service = new RecoveryExecutionService(
    app.opportunities,
    app.decisionService,
    new (await import('../../src/repositories/recovery-execution.repository.js')).RecoveryExecutionRepository(
      executionStore
    ),
    eventStore,
    provider,
    {
      enabled: options.enabled ?? true,
      minConfidence: options.minConfidence ?? 60,
      maxRetries: options.maxRetries ?? 3,
    }
  );
  return { app, service, provider, opportunityStore, eventStore, executionStore };
}

/** Seeds a transient-failure opportunity whose decision evaluates as RETRY-eligible. */
async function seedRetryableOpportunity(store: import('../helpers.js').InMemoryRecoveryOpportunityStore) {
  return store.insert({
    merchantId: MERCHANT_A,
    paymentAccountId: null,
    type: 'FAILED_PAYMENT',
    status: 'OPEN',
    sourceEventId: '00000000-0000-4000-8000-000000000001',
    providerPaymentId: 'pay_retry_me',
    providerOrderId: 'order_retry_me',
    amountAtRisk: 500_000,
    currency: 'INR',
    reason: 'Payment failed and no successful payment was observed within the detection window.',
    evidence: {
      sourceEventId: 'evt_1',
      providerPaymentId: 'pay_retry_me',
      providerOrderId: 'order_retry_me',
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

describe('RecoveryExecutionService', () => {
  it('executes an eligible RETRY exactly once and never claims recovery', async () => {
    const { app, service, provider, executionStore, opportunityStore } = await makeService();
    try {
      const opportunity = await seedRetryableOpportunity(opportunityStore);

      const result = await service.requestExecution(opportunity.id);
      expect(result.outcome).toBe('created');
      if (result.outcome === 'created') {
        expect(result.execution.status).toBe('SUCCEEDED'); // request accepted
        expect(result.execution.attempt).toBe(1);
        expect(provider.calls).toHaveLength(1);
        expect(provider.calls[0]?.providerPaymentId).toBe('pay_retry_me');
      }

      // The opportunity is NOT marked recovered by the execution layer —
      // recovery requires the payment-event outcome flow.
      expect((await app.opportunities.findById(opportunity.id))?.status).toBe('OPEN');
      expect(executionStore.rows.size).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('replays the existing execution on repeated requests without a second provider call', async () => {
    const provider = new FakeRecoveryExecutionProvider();
    const { app, service, opportunityStore } = await makeService({ provider });
    try {
      const opportunity = await seedRetryableOpportunity(opportunityStore);

      const first = await service.requestExecution(opportunity.id);
      const second = await service.requestExecution(opportunity.id);

      expect(first.outcome).toBe('created');
      expect(second.outcome).toBe('replayed');
      expect(provider.calls).toHaveLength(1);
      if (second.outcome === 'replayed') {
        expect(second.execution.id).toEqual(
          first.outcome === 'created' ? first.execution.id : ''
        );
      }
    } finally {
      await app.close();
    }
  });

  it('returns a disabled outcome without touching the provider', async () => {
    const provider = new FakeRecoveryExecutionProvider();
    const { app, service, opportunityStore } = await makeService({ enabled: false, provider });
    try {
      const opportunity = await seedRetryableOpportunity(opportunityStore);
      const result = await service.requestExecution(opportunity.id);

      expect(result.outcome).toBe('disabled');
      if (result.outcome === 'disabled') {
        // Safety evaluation still works in disabled mode.
        expect(result.assessment.eligibility.eligible).toBe(true);
        expect(result.assessment.decision.recommendedAction).toBeDefined();
      }
      expect(provider.calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('persists a BLOCKED audit record and blocks DO_NOT_RETRY opportunities', async () => {
    const provider = new FakeRecoveryExecutionProvider();
    const { app, service, opportunityStore } = await makeService({ provider });
    try {
      await seedRetryableOpportunity(opportunityStore);
      await opportunityStore.insert({
        merchantId: MERCHANT_A,
        paymentAccountId: null,
        type: 'FAILED_PAYMENT',
        status: 'OPEN',
        sourceEventId: '00000000-0000-4000-8000-000000000002',
        providerPaymentId: 'pay_stolen',
        providerOrderId: 'order_stolen',
        amountAtRisk: 100,
        currency: 'INR',
        reason: 'hard decline',
        evidence: {
          sourceEventId: 'evt_2',
          providerPaymentId: 'pay_stolen',
          providerOrderId: 'order_stolen',
          eventType: 'payment.failed',
          amount: 100,
          currency: 'INR',
          occurredAt: new Date().toISOString(),
          failureCode: 'stolen_card',
        },
        detectedAt: new Date(),
        expiresAt: null,
        resolvedAt: null,
        recoveryEventId: null,
      });
      const stolenOpp = [...opportunityStore.rows.values()].find(
        (row) => row.providerPaymentId === 'pay_stolen'
      )!;

      const result = await service.requestExecution(stolenOpp.id);
      expect(result.outcome).toBe('blocked');
      if (result.outcome === 'blocked') {
        expect(result.reason).toBe('ACTION_NOT_EXECUTABLE');
        expect(result.execution?.status).toBe('BLOCKED');
      }
      expect(provider.calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('blocks when a captured payment already exists for the identity', async () => {
    const { app, service, eventStore } = await makeService();
    try {
      const sourceEvent = await eventStore.insert({
        merchantId: MERCHANT_A,
        paymentAccountId: null,
        provider: 'razorpay',
        providerEventId: 'payment.failed:pay_cap',
        eventType: 'payment.failed',
        providerPaymentId: 'pay_cap',
        providerOrderId: 'order_cap',
        eventCreatedAt: new Date(),
        receivedAt: new Date(),
        payload: {},
        normalizedData: {
          provider: 'razorpay',
          eventType: 'payment.failed',
          providerPaymentId: 'pay_cap',
          providerOrderId: 'order_cap',
          amount: 100,
          currency: 'INR',
          status: 'failed',
          method: 'card',
          email: null,
          contact: null,
          bank: null,
          errorCode: 'GATEWAY_ERROR',
          errorDescription: null,
          errorSource: null,
          errorStep: null,
          errorReason: null,
          subscriptionId: null,
          paymentCreatedAt: null,
          occurredAt: new Date().toISOString(),
        },
        signatureVerified: true,
        processingStatus: 'processed',
        processingAttempts: 1,
        processedAt: new Date(),
        failureReason: null,
      });
      await eventStore.insert({
        merchantId: MERCHANT_A,
        paymentAccountId: null,
        provider: 'razorpay',
        providerEventId: 'payment.captured:pay_captured2',
        eventType: 'payment.captured',
        providerPaymentId: 'pay_captured2',
        providerOrderId: 'order_cap',
        eventCreatedAt: new Date(Date.now() + 60_000),
        receivedAt: new Date(),
        payload: {},
        normalizedData: {
          provider: 'razorpay',
          eventType: 'payment.captured',
          providerPaymentId: 'pay_captured2',
          providerOrderId: 'order_cap',
          amount: 100,
          currency: 'INR',
          status: 'captured',
          method: 'card',
          email: null,
          contact: null,
          bank: null,
          errorCode: null,
          errorDescription: null,
          errorSource: null,
          errorStep: null,
          errorReason: null,
          subscriptionId: null,
          paymentCreatedAt: null,
          occurredAt: new Date().toISOString(),
        },
        signatureVerified: true,
        processingStatus: 'processed',
        processingAttempts: 1,
        processedAt: new Date(),
        failureReason: null,
      });

      // Seed an opportunity whose source event is the failed payment above.
      const opportunityStoreRef = (
        app.db.recoveryOpportunity as import('../helpers.js').InMemoryRecoveryOpportunityStore
      );
      const opp = await seedRetryableOpportunity(opportunityStoreRef);
      // Re-point the row at the captured identity via a direct map update.
      for (const [key, row] of opportunityStoreRef.rows.entries()) {
        if (row.id === opp.id) {
          opportunityStoreRef.rows.set(key, {
            ...row,
            sourceEventId: sourceEvent.id,
            providerPaymentId: 'pay_cap',
            providerOrderId: 'order_cap',
          });
        }
      }

      const result = await service.requestExecution(opp.id);
      expect(result.outcome).toBe('blocked');
      if (result.outcome === 'blocked') {
        expect(result.reason).toBe('PAYMENT_ALREADY_CAPTURED');
      }
    } finally {
      await app.close();
    }
  });

  it('refreshes stale decisions through the decision service before gating', async () => {
    const { app, service, provider, opportunityStore } = await makeService();
    try {
      const opportunity = await seedRetryableOpportunity(opportunityStore);
      // First read creates a decision while OPEN.
      await app.decisionService.getForOpportunity(opportunity.id);

      // Close the opportunity → stored decision becomes stale.
      await opportunityStore.markRecovered({
        id: opportunity.id,
        recoveryEventId: '00000000-0000-4000-8000-000000000099',
        resolvedAt: new Date(),
      });

      const result = await service.requestExecution(opportunity.id);
      expect(result.outcome).toBe('blocked');
      if (result.outcome === 'blocked') {
        // After recovery the refreshed decision becomes NO_ACTION, whose
        // non-executability is checked first; either way the provider is
        // never invoked for a recovered opportunity.
        expect(['OPPORTUNITY_NOT_OPEN', 'ACTION_NOT_EXECUTABLE']).toContain(
          result.reason
        );
      }
      expect(provider.calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('enforces the configured retry limit across attempts', async () => {
    const { app, service, provider, opportunityStore } = await makeService({ maxRetries: 2 });
    try {
      const opportunity = await seedRetryableOpportunity(opportunityStore);
      // Simulate two prior attempts recorded for this opportunity.
      await service.requestExecution(opportunity.id); // attempt 1 (idempotent key uses count+1)

      // Directly record a second attempt via the same path is replayed, so
      // simulate history by inserting another execution row:
      await (app.db.recoveryExecution as InMemoryRecoveryExecutionStore).insert({
        merchantId: MERCHANT_A,
        opportunityId: opportunity.id,
        decisionId: '00000000-0000-4000-8000-0000000000dd',
        action: 'RETRY',
        status: 'FAILED',
        origin: 'MANUAL',
        nextAttemptAt: null,
        scheduledAt: null,
        attempt: 2,
        idempotencyKey: `${opportunity.id}:other-decision:RETRY:2`,
        provider: 'fake',
        providerPaymentId: 'pay_retry_me',
        requestedAt: new Date(),
        startedAt: null,
        completedAt: new Date(),
        failureCode: 'payment_declined',
        failureReason: 'declined',
      });

      const third = await service.requestExecution(opportunity.id);
      expect(third.outcome).toBe('blocked');
      if (third.outcome === 'blocked') {
        expect(third.reason).toBe('RETRY_LIMIT_REACHED');
      }
      expect(provider.calls.length).toBeLessThanOrEqual(1);
    } finally {
      await app.close();
    }
  });

  it.each([
    ['timeout', { kind: 'unavailable', reason: 'timeout' } as const],
    ['rate_limited', { kind: 'unavailable', reason: 'rate_limited' } as const],
  ])('degrades safely on provider unavailability (%s)', async (_label, behavior) => {
    const provider = new FakeRecoveryExecutionProvider(behavior);
    const { app, service } = await makeService({ provider });
    try {
      const opportunity = await seedRetryableOpportunity(opportunityStoreRef(app));
      const result = await service.requestExecution(opportunity.id);

      expect(result.outcome).toBe('provider-unavailable');
      if (result.outcome === 'provider-unavailable') {
        expect(result.execution.status).toBe('FAILED');
        expect(result.execution.failureCode).toBe('PROVIDER_UNAVAILABLE');
        expect(result.reason).toBe(behavior.reason);
      }
      // Opportunity untouched.
      expect((await app.opportunities.findById(opportunity.id))?.status).toBe('OPEN');
    } finally {
      await app.close();
    }
  });

  it('records FAILED with normalized codes on provider rejection', async () => {
    const provider = new FakeRecoveryExecutionProvider({
      kind: 'rejected',
      failureCode: 'payment_declined',
      failureReason: 'The provider declined the retry.',
    });
    const { app, service } = await makeService({ provider });
    try {
      const opportunity = await seedRetryableOpportunity(opportunityStoreRef(app));
      const result = await service.requestExecution(opportunity.id);

      expect(result.outcome).toBe('provider-rejected');
      if (result.outcome === 'provider-rejected') {
        expect(result.execution.status).toBe('FAILED');
        expect(result.execution.failureCode).toBe('payment_declined');
      }
      expect((await app.opportunities.findById(opportunity.id))?.status).toBe('OPEN');
    } finally {
      await app.close();
    }
  });

  it('survives a provider crash without failing the caller', async () => {
    const provider = new FakeRecoveryExecutionProvider({ kind: 'throw' });
    const { app, service } = await makeService({ provider });
    try {
      const opportunity = await seedRetryableOpportunity(opportunityStoreRef(app));
      const result = await service.requestExecution(opportunity.id);
      expect(result.outcome).toBe('provider-unavailable');
      if (result.outcome === 'provider-unavailable') {
        expect(result.execution.status).toBe('FAILED');
        expect(result.execution.failureCode).toBe('PROVIDER_ERROR');
      }
    } finally {
      await app.close();
    }
  });

  it('returns not-found for unknown opportunities', async () => {
    const { app, service } = await makeService();
    try {
      expect(await service.requestExecution('99999999-9999-4999-8999-999999999999')).toEqual({
        outcome: 'not-found',
      });
    } finally {
      await app.close();
    }
  });

  it('keeps executions attributed to their owning opportunity/merchant', async () => {
    const provider = new FakeRecoveryExecutionProvider();
    const { app, service, opportunityStore } = await makeService({ provider });
    try {
      const opportunityA = await seedRetryableOpportunity(opportunityStore);
      await opportunityStore.insert({
        merchantId: '22222222-2222-4222-8222-222222222222',
        paymentAccountId: null,
        type: 'FAILED_PAYMENT',
        status: 'OPEN',
        sourceEventId: '00000000-0000-4000-8000-000000000005',
        providerPaymentId: 'pay_B',
        providerOrderId: 'order_B',
        amountAtRisk: 100,
        currency: 'INR',
        reason: 'merchant B case',
        evidence: {
          sourceEventId: 'evt_B',
          providerPaymentId: 'pay_B',
          providerOrderId: 'order_B',
          eventType: 'payment.failed',
          amount: 100,
          currency: 'INR',
          occurredAt: new Date().toISOString(),
          failureCode: 'GATEWAY_ERROR',
        },
        detectedAt: new Date(),
        expiresAt: null,
        resolvedAt: null,
        recoveryEventId: null,
      });

      await service.requestExecution(opportunityA.id);
      const rows = [...(app.db.recoveryExecution as InMemoryRecoveryExecutionStore).rows.values()];
      expect(rows.every((row) => row.merchantId === MERCHANT_A)).toBe(true);
      expect(rows.every((row) => row.opportunityId === opportunityA.id)).toBe(true);
    } finally {
      await app.close();
    }
  });
});

function opportunityStoreRef(app: FastifyInstance): import('../helpers.js').InMemoryRecoveryOpportunityStore {
  return app.db.recoveryOpportunity as import('../helpers.js').InMemoryRecoveryOpportunityStore;
}
