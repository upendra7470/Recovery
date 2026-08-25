import { describe, expect, it } from 'vitest';
import {
  InMemoryPaymentEventStore,
  InMemoryRecoveryDecisionStore,
  InMemoryRecoveryOpportunityStore,
  makeTestEnv,
} from '../helpers.js';
import { buildApp } from '../../src/app.js';
import {
  createDbExecutorMock,
  createRecoveryOpportunityStoreMock,
} from '../helpers.js';
import type { FastifyInstance } from 'fastify';
import type { RecoveryDecisionRow } from '../../src/domain/recovery-decision.js';
import { DECISION_ENGINE_VERSION } from '../../src/decision/engine.js';

/**
 * Service-level behavior is exercised through the real app wiring (buildApp)
 * so decoration, repository and store layers are covered together.
 */
async function makeApp(options: {
  opportunityStore?: InMemoryRecoveryOpportunityStore;
  eventStore?: InMemoryPaymentEventStore;
} = {}) {
  const opportunityStore =
    options.opportunityStore ?? new InMemoryRecoveryOpportunityStore();
  const eventStore = options.eventStore ?? new InMemoryPaymentEventStore();
  const decisionStore = new InMemoryRecoveryDecisionStore();
  const app: FastifyInstance = await buildApp({
    env: makeTestEnv(),
    db: createDbExecutorMock(undefined, {
      recoveryOpportunity: opportunityStore,
      paymentEvent: eventStore,
      recoveryDecision: decisionStore,
    }),
  });
  await app.ready();
  return { app, opportunityStore, eventStore, decisionStore };
}

const MERCHANT_A = '11111111-1111-4111-8111-111111111111';
const MERCHANT_B = '22222222-2222-4222-8222-222222222222';

function seedOpportunity(
  store: InMemoryRecoveryOpportunityStore,
  overrides: {
    merchantId?: string | null;
    sourceEventId?: string;
    providerPaymentId?: string;
    providerOrderId?: string;
  } = {}
) {
  return store.insert({
    merchantId: MERCHANT_A,
    paymentAccountId: null,
    type: 'FAILED_PAYMENT',
    status: 'OPEN',
    sourceEventId: overrides.sourceEventId ?? '00000000-0000-4000-8000-000000000001',
    providerPaymentId: overrides.providerPaymentId ?? 'pay_src_1',
    providerOrderId: overrides.providerOrderId ?? 'order_1',
    amountAtRisk: 500_000,
    currency: 'INR',
    reason: 'Payment failed and no successful payment was observed within the detection window.',
    evidence: {
      sourceEventId: 'evt_1',
      providerPaymentId: overrides.providerPaymentId ?? 'pay_src_1',
      providerOrderId: overrides.providerOrderId ?? 'order_1',
      eventType: 'payment.failed',
      amount: 500_000,
      currency: 'INR',
      occurredAt: new Date(1_700_000_000_000).toISOString(),
      failureCode: 'GATEWAY_ERROR',
    },
    detectedAt: new Date(1_799_990_000_000),
    expiresAt: null,
    resolvedAt: null,
    recoveryEventId: null,
    ...(overrides.merchantId !== undefined ? { merchantId: overrides.merchantId } : {}),
  });
}

describe('RecoveryDecisionService evaluation', () => {
  it('evaluates an opportunity and persists a decision attributed to its merchant', async () => {
    const { app, opportunityStore } = await makeApp();
    try {
      const service = app.decisionService;
      const opportunity = await seedOpportunity(opportunityStore);
      const evaluatedAt = new Date(1_800_000_000_000);

      const outcome = await service.evaluateForOpportunity(opportunity.id, evaluatedAt);

      expect(outcome.status).toBe('evaluated');
      const decision = outcome.decision as RecoveryDecisionRow;
      expect(decision.opportunityId).toBe(opportunity.id);
      // Tenant attribution flows ONLY from the persisted opportunity.
      expect(decision.merchantId).toBe(MERCHANT_A);
      expect(decision.engineVersion).toBe('v1');
      expect(decision.score).toBeGreaterThanOrEqual(0);
      expect(decision.score).toBeLessThanOrEqual(100);
      expect(decision.reasons.length).toBeGreaterThan(0);
      expect(decision.factors.length).toBeGreaterThan(0);

      // Determinism: re-evaluating with identical inputs reproduces every
      // decision field (persistence bookkeeping like updatedAt may differ).
      const replay = await service.evaluateForOpportunity(opportunity.id, evaluatedAt);
      const fields = (row: RecoveryDecisionRow | null) => ({
        score: row?.score,
        priority: row?.priority,
        confidence: row?.confidence,
        recommendedAction: row?.recommendedAction,
        reasons: row?.reasons,
        factors: row?.factors,
        riskFlags: row?.riskFlags,
        engineVersion: row?.engineVersion,
        evaluatedAt: row?.evaluatedAt,
        merchantId: row?.merchantId,
      });
      expect(replay.decision && fields(replay.decision)).toEqual(fields(decision));
    } finally {
      await app.close();
    }
  });

  it('returns not-found for a missing opportunity', async () => {
    const { app } = await makeApp();
    try {
      const outcome = await app.decisionService.evaluateForOpportunity(
        '99999999-9999-4999-8999-999999999999'
      );
      expect(outcome.status).toBe('not-found');
      expect(outcome.decision).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('observes correlated failed retries from the payment event store', async () => {
    const eventStore = new InMemoryPaymentEventStore();
    const { app, opportunityStore } = await makeApp({ eventStore });
    try {
      const sourceEvent = await eventStore.insert({
        merchantId: MERCHANT_A,
        paymentAccountId: null,
        provider: 'razorpay',
        providerEventId: 'payment.failed:pay_src_1',
        eventType: 'payment.failed',
        providerPaymentId: 'pay_src_1',
        providerOrderId: 'order_1',
        eventCreatedAt: new Date(1_799_900_000_000),
        receivedAt: new Date(1_799_900_000_000),
        payload: {},
        normalizedData: {
          provider: 'razorpay',
          eventType: 'payment.failed',
          providerPaymentId: 'pay_src_1',
          providerOrderId: 'order_1',
          amount: 500_000,
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
          occurredAt: new Date(1_799_900_000_000).toISOString(),
        },
        signatureVerified: true,
        processingStatus: 'processed',
        processingAttempts: 1,
        processedAt: new Date(),
        failureReason: null,
      });
      // A later failed attempt on the same order — a real retry observation.
      await eventStore.insert({
        merchantId: MERCHANT_A,
        paymentAccountId: null,
        provider: 'razorpay',
        providerEventId: 'payment.failed:pay_retry_a',
        eventType: 'payment.failed',
        providerPaymentId: 'pay_retry_a',
        providerOrderId: 'order_1',
        eventCreatedAt: new Date(1_799_950_000_000),
        receivedAt: new Date(1_799_950_000_000),
        payload: {},
        normalizedData: {
          provider: 'razorpay',
          eventType: 'payment.failed',
          providerPaymentId: 'pay_retry_a',
          providerOrderId: 'order_1',
          amount: 500_000,
          currency: 'INR',
          status: 'failed',
          method: 'card',
          email: null,
          contact: null,
          bank: null,
          errorCode: 'insufficient_funds',
          errorDescription: null,
          errorSource: null,
          errorStep: null,
          errorReason: null,
          subscriptionId: null,
          paymentCreatedAt: null,
          occurredAt: new Date(1_799_950_000_000).toISOString(),
        },
        signatureVerified: true,
        processingStatus: 'processed',
        processingAttempts: 1,
        processedAt: new Date(),
        failureReason: null,
      });

      const opportunity = await seedOpportunity(opportunityStore, {
        sourceEventId: sourceEvent.id,
      });

      const outcome = await app.decisionService.evaluateForOpportunity(
        opportunity.id,
        new Date(1_800_000_000_000)
      );

      const retryFactor = outcome.decision?.factors.find((f) => f.name === 'retryHistory');
      expect(retryFactor?.value).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('feeds historical outcome statistics into the engine when available', async () => {
    const stats = { total: 200, recovered: 120 };
    const opportunityStore = new InMemoryRecoveryOpportunityStore();
    opportunityStore.outcomeStatsByType = async () => stats;

    const { app } = await makeApp({ opportunityStore });
    try {
      const opportunity = await seedOpportunity(opportunityStore);
      const outcome = await app.decisionService.evaluateForOpportunity(
        opportunity.id,
        new Date(1_800_000_000_000)
      );
      const support = outcome.decision?.factors.find((f) => f.name === 'historicalSupport');
      expect(support?.contribution).toBeGreaterThan(0);
      expect(support?.explanation).toContain('60.0%');
    } finally {
      await app.close();
    }
  });
});

describe('RecoveryDecisionService staleness & lifecycle', () => {
  it('lazily evaluates on first read', async () => {
    const { app, opportunityStore } = await makeApp();
    try {
      const opportunity = await seedOpportunity(opportunityStore);
      expect(
        await app.db.recoveryDecision.findByOpportunityAndEngineVersion(
          opportunity.id,
          DECISION_ENGINE_VERSION
        )
      ).toBeNull();

      const outcome = await app.decisionService.getForOpportunity(opportunity.id);
      expect(outcome.decision).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it('re-evaluates when the opportunity changed after the last evaluation', async () => {
    const { app, opportunityStore } = await makeApp();
    try {
      const opportunity = await seedOpportunity(opportunityStore);
      const before = await app.decisionService.getForOpportunity(opportunity.id);
      expect(before.decision?.recommendedAction).not.toBe('NO_ACTION');

      // Simulate the Phase 3 capture flow closing the opportunity.
      await opportunityStore.markRecovered({
        id: opportunity.id,
        recoveryEventId: '00000000-0000-4000-8000-000000000099',
        resolvedAt: new Date(),
      });

      const after = await app.decisionService.getForOpportunity(opportunity.id);
      expect(after.decision?.recommendedAction).toBe('NO_ACTION');
    } finally {
      await app.close();
    }
  });

  it('keeps decisions tenant-scoped to their owning opportunity', async () => {
    const { app, opportunityStore } = await makeApp();
    try {
      const opportunityA = await seedOpportunity(opportunityStore, {
        merchantId: MERCHANT_A,
        sourceEventId: '00000000-0000-4000-8000-00000000000a',
      });
      const opportunityB = await seedOpportunity(opportunityStore, {
        merchantId: MERCHANT_B,
        providerPaymentId: 'pay_src_B',
        providerOrderId: 'order_B',
        sourceEventId: '00000000-0000-4000-8000-00000000000b',
      });

      await app.decisionService.evaluateForOpportunity(opportunityA.id);
      await app.decisionService.evaluateForOpportunity(opportunityB.id);

      const decisionA = await app.db.recoveryDecision.findByOpportunityAndEngineVersion(
        opportunityA.id,
        DECISION_ENGINE_VERSION
      );
      const decisionB = await app.db.recoveryDecision.findByOpportunityAndEngineVersion(
        opportunityB.id,
        DECISION_ENGINE_VERSION
      );
      expect(decisionA?.merchantId).toBe(MERCHANT_A);
      expect(decisionB?.merchantId).toBe(MERCHANT_B);
    } finally {
      await app.close();
    }
  });
});

describe('createRecoveryOpportunityStoreMock default', () => {
  it('supports outcomeStatsByType for the default db mock', async () => {
    const mock = createRecoveryOpportunityStoreMock();
    expect(await mock.outcomeStatsByType('FAILED_PAYMENT')).toEqual({
      total: 0,
      recovered: 0,
    });
  });
});
