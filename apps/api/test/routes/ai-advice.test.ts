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

async function makeApp(options: { enabled?: boolean; advisor?: FakeAIRecoveryAdvisor | null } = {}) {
  const paymentEvent = new InMemoryPaymentEventStore();
  const recoveryOpportunity = new (await import('../helpers.js')).InMemoryRecoveryOpportunityStore();
  const recoveryDecision = new (await import('../helpers.js')).InMemoryRecoveryDecisionStore();
  const recoveryAIAdvice = new InMemoryRecoveryAIAdviceStore();
  const app: FastifyInstance = await buildApp({
    env: makeTestEnv(),
    db: createDbExecutorMock(undefined, {
      paymentEvent,
      recoveryOpportunity,
      recoveryDecision,
      recoveryAIAdvice,
    }),
  });
  await app.ready();

  const advisor =
    options.advisor === undefined ? new FakeAIRecoveryAdvisor() : options.advisor;
  const aiService = new RecoveryAIAdvisorService(
    app.decisionService,
    recoveryAIAdvice,
    advisor,
    {
      enabled: options.enabled ?? true,
      provider: 'fake',
      model: 'fake-model',
      advisorVersion: 'v1',
    }
  );
  // Route handlers read the decoration; swap in the test-controlled service.
  app.aiAdvisorService = aiService;

  return { app, advisor, recoveryOpportunity, recoveryAIAdvice };
}

async function seedOpenOpportunity(
  store: import('../helpers.js').InMemoryRecoveryOpportunityStore
) {
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
      occurredAt: new Date().toISOString(),
      failureCode: 'GATEWAY_ERROR',
    },
    detectedAt: new Date(),
    expiresAt: null,
    resolvedAt: null,
    recoveryEventId: null,
  });
}

describe('GET /opportunities/:id/ai-advice', () => {
  it('returns the deterministic decision plus generated advice', async () => {
    const { app, recoveryOpportunity } = await makeApp();
    try {
      const opportunity = await seedOpenOpportunity(recoveryOpportunity);
      const res = await app.inject({
        method: 'GET',
        url: `/opportunities/${opportunity.id}/ai-advice`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        opportunityId: string;
        decision: Record<string, unknown>;
        ai: Record<string, unknown> & { status: string };
      }>();
      expect(body.opportunityId).toBe(opportunity.id);
      // Deterministic decision is always present and authoritative.
      expect(body.decision.recommendedAction).toBeDefined();
      expect(body.decision.score).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(body.decision.riskFlags)).toBe(true);
      expect(body.ai.status).toBe('available');
      expect(typeof body.ai.summary).toBe('string');
    } finally {
      await app.close();
    }
  });

  it('reuses the persisted advice across repeated requests', async () => {
    const advisor = new FakeAIRecoveryAdvisor();
    const { app, advisor: _advisorRef, recoveryOpportunity, recoveryAIAdvice } = await makeApp({ advisor });
    void _advisorRef;
    try {
      const opportunity = await seedOpenOpportunity(recoveryOpportunity);
      const url = `/opportunities/${opportunity.id}/ai-advice`;
      await app.inject({ method: 'GET', url });
      await app.inject({ method: 'GET', url });

      expect(advisor.calls).toHaveLength(1); // second read served from cache
      expect(recoveryAIAdvice.rows.size).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('reports a clean disabled state when AI is off', async () => {
    const { app, recoveryOpportunity } = await makeApp({ enabled: false });
    try {
      const opportunity = await seedOpenOpportunity(recoveryOpportunity);
      const res = await app.inject({
        method: 'GET',
        url: `/opportunities/${opportunity.id}/ai-advice`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ decision: unknown; ai: { status: string; message: string } }>();
      expect(body.ai.status).toBe('disabled');
      expect(body.ai.message).toContain('Deterministic recovery analysis remains active');
      expect(body.decision).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('degrades to an unavailable state when the provider fails, keeping the decision', async () => {
    for (const behavior of [
      { kind: 'timeout' },
      { kind: 'rate_limited' },
      { kind: 'provider_error' },
      { kind: 'invalid_response_schema' },
    ] as const) {
      const { app, recoveryOpportunity } = await makeApp({
        advisor: new FakeAIRecoveryAdvisor(behavior),
      });
      try {
        const opportunity = await seedOpenOpportunity(recoveryOpportunity);
        const res = await app.inject({
          method: 'GET',
          url: `/opportunities/${opportunity.id}/ai-advice`,
        });

        expect(res.statusCode).toBe(200);
        const body = res.json<{
          decision: { recommendedAction: string };
          ai: { status: string; reason?: string; message?: string };
        }>();
        expect(body.ai.status).toBe('unavailable');
        expect(typeof body.ai.reason).toBe('string');
        expect(body.ai.message).not.toContain('stack');
        // Deterministic decision still visible and intact.
        expect(typeof body.decision.recommendedAction).toBe('string');
      } finally {
        await app.close();
      }
    }
  });

  it('returns 404 for an unknown opportunity', async () => {
    const { app } = await makeApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/opportunities/99999999-9999-4999-8999-999999999999/ai-advice',
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('returns 422 for a malformed id', async () => {
    const { app } = await makeApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/opportunities/not-a-uuid/ai-advice',
      });
      expect(res.statusCode).toBe(422);
    } finally {
      await app.close();
    }
  });

  it('never leaks provider secrets or internal errors', async () => {
    const advisor = new FakeAIRecoveryAdvisor({ kind: 'throw' });
    const { app, recoveryOpportunity } = await makeApp({ advisor });
    try {
      const opportunity = await seedOpenOpportunity(recoveryOpportunity);
      const res = await app.inject({
        method: 'GET',
        url: `/opportunities/${opportunity.id}/ai-advice`,
      });

      expect(res.statusCode).toBe(200);
      const raw = res.body;
      expect(raw.toLowerCase()).not.toContain('api_key');
      expect(raw.toLowerCase()).not.toContain('bearer');
      expect(raw.toLowerCase()).not.toContain('synthetic advisor crash');
      expect(raw.toLowerCase()).not.toContain('customer@example.com');
    } finally {
      await app.close();
    }
  });

  it('scopes advice generation to the requested tenant opportunity', async () => {
    const advisor = new FakeAIRecoveryAdvisor();
    const { app, recoveryOpportunity } = await makeApp({ advisor });
    try {
      const oppA = await seedOpenOpportunity(recoveryOpportunity);
      await opportunityB(recoveryOpportunity);

      const resA = await app.inject({
        method: 'GET',
        url: `/opportunities/${oppA.id}/ai-advice`,
      });
      const body = resA.json<{ ai: { status: string } & { [key: string]: unknown } }>();
      if (body.ai.status === 'available') {
        // Advice is reachable only through the opportunity path of its owner.
        expect(body.ai['summary']).toBeDefined();
      }
      expect(resA.statusCode).toBe(200);
      expect(advisor.calls.every((call) => call.opportunityId === oppA.id)).toBe(true);
    } finally {
      await app.close();
    }
  });
});

async function opportunityB(
  store: import('../helpers.js').InMemoryRecoveryOpportunityStore
) {
  return store.insert({
    merchantId: '22222222-2222-4222-8222-222222222222',
    paymentAccountId: null,
    type: 'FAILED_PAYMENT',
    status: 'OPEN',
    sourceEventId: '00000000-0000-4000-8000-000000000002',
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
}
