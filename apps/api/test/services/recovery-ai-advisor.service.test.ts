import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { RecoveryAIAdvisorService } from '../../src/services/recovery-ai-advisor.service.js';
import {
  createDbExecutorMock,
  FakeAIRecoveryAdvisor,
  InMemoryPaymentEventStore,
  InMemoryRecoveryAIAdviceStore,
  makeTestEnv,
} from '../helpers.js';

const MERCHANT_A = '11111111-1111-4111-8111-111111111111';
const MERCHANT_B = '22222222-2222-4222-8222-222222222222';

function seedOpportunity(store: import('../helpers.js').InMemoryRecoveryOpportunityStore) {
  return store.insert({
    merchantId: MERCHANT_A,
    paymentAccountId: null,
    type: 'FAILED_PAYMENT',
    status: 'OPEN',
    sourceEventId: '00000000-0000-4000-8000-000000000001',
    providerPaymentId: 'pay_src_1',
    providerOrderId: 'order_1',
    amountAtRisk: 500_000,
    currency: 'INR',
    reason: 'Payment failed and no successful payment was observed within the detection window.',
    evidence: {
      sourceEventId: 'evt_1',
      providerPaymentId: 'pay_src_1',
      providerOrderId: 'order_1',
      eventType: 'payment.failed',
      amount: 500_000,
      currency: 'INR',
      occurredAt: new Date(1_700_000_000_000).toISOString(),
      failureCode: 'GATEWAY_ERROR',
    },
    detectedAt: new Date(),
    expiresAt: null,
    resolvedAt: null,
    recoveryEventId: null,
  });
}

async function buildService(options: { enabled?: boolean; advisor?: FakeAIRecoveryAdvisor | null } = {}) {
  const opportunityStore = new (await import('../helpers.js')).InMemoryRecoveryOpportunityStore();
  const eventStore = new InMemoryPaymentEventStore();
  const decisionStore = new (await import('../helpers.js')).InMemoryRecoveryDecisionStore();
  const adviceStore = new InMemoryRecoveryAIAdviceStore();
  const app: FastifyInstance = await buildApp({
    env: makeTestEnv(),
    db: createDbExecutorMock(undefined, {
      recoveryOpportunity: opportunityStore,
      paymentEvent: eventStore,
      recoveryDecision: decisionStore,
      recoveryAIAdvice: adviceStore,
    }),
  });
  await app.ready();

  const advisor = options.advisor === undefined ? new FakeAIRecoveryAdvisor() : options.advisor;
  const service = new RecoveryAIAdvisorService(
    app.decisionService,
    adviceStore,
    advisor,
    {
      enabled: options.enabled ?? true,
      provider: 'fake',
      model: 'fake-model',
      advisorVersion: 'v1',
    }
  );
  return { app, service, advisor, opportunityStore, decisionStore, adviceStore };
}

describe('RecoveryAIAdvisorService', () => {
  it('returns not-found for unknown opportunities', async () => {
    const { app, service } = await buildService();
    try {
      const outcome = await service.getAdviceForOpportunity(
        '99999999-9999-4999-8999-999999999999'
      );
      expect(outcome.status).toBe('not-found');
      expect(outcome.decision).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('reports a clean disabled state without calling the advisor', async () => {
    const advisor = new FakeAIRecoveryAdvisor();
    const { app, service } = await buildService({ enabled: false, advisor });
    try {
      const opportunity = await seedOpportunity(
        (app.db.recoveryOpportunity as import('../helpers.js').InMemoryRecoveryOpportunityStore)
      );
      const outcome = await service.getAdviceForOpportunity(opportunity.id);

      expect(outcome.ai).toEqual({ status: 'disabled' });
      // The authoritative deterministic decision is still present.
      expect(outcome.decision).not.toBeNull();
      expect(advisor.calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('generates, validates and persists advice on first read', async () => {
    const { app, service, adviceStore } = await buildService();
    try {
      const opportunity = await seedOpportunity(opportunityStoreRef(app));
      const outcome = await service.getAdviceForOpportunity(opportunity.id);

      expect(outcome.ai.status).toBe('available');
      if (outcome.ai.status === 'available') {
        expect(outcome.ai.advice.summary.length).toBeGreaterThan(8);
        expect(outcome.ai.advice.decisionFingerprint).not.toBe('');
        expect(outcome.ai.advice.merchantId).toBe(MERCHANT_A);
      }
      expect(adviceStore.rows.size).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('reuses persisted advice when the deterministic decision is unchanged', async () => {
    const advisor = new FakeAIRecoveryAdvisor();
    const { app, service, adviceStore } = await buildService({ advisor });
    try {
      const opportunity = await seedOpportunity(opportunityStoreRef(app));
      const first = await service.getAdviceForOpportunity(opportunity.id);
      const second = await service.getAdviceForOpportunity(opportunity.id);

      expect(advisor.calls).toHaveLength(1); // generated once
      expect(adviceStore.rows.size).toBe(1);
      if (first.ai.status === 'available' && second.ai.status === 'available') {
        expect(second.ai.advice.id).toBe(first.ai.advice.id);
        expect(second.ai.advice.createdAt).toEqual(first.ai.advice.createdAt);
      } else {
        throw new Error('expected available advice on both reads');
      }
    } finally {
      await app.close();
    }
  });

  it('regenerates advice when the deterministic decision changes', async () => {
    const advisor = new FakeAIRecoveryAdvisor();
    const { app, service, advisor: _a, opportunityStore, adviceStore } = await buildService({ advisor });
    void _a;
    try {
      const opportunity = await seedOpportunity(opportunityStore);
      await service.getAdviceForOpportunity(opportunity.id);

      // Close the opportunity → stale-aware decision re-evaluates to
      // NO_ACTION → fingerprint changes → fresh advice required.
      await opportunityStore.markRecovered({
        id: opportunity.id,
        recoveryEventId: '00000000-0000-4000-8000-000000000099',
        resolvedAt: new Date(),
      });

      const after = await service.getAdviceForOpportunity(opportunity.id);
      expect(advisor.calls.length).toBeGreaterThanOrEqual(2);
      expect(after.decision?.recommendedAction).toBe('NO_ACTION');
      expect(adviceStore.upsertCalls.at(-1)?.decisionFingerprint).not.toBe(
        adviceStore.upsertCalls[0]?.decisionFingerprint
      );
    } finally {
      await app.close();
    }
  });

  it.each([
    ['timeout', { kind: 'timeout' } as const],
    ['rate_limited', { kind: 'rate_limited' } as const],
    ['provider_error', { kind: 'provider_error' } as const],
    ['network_error', { kind: 'network_error' } as const],
    ['invalid_response (malformed)', { kind: 'invalid_response_malformed_json' } as const],
    ['invalid_response (schema)', { kind: 'invalid_response_schema' } as const],
  ])('degrades to unavailable (%s) while preserving the deterministic decision', async (_label, behavior) => {
    const advisor = new FakeAIRecoveryAdvisor(behavior);
    const { app, service } = await buildService({ advisor });
    try {
      const opportunity = await seedOpportunity(opportunityStoreRef(app));
      const outcome = await service.getAdviceForOpportunity(opportunity.id);

      expect(outcome.ai.status).toBe('unavailable');
      if (outcome.ai.status === 'unavailable') {
        expect(typeof outcome.ai.reason).toBe('string');
      }
      // Deterministic decision survives untouched.
      expect(outcome.decision).not.toBeNull();
      expect(outcome.decision?.recommendedAction).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('survives an advisor crash without failing the request', async () => {
    const advisor = new FakeAIRecoveryAdvisor({ kind: 'throw' });
    const { app, service } = await buildService({ advisor });
    try {
      const outcome = await service.getAdviceForOpportunity(
        (await seedOpportunity(opportunityStoreRef(app))).id
      );
      expect(outcome.ai).toEqual({ status: 'unavailable', reason: 'provider_error' });
      expect(outcome.decision).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it('marks safety-constrained advice when the model contradicts DO_NOT_RETRY context', async () => {
    const advisor = new FakeAIRecoveryAdvisor({
      kind: 'success',
      content: {
        summary: 'Hard decline on a blocked instrument; retry immediately.',
        nextStep: 'Retry now with another card.',
      },
    });
    // Force a hard-decline scenario through the seeded evidence.
    const { app, service, opportunityStore, adviceStore } = await buildService({ advisor });
    try {
      const opportunity = await seedOpportunity(opportunityStore);
      await opportunityStore.insert({
        merchantId: MERCHANT_B,
        paymentAccountId: null,
        type: 'FAILED_PAYMENT',
        status: 'OPEN',
        sourceEventId: '00000000-0000-4000-8000-000000000002',
        providerPaymentId: 'pay_stolen',
        providerOrderId: 'order_stolen',
        amountAtRisk: 100,
        currency: 'INR',
        reason: 'hard decline case',
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
      void opportunity;

      const stolenRow = [...opportunityStore.rows.values()].find(
        (row) => row.providerPaymentId === 'pay_stolen'
      );
      const stolenOppId = stolenRow!.id;
      const outcome = await service.getAdviceForOpportunity(stolenOppId);

      expect(outcome.decision?.recommendedAction).toBe('DO_NOT_RETRY');
      expect(outcome.ai.status).toBe('available');
      if (outcome.ai.status === 'available') {
        expect(outcome.ai.advice.safetyConstrained).toBe(true);
        expect(outcome.ai.advice.warnings.some((w) => w.includes('Safety constraint'))).toBe(true);
      }
      expect(adviceStore.rows.size).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('keeps advice tenant-attributed to its owning opportunity', async () => {
    const advisor = new FakeAIRecoveryAdvisor();
    const { app, service, opportunityStore } = await buildService({ advisor });
    try {
      const oppA = await seedOpportunity(opportunityStore);
      const oppB = await opportunityStore.insert({
        merchantId: MERCHANT_B,
        paymentAccountId: null,
        type: 'FAILED_PAYMENT',
        status: 'OPEN',
        sourceEventId: '00000000-0000-4000-8000-000000000003',
        providerPaymentId: 'pay_src_B',
        providerOrderId: 'order_B',
        amountAtRisk: 100,
        currency: 'INR',
        reason: 'merchant B case',
        evidence: {
          sourceEventId: 'evt_3',
          providerPaymentId: 'pay_src_B',
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

      const outcomeA = await service.getAdviceForOpportunity(oppA.id);
      const outcomeB = await service.getAdviceForOpportunity(oppB.id);

      const merchantIds = [outcomeA, outcomeB].map((outcome) =>
        outcome.ai.status === 'available' ? outcome.ai.advice.merchantId : 'missing'
      );
      expect(merchantIds).toEqual([MERCHANT_A, MERCHANT_B]);
    } finally {
      await app.close();
    }
  });

  it('sends only minimized fields to the advisor', async () => {
    const advisor = new FakeAIRecoveryAdvisor();
    const { app, service, opportunityStore } = await buildService({ advisor });
    try {
      const opportunity = await seedOpportunity(opportunityStore);
      await service.getAdviceForOpportunity(opportunity.id);

      const sent = advisor.calls[0];
      expect(sent).toBeDefined();
      const serialized = JSON.stringify(sent);
      expect(serialized).not.toContain('customer@example.com');
      expect(serialized).not.toContain('+91');
      expect(sent!.recommendation).toBeDefined();
      expect(sent!.failureCode).toBe('GATEWAY_ERROR');
    } finally {
      await app.close();
    }
  });
});

function opportunityStoreRef(app: FastifyInstance): import('../helpers.js').InMemoryRecoveryOpportunityStore {
  return app.db.recoveryOpportunity as import('../helpers.js').InMemoryRecoveryOpportunityStore;
}
