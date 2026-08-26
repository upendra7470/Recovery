import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { RecoveryOperationScheduler } from '../../src/services/recovery-operation-scheduler.service.js';
import {
  createDbExecutorMock,
  FakeRecoveryExecutionProvider,
  InMemoryPaymentEventStore,
  InMemoryRecoveryExecutionStore,
  makeTestEnv,
} from '../helpers.js';

const MERCHANT_A = '11111111-1111-4111-8111-111111111111';

interface Harness {
  app: FastifyInstance;
  scheduler: RecoveryOperationScheduler;
  provider: FakeRecoveryExecutionProvider;
  opportunityStore: import('../helpers.js').InMemoryRecoveryOpportunityStore;
  executionStore: InMemoryRecoveryExecutionStore;
}

async function makeHarness(options: {
  provider?: FakeRecoveryExecutionProvider | null;
  maxAttempts?: number;
  backoffSeconds?: number;
  maxAgeHours?: number;
} = {}): Promise<Harness> {
  const opportunityStore = new (await import('../helpers.js')).InMemoryRecoveryOpportunityStore();
  const paymentEvent = new InMemoryPaymentEventStore();
  const executionStore = new InMemoryRecoveryExecutionStore();
  const provider: FakeRecoveryExecutionProvider =
    options.provider === undefined ? new FakeRecoveryExecutionProvider() : options.provider!;
  const app: FastifyInstance = await buildApp({
    env: makeTestEnv({ RECOVERY_EXECUTION_ENABLED: 'true' }),
    db: createDbExecutorMock(undefined, {
      recoveryOpportunity: opportunityStore,
      paymentEvent: eventStoreRef(),
      recoveryExecution: executionStore,
    }),
    executionProvider: provider,
  });
  await app.ready();

  function eventStoreRef() {
    return paymentEvent;
  }

  const scheduler = new RecoveryOperationScheduler(
    app.opportunities,
    app.decisionService,
    new (await import('../../src/repositories/recovery-execution.repository.js')).RecoveryExecutionRepository(
      executionStore
    ),
    app.executionService,
    {
      maxAttempts: options.maxAttempts ?? 3,
      backoffSeconds: options.backoffSeconds ?? 300,
      maxAgeHours: options.maxAgeHours ?? 72,
      batchSize: 25,
    }
  );
  return { app, scheduler, provider, opportunityStore, executionStore };
}

async function seedRetryableOpportunity(store: Harness['opportunityStore'], id = '00000000-0000-4000-8000-0000000000a1') {
  return store.insert({
    merchantId: MERCHANT_A,
    paymentAccountId: null,
    type: 'FAILED_PAYMENT',
    status: 'OPEN',
    sourceEventId: id,
    providerPaymentId: `pay_${id.slice(-6)}`,
    providerOrderId: `order_${id.slice(-6)}`,
    amountAtRisk: 500_000,
    currency: 'INR',
    reason: 'Payment failed and no successful payment was observed within the detection window.',
    evidence: {
      sourceEventId: id,
      providerPaymentId: `pay_${id.slice(-6)}`,
      providerOrderId: `order_${id.slice(-6)}`,
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

describe('RecoveryOperationScheduler', () => {
  it('plans an automated PENDING execution for an eligible RETRY decision', async () => {
    const h = await makeHarness();
    try {
      await seedRetryableOpportunity(h.opportunityStore);
      const summary = await h.scheduler.tick();
      expect(summary.planned).toBe(1);

      // Second tick must NOT plan a duplicate (active execution exists).
      const second = await h.scheduler.tick();
      expect(second.planned).toBe(0);
    } finally {
      await h.app.close();
    }
  });

  /** Seeds an AUTOMATED PENDING execution directly (deterministic execution-phase setup). */
  async function seedPendingExecution(
    h: Harness,
    overrides: { attempt?: number; createdAt?: Date; nextAttemptAt?: Date } = {}
  ) {
    const opp = [...h.opportunityStore.rows.values()][0]!;
    return h.executionStore.insert({
      merchantId: opp.merchantId,
      opportunityId: opp.id,
      decisionId: '00000000-0000-4000-8000-0000000000dd',
      action: 'RETRY',
      status: 'PENDING',
      origin: 'AUTOMATED',
      attempt: overrides.attempt ?? 1,
      nextAttemptAt: overrides.nextAttemptAt ?? new Date(Date.now() - 1000),
      scheduledAt: new Date(),
      idempotencyKey: `${opp.id}:seed-decision:RETRY:${overrides.attempt ?? 1}:auto`,
      provider: null,
      providerPaymentId: opp.providerPaymentId,
      requestedAt: new Date(),
      startedAt: null,
      completedAt: null,
      failureCode: null,
      failureReason: null,
    });
  }

  it('executes due PENDING records through the shared pipeline exactly once', async () => {
    const h = await makeHarness();
    try {
      await seedRetryableOpportunity(h.opportunityStore);
      await seedPendingExecution(h);

      const summary = await h.scheduler.tick();

      expect(summary.executed).toBe(1);
      expect(summary.accepted).toBe(1);
      expect(h.provider.calls).toHaveLength(1);

      // A further tick replays nothing and calls nobody.
      const third = await h.scheduler.tick();
      expect(third.planned).toBe(0);
      expect(third.executed).toBe(0);
      expect(h.provider.calls).toHaveLength(1);
    } finally {
      await h.app.close();
    }
  });

  it('never marks the opportunity recovered on acceptance', async () => {
    const h = await makeHarness();
    try {
      await seedRetryableOpportunity(h.opportunityStore);
      await seedPendingExecution(h);
      await h.scheduler.tick();
      const opp = [...h.opportunityStore.rows.values()][0]!;
      expect(opp.status).toBe('OPEN');
    } finally {
      await h.app.close();
    }
  });

  it('audits blocked scheduled executions without provider calls', async () => {
    const h = await makeHarness();
    try {
      const stolenOpp = await h.opportunityStore.insert({
        merchantId: MERCHANT_A,
        paymentAccountId: null,
        type: 'FAILED_PAYMENT',
        status: 'OPEN',
        sourceEventId: '00000000-0000-4000-8000-0000000000b3',
        providerPaymentId: 'pay_stolen_b3',
        providerOrderId: 'order_stolen_b3',
        amountAtRisk: 100,
        currency: 'INR',
        reason: 'hard decline case',
        evidence: {
          sourceEventId: 'evt-b3',
          providerPaymentId: 'pay_stolen_b3',
          providerOrderId: 'order_stolen_b3',
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
      // Seed a PENDING automated row against the hard-decline opportunity.
      await h.executionStore.insert({
        merchantId: MERCHANT_A,
        opportunityId: stolenOpp.id,
        decisionId: '00000000-0000-4000-8000-0000000000de',
        action: 'RETRY',
        status: 'PENDING',
        origin: 'AUTOMATED',
        attempt: 1,
        nextAttemptAt: new Date(Date.now() - 1000),
        scheduledAt: new Date(),
        idempotencyKey: `${stolenOpp.id}:seed-decision:RETRY:1:auto`,
        provider: null,
        providerPaymentId: stolenOpp.providerPaymentId,
        requestedAt: new Date(),
        startedAt: null,
        completedAt: null,
        failureCode: null,
        failureReason: null,
      });

      const summary = await h.scheduler.tick();

      // The hard-decline row is audited as BLOCKED by the fresh-decision gate.
      expect(summary.blockedAudited).toBe(1);
      expect(h.provider.calls).toHaveLength(0);
      const history = await h.executionStore.listByOpportunity(stolenOpp.id);
      expect(history[0]?.status).toBe('BLOCKED');
      expect(history[0]?.failureCode).toBe('ACTION_NOT_EXECUTABLE');
    } finally {
      await h.app.close();
    }
  });

  it('does not plan or execute when there are no candidates', async () => {
    const h = await makeHarness();
    try {
      const summary = await h.scheduler.tick();
      expect(summary.planned).toBe(0);
      expect(summary.executed).toBe(0);
    } finally {
      await h.app.close();
    }
  });

  it('cancels stale PENDING executions deterministically', async () => {
    const h = await makeHarness({ maxAgeHours: 1 });
    try {
      // Hard-decline opportunity: the planner must never schedule it, so the
      // only PENDING work in this tick is the aged row under test.
      await seedRetryableOpportunity(h.opportunityStore).then(async (opp) => {
        for (const [key, row] of h.opportunityStore.rows.entries()) {
          if (row.id === opp.id) {
            h.opportunityStore.rows.set(key, {
              ...row,
              providerPaymentId: 'pay_stale_stolen',
              providerOrderId: 'order_stale_stolen',
              evidence: {
                ...(row.evidence as Record<string, unknown>),
                providerPaymentId: 'pay_stale_stolen',
                providerOrderId: 'order_stale_stolen',
                failureCode: 'stolen_card',
              },
            });
          }
        }
        return opp;
      });
      const pending = await seedPendingExecution(h);
      // Age the pending row beyond the max age.
      for (const [key, row] of h.executionStore.rows.entries()) {
        if (row.id === pending.id) {
          h.executionStore.rows.set(key, {
            ...row,
            createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
          });
        }
      }

      const summary = await h.scheduler.tick();
      expect(summary.staleCancelled).toBe(1);
      const cancelled = [...h.executionStore.rows.values()].find(
        (row) => row.status === 'CANCELLED'
      );
      expect(cancelled?.failureCode).toBe('STALE_MAX_AGE');
      expect(h.provider.calls).toHaveLength(0);
      expect(h.provider.calls).toHaveLength(0);
    } finally {
      await h.app.close();
    }
  });

  it('keeps automated executions attributed to their owning merchant', async () => {
    const h = await makeHarness();
    try {
      await seedRetryableOpportunity(h.opportunityStore);
      await h.scheduler.tick();
      await h.scheduler.tick();

      const rows = [...h.executionStore.rows.values()];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.merchantId === MERCHANT_A)).toBe(true);
      expect(rows.filter((row) => row.origin === 'AUTOMATED').length).toBeGreaterThan(0);
    } finally {
      await h.app.close();
    }
  });

  it('blocks scheduled execution when the opportunity is recovered between planning and run', async () => {
    const h = await makeHarness();
    try {
      const opp = await seedRetryableOpportunity(h.opportunityStore);
      const pending = await seedPendingExecution(h);

      // Recover via the webhook flow before the scheduler runs the row.
      await h.opportunityStore.markRecovered({
        id: opp.id,
        recoveryEventId: '00000000-0000-4000-8000-000000000099',
        resolvedAt: new Date(),
      });
      void pending;

      const summary = await h.scheduler.tick();
      // The stale decision re-evaluates to NO_ACTION → audited block, no call.
      expect(summary.blockedAudited).toBe(1);
      expect(h.provider.calls).toHaveLength(0);
      const oppAfter = [...h.opportunityStore.rows.values()].find((row) => row.id === opp.id);
      expect(oppAfter?.status).toBe('RECOVERED');
    } finally {
      await h.app.close();
    }
  });
});
