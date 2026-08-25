import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type {
  OpportunityDetailResponse,
  OpportunityListResponse,
  OpportunitiesOverviewResponse,
} from '../../src/routes/opportunities.js';
import type {
  NormalizedPaymentEventData,
  PaymentEventRow,
} from '../../src/domain/payment-event.js';
import {
  createDbExecutorMock,
  InMemoryPaymentEventStore,
  InMemoryRecoveryOpportunityStore,
  makeTestEnv,
} from '../helpers.js';
import type { RecoveryOpportunityRow } from '../../src/domain/recovery-opportunity.js';

const MERCHANT_1 = '11111111-1111-4111-8111-111111111111';
const MERCHANT_2 = '22222222-2222-4222-8222-222222222222';

function makeStores() {
  const paymentEvent = new InMemoryPaymentEventStore();
  const recoveryOpportunity = new InMemoryRecoveryOpportunityStore();
  return { paymentEvent, recoveryOpportunity };
}

async function seedOpp(
  store: InMemoryRecoveryOpportunityStore,
  overrides: Partial<RecoveryOpportunityRow> = {}
): Promise<RecoveryOpportunityRow> {
  return store.insert({
    type: overrides.type ?? 'FAILED_PAYMENT',
    status: overrides.status ?? 'OPEN',
    amountAtRisk: overrides.amountAtRisk ?? 249900,
    currency: overrides.currency ?? 'INR',
    reason: overrides.reason ?? 'Test reason',
    evidence: overrides.evidence ?? {},
    merchantId: overrides.merchantId ?? null,
    paymentAccountId: overrides.paymentAccountId ?? null,
    providerPaymentId: overrides.providerPaymentId ?? 'pay_sample',
    providerOrderId: overrides.providerOrderId ?? 'order_sample',
    sourceEventId: overrides.sourceEventId ?? randomUUID(),
    detectedAt: overrides.detectedAt ?? new Date(),
    expiresAt: overrides.expiresAt ?? null,
    resolvedAt: overrides.resolvedAt ?? null,
    recoveryEventId: overrides.recoveryEventId ?? null,
  });
}

async function seedFailedEvent(
  store: InMemoryPaymentEventStore,
  overrides: Partial<PaymentEventRow> = {}
): Promise<PaymentEventRow> {
  const eventType = overrides.eventType ?? 'payment.failed';
  const normalized: NormalizedPaymentEventData = {
    provider: 'razorpay',
    eventType,
    providerPaymentId: overrides.providerPaymentId ?? 'pay_failed_1',
    providerOrderId: overrides.providerOrderId ?? 'order_failed_1',
    amount: 249900,
    currency: 'INR',
    status: 'failed',
    method: 'upi',
    email: null,
    contact: null,
    bank: null,
    errorCode: 'PAYMENT_DECLINED',
    errorDescription: null,
    errorSource: null,
    errorStep: null,
    errorReason: null,
    subscriptionId: null,
    paymentCreatedAt: null,
    occurredAt: new Date().toISOString(),
  };
  return store.insert({
    provider: 'razorpay',
    providerEventId: overrides.providerEventId ?? `${eventType}:${normalized.providerPaymentId}`,
    eventType,
    merchantId: overrides.merchantId ?? null,
    paymentAccountId: overrides.paymentAccountId ?? null,
    providerPaymentId: normalized.providerPaymentId,
    providerOrderId: normalized.providerOrderId,
    eventCreatedAt: overrides.eventCreatedAt ?? new Date(),
    receivedAt: new Date(),
    payload: {},
    normalizedData: normalized,
    signatureVerified: true,
    processingStatus: 'processed',
    processingAttempts: 1,
    processedAt: new Date(),
    failureReason: null,
  });
}

describe('GET /opportunities', () => {
  it('returns empty results when no opportunities exist', async () => {
    const stores = makeStores();
    const db = createDbExecutorMock(undefined, stores);
    const app = await buildApp({ env: makeTestEnv(), db });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/opportunities' });
    expect(res.statusCode).toBe(200);
    expect(res.json<OpportunityListResponse>()).toEqual({ opportunities: [], total: 0 });

    await app.close();
  });

  it('lists opportunities with their fields mapped', async () => {
    const stores = makeStores();
    const opp = await seedOpp(stores.recoveryOpportunity);

    const db = createDbExecutorMock(undefined, stores);
    const app = await buildApp({ env: makeTestEnv(), db });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/opportunities' });
    expect(res.statusCode).toBe(200);
    const body = res.json<OpportunityListResponse>();
    expect(body.total).toBe(1);
    const listed = body.opportunities[0];
    expect(listed?.id).toBe(opp.id);
    expect(listed?.type).toBe('FAILED_PAYMENT');
    expect(listed?.amountAtRisk).toBe(249900);

    await app.close();
  });

  it('filters by merchantId and status', async () => {
    const stores = makeStores();
    await seedOpp(stores.recoveryOpportunity, { merchantId: MERCHANT_1, status: 'OPEN' });
    await seedOpp(stores.recoveryOpportunity, { merchantId: MERCHANT_1, status: 'RECOVERED' });
    await seedOpp(stores.recoveryOpportunity, { merchantId: MERCHANT_2, status: 'OPEN' });

    const db = createDbExecutorMock(undefined, stores);
    const app = await buildApp({ env: makeTestEnv(), db });
    await app.ready();

    const byMerchant = await app.inject({
      method: 'GET',
      url: `/opportunities?merchantId=${MERCHANT_1}`,
    });
    expect(byMerchant.statusCode).toBe(200);
    expect(byMerchant.json<OpportunityListResponse>().opportunities).toHaveLength(2);

    const byStatus = await app.inject({ method: 'GET', url: '/opportunities?status=OPEN' });
    expect(byStatus.json<OpportunityListResponse>().opportunities).toHaveLength(2);

    const combined = await app.inject({
      method: 'GET',
      url: `/opportunities?merchantId=${MERCHANT_1}&status=RECOVERED`,
    });
    expect(combined.json<OpportunityListResponse>().total).toBe(1);

    await app.close();
  });

  it('rejects unknown query parameters with 422', async () => {
    const stores = makeStores();
    const db = createDbExecutorMock(undefined, stores);
    const app = await buildApp({ env: makeTestEnv(), db });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/opportunities?invalidParam=abc' });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it('rejects a non-uuid merchantId with 422', async () => {
    const stores = makeStores();
    const db = createDbExecutorMock(undefined, stores);
    const app = await buildApp({ env: makeTestEnv(), db });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/opportunities?merchantId=m_1' });
    expect(res.statusCode).toBe(422);

    await app.close();
  });
});

describe('GET /opportunities/:id', () => {
  it('returns the opportunity with a sourceEvent summary', async () => {
    const stores = makeStores();
    const event = await seedFailedEvent(stores.paymentEvent);
    const opp = await seedOpp(stores.recoveryOpportunity, { sourceEventId: event.id });

    const db = createDbExecutorMock(undefined, stores);
    const app = await buildApp({ env: makeTestEnv(), db });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: `/opportunities/${opp.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json<OpportunityDetailResponse>();
    expect(body.id).toBe(opp.id);
    expect(body.sourceEvent?.id).toBe(event.id);
    expect(body.sourceEvent?.eventType).toBe('payment.failed');
    expect(body.sourceEvent?.amount).toBe(249900);
    expect(body.evidence).toBeDefined();

    await app.close();
  });

  it('omits the sourceEvent summary when the event cannot be found', async () => {
    const stores = makeStores();
    const opp = await seedOpp(stores.recoveryOpportunity, { sourceEventId: randomUUID() });

    const db = createDbExecutorMock(undefined, stores);
    const app = await buildApp({ env: makeTestEnv(), db });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: `/opportunities/${opp.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<OpportunityDetailResponse>().sourceEvent).toBeNull();

    await app.close();
  });

  it('returns 404 for an unknown id', async () => {
    const stores = makeStores();
    const db = createDbExecutorMock(undefined, stores);
    const app = await buildApp({ env: makeTestEnv(), db });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/opportunities/nonexistent' });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});

describe('GET /opportunities/overview', () => {
  it('returns openOpportunities, failedPayments and per-currency breakdown', async () => {
    const stores = makeStores();
    await seedOpp(stores.recoveryOpportunity, {
      status: 'OPEN',
      amountAtRisk: 249900,
      currency: 'INR',
    });
    await seedOpp(stores.recoveryOpportunity, {
      status: 'RECOVERED',
      amountAtRisk: 99900,
      currency: 'INR',
      recoveryEventId: randomUUID(),
      resolvedAt: new Date(),
    });
    await seedOpp(stores.recoveryOpportunity, {
      status: 'OPEN',
      amountAtRisk: 5000,
      currency: 'USD',
    });

    const db = createDbExecutorMock(undefined, stores);
    const app = await buildApp({ env: makeTestEnv(), db });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/opportunities/overview' });
    expect(res.statusCode).toBe(200);
    const body = res.json<OpportunitiesOverviewResponse>();
    expect(body.openOpportunities).toBe(2);
    expect(body.failedPayments).toBe(3);
    expect(body.currencies).toHaveLength(2);
    const inr = body.currencies.find((c) => c.currency === 'INR');
    expect(inr?.revenueAtRisk).toBe(249900);
    expect(inr?.recoveredAmount).toBe(99900);
    const usd = body.currencies.find((c) => c.currency === 'USD');
    expect(usd?.revenueAtRisk).toBe(5000);
    expect(usd?.recoveredAmount).toBe(0);

    await app.close();
  });

  it('honors the merchantId scoping on the overview', async () => {
    const stores = makeStores();
    await seedOpp(stores.recoveryOpportunity, { merchantId: MERCHANT_1 });
    await seedOpp(stores.recoveryOpportunity, { merchantId: MERCHANT_2 });

    const db = createDbExecutorMock(undefined, stores);
    const app = await buildApp({ env: makeTestEnv(), db });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: `/opportunities/overview?merchantId=${MERCHANT_1}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<OpportunitiesOverviewResponse>();
    expect(body.openOpportunities).toBe(1);
    expect(body.failedPayments).toBe(1);

    await app.close();
  });
});
