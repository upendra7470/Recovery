import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import {
  createDbExecutorMock,
  InMemoryPaymentEventStore,
  InMemoryRecoveryDecisionStore,
  InMemoryRecoveryOpportunityStore,
  makeTestEnv,
} from '../helpers.js';
import type { DecisionDetailResponse } from '../../src/routes/decisions.js';
import type {
  OpportunityListResponse,
} from '../../src/routes/opportunities.js';
import { DECISION_ENGINE_VERSION } from '../../src/decision/engine.js';

const MERCHANT_A = '11111111-1111-4111-8111-111111111111';
const MERCHANT_B = '22222222-2222-4222-8222-222222222222';

async function makeApp() {
  const paymentEvent = new InMemoryPaymentEventStore();
  const recoveryOpportunity = new InMemoryRecoveryOpportunityStore();
  const recoveryDecision = new InMemoryRecoveryDecisionStore();
  const app: FastifyInstance = await buildApp({
    env: makeTestEnv(),
    db: createDbExecutorMock(undefined, {
      paymentEvent,
      recoveryOpportunity,
      recoveryDecision,
    }),
  });
  await app.ready();
  return { app, paymentEvent, recoveryOpportunity, recoveryDecision };
}

async function seedOpenOpportunity(
  store: InMemoryRecoveryOpportunityStore,
  overrides: {
    merchantId?: string | null;
    sourceEventId?: string;
    providerPaymentId?: string;
    providerOrderId?: string;
  } = {}
) {
  return store.insert({
    merchantId: overrides.merchantId ?? MERCHANT_A,
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
  });
}

describe('GET /opportunities/:id/decision', () => {
  it('evaluates and returns a fully explainable decision', async () => {
    const { app, recoveryOpportunity } = await makeApp();
    try {
      const opportunity = await seedOpenOpportunity(recoveryOpportunity);

      const res = await app.inject({
        method: 'GET',
        url: `/opportunities/${opportunity.id}/decision`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<DecisionDetailResponse>();
      expect(body.opportunityId).toBe(opportunity.id);
      expect(body.engineVersion).toBe(DECISION_ENGINE_VERSION);
      expect(body.score).toBeGreaterThanOrEqual(0);
      expect(body.score).toBeLessThanOrEqual(100);
      expect(['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(body.priority);
      expect(body.confidence).toBeGreaterThanOrEqual(0);
      expect(body.confidence).toBeLessThanOrEqual(100);
      expect([
        'RETRY',
        'WAIT',
        'CUSTOMER_ACTION_REQUIRED',
        'DO_NOT_RETRY',
        'REVIEW',
        'NO_ACTION',
      ]).toContain(body.recommendedAction);
      expect(body.reasons.length).toBeGreaterThan(0);
      for (const factor of body.factors) {
        expect(factor.explanation.trim()).not.toBe('');
      }
      expect(Array.isArray(body.riskFlags)).toBe(true);

      // Second read returns the SAME stored decision (no re-evaluation churn).
      const second = await app.inject({
        method: 'GET',
        url: `/opportunities/${opportunity.id}/decision`,
      });
      expect(second.json<DecisionDetailResponse>()).toEqual(body);
    } finally {
      await app.close();
    }
  });

  it('returns 404 for an unknown opportunity id', async () => {
    const { app } = await makeApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/opportunities/99999999-9999-4999-8999-999999999999/decision',
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('returns 422 for a malformed opportunity id', async () => {
    const { app } = await makeApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/opportunities/not-a-uuid/decision',
      });
      expect(res.statusCode).toBe(422);
    } finally {
      await app.close();
    }
  });
});

describe('GET /decisions/overview', () => {
  it('reports honest zeros before any evaluation', async () => {
    const { app } = await makeApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/decisions/overview' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        criticalOpportunities: 0,
        highPriorityOpportunities: 0,
        recommendedRetries: 0,
        reviewRequired: 0,
        doNotRetry: 0,
        averageConfidence: null,
        engineVersion: DECISION_ENGINE_VERSION,
      });
    } finally {
      await app.close();
    }
  });

  it('counts evaluated decisions and scopes by merchantId', async () => {
    const { app, recoveryOpportunity } = await makeApp();
    try {
      const oppA = await seedOpenOpportunity(recoveryOpportunity, {
        merchantId: MERCHANT_A,
        sourceEventId: '00000000-0000-4000-8000-00000000000a',
      });
      const oppB = await seedOpenOpportunity(recoveryOpportunity, {
        merchantId: MERCHANT_B,
        sourceEventId: '00000000-0000-4000-8000-00000000000b',
        providerOrderId: 'order_B',
        providerPaymentId: 'pay_B',
      });

      await app.decisionService.evaluateForOpportunity(oppA.id);
      await app.decisionService.evaluateForOpportunity(oppB.id);

      const all = await app.inject({ method: 'GET', url: '/decisions/overview' });
      const allBody = all.json<{ recommendedRetries: number; averageConfidence: number | null }>();
      expect(allBody.recommendedRetries).toBe(2);
      expect(allBody.averageConfidence).not.toBeNull();

      const scoped = await app.inject({
        method: 'GET',
        url: `/decisions/overview?merchantId=${MERCHANT_B}`,
      });
      const scopedBody = scoped.json<{
        recommendedRetries: number;
        averageConfidence: number | null;
      }>();
      expect(scopedBody.recommendedRetries).toBe(1);

      // Merchant A's scope never sees merchant B's counts.
      const scopedA = await app.inject({
        method: 'GET',
        url: `/decisions/overview?merchantId=${MERCHANT_A}`,
      });
      expect(
        scopedA.json<{ recommendedRetries: number }>().recommendedRetries
      ).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('rejects unknown query parameters with 422', async () => {
    const { app } = await makeApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/decisions/overview?bogus=1',
      });
      expect(res.statusCode).toBe(422);
    } finally {
      await app.close();
    }
  });
});

describe('GET /opportunities decision summaries', () => {
  it('includes an additive decision field once an opportunity is evaluated', async () => {
    const { app, recoveryOpportunity } = await makeApp();
    try {
      const opportunity = await seedOpenOpportunity(recoveryOpportunity);

      const before = await app.inject({ method: 'GET', url: '/opportunities' });
      const beforeBody = before.json<OpportunityListResponse>();
      expect(beforeBody.total).toBe(1);
      expect(beforeBody.opportunities[0]?.decision).toBeUndefined();

      await app.decisionService.evaluateForOpportunity(opportunity.id);

      const after = await app.inject({ method: 'GET', url: '/opportunities' });
      const afterBody = after.json<OpportunityListResponse>();
      const summary = afterBody.opportunities[0]?.decision;
      expect(summary).toBeDefined();
      expect(typeof summary?.score).toBe('number');
      expect(summary?.priority).toBeDefined();
      expect(summary?.recommendedAction).toBeDefined();

      // Existing fields remain intact (backward compatibility).
      expect(afterBody.opportunities[0]?.amountAtRisk).toBe(500_000);
      expect(afterBody.opportunities[0]?.status).toBe('OPEN');
    } finally {
      await app.close();
    }
  });
});
