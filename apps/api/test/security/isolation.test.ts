import { describe, it, expect } from 'vitest';
import {
  InMemoryRecoveryOpportunityStore,
  InMemoryRecoveryExecutionStore,
  InMemoryRecoveryDecisionStore,
  createMerchantStrategyMemoryStoreMock,
} from '../helpers.js';

const MERCHANT_A = '11111111-1111-4111-8111-111111111111';
const MERCHANT_B = '22222222-2222-4222-8222-222222222222';

async function seedOpportunity(
  store: InMemoryRecoveryOpportunityStore,
  merchantId: string,
  sourceEventId: string
) {
  return store.insert({
    merchantId,
    paymentAccountId: null,
    type: 'FAILED_PAYMENT',
    status: 'OPEN',
    sourceEventId,
    providerPaymentId: `pay_${sourceEventId}`,
    providerOrderId: `order_${sourceEventId}`,
    amountAtRisk: 500_000,
    currency: 'INR',
    reason: 'Payment failed',
    evidence: {
      sourceEventId,
      providerPaymentId: `pay_${sourceEventId}`,
      providerOrderId: `order_${sourceEventId}`,
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

describe('Data isolation — cross-merchant boundary', () => {
  it('opportunities for merchant A do not appear when querying merchant B', async () => {
    const store = new InMemoryRecoveryOpportunityStore();
    await seedOpportunity(store, MERCHANT_A, 'evt_iso_1');
    await seedOpportunity(store, MERCHANT_A, 'evt_iso_2');
    await seedOpportunity(store, MERCHANT_B, 'evt_iso_3');

    const aOpps = await store.list({ merchantId: MERCHANT_A });
    const bOpps = await store.list({ merchantId: MERCHANT_B });

    expect(aOpps).toHaveLength(2);
    expect(bOpps).toHaveLength(1);
    expect(aOpps.every((o) => o.merchantId === MERCHANT_A)).toBe(true);
    expect(bOpps.every((o) => o.merchantId === MERCHANT_B)).toBe(true);
  });

  it('executions for merchant A do not appear when querying merchant B', async () => {
    const store = new InMemoryRecoveryExecutionStore();
    await store.insert({
      merchantId: MERCHANT_A,
      opportunityId: 'opp_a',
      decisionId: 'dec_a',
      action: 'RETRY',
      status: 'PENDING',
      origin: 'MANUAL',
      attempt: 1,
      nextAttemptAt: null,
      scheduledAt: null,
      idempotencyKey: 'key-iso-a1',
      provider: null,
      providerPaymentId: 'pay_a',
      requestedAt: new Date(),
      startedAt: null,
      completedAt: null,
      failureCode: null,
      failureReason: null,
    });
    await store.insert({
      merchantId: MERCHANT_B,
      opportunityId: 'opp_b',
      decisionId: 'dec_b',
      action: 'RETRY',
      status: 'PENDING',
      origin: 'MANUAL',
      attempt: 1,
      nextAttemptAt: null,
      scheduledAt: null,
      idempotencyKey: 'key-iso-b1',
      provider: null,
      providerPaymentId: 'pay_b',
      requestedAt: new Date(),
      startedAt: null,
      completedAt: null,
      failureCode: null,
      failureReason: null,
    });

    const aExecs = await store.listAll({ merchantId: MERCHANT_A });
    const bExecs = await store.listAll({ merchantId: MERCHANT_B });

    expect(aExecs).toHaveLength(1);
    expect(bExecs).toHaveLength(1);
    expect(aExecs[0]!.merchantId).toBe(MERCHANT_A);
    expect(bExecs[0]!.merchantId).toBe(MERCHANT_B);
  });

  it('decisions for merchant A do not appear when querying merchant B', async () => {
    const store = new InMemoryRecoveryDecisionStore();
    await store.upsert({
      merchantId: MERCHANT_A,
      opportunityId: '00000000-0000-4000-8000-000000000601',
      engineVersion: 'v1',
      score: 70,
      priority: 'HIGH',
      confidence: 75,
      recommendedAction: 'RETRY',
      reasons: ['Test'],
      factors: [],
      riskFlags: [],
      evaluatedAt: new Date(),
    });
    await store.upsert({
      merchantId: MERCHANT_B,
      opportunityId: '00000000-0000-4000-8000-000000000602',
      engineVersion: 'v1',
      score: 30,
      priority: 'LOW',
      confidence: 40,
      recommendedAction: 'REVIEW',
      reasons: ['Test'],
      factors: [],
      riskFlags: [],
      evaluatedAt: new Date(),
    });

    const aDecisions = await store.listAll({ merchantId: MERCHANT_A });
    const bDecisions = await store.listAll({ merchantId: MERCHANT_B });

    expect(aDecisions).toHaveLength(1);
    expect(bDecisions).toHaveLength(1);
    expect(aDecisions[0]!.merchantId).toBe(MERCHANT_A);
    expect(bDecisions[0]!.merchantId).toBe(MERCHANT_B);
  });

  it('memory for merchant A does not appear when querying merchant B', async () => {
    const store = createMerchantStrategyMemoryStoreMock();
    await store.upsert({
      merchantId: MERCHANT_A,
      strategy: 'RETRY',
      failureType: 'GATEWAY_ERROR',
    });
    await store.upsert({
      merchantId: MERCHANT_B,
      strategy: 'RETRY',
      failureType: 'GATEWAY_ERROR',
    });

    const aMemory = await store.listByMerchant(MERCHANT_A);
    const bMemory = await store.listByMerchant(MERCHANT_B);

    expect(aMemory).toHaveLength(1);
    expect(bMemory).toHaveLength(1);
    expect(aMemory[0]!.merchantId).toBe(MERCHANT_A);
    expect(bMemory[0]!.merchantId).toBe(MERCHANT_B);
  });

  it('simulation data (simulationId set) is distinguishable from live data', async () => {
    const store = new InMemoryRecoveryOpportunityStore();
    await seedOpportunity(store, MERCHANT_A, 'evt_sim_1');
    await store.insert({
      merchantId: MERCHANT_A,
      paymentAccountId: null,
      type: 'FAILED_PAYMENT',
      status: 'OPEN',
      sourceEventId: 'evt_live_1',
      providerPaymentId: 'pay_live_1',
      providerOrderId: 'order_live_1',
      amountAtRisk: 100_000,
      currency: 'INR',
      reason: 'Live failure',
      evidence: {
        sourceEventId: 'evt_live_1',
        providerPaymentId: 'pay_live_1',
        providerOrderId: 'order_live_1',
        eventType: 'payment.failed',
        amount: 100_000,
        currency: 'INR',
        occurredAt: new Date().toISOString(),
        failureCode: 'GATEWAY_ERROR',
      },
      detectedAt: new Date(),
      expiresAt: null,
      resolvedAt: null,
      recoveryEventId: null,
    });

    const allOpps = await store.list({ merchantId: MERCHANT_A });
    expect(allOpps).toHaveLength(2);

    const simOpps = allOpps.filter((o) => o.evidence && (o.evidence as Record<string, unknown>).simulationId);
    const liveOpps = allOpps.filter((o) => !o.evidence || !(o.evidence as Record<string, unknown>).simulationId);
    expect(liveOpps).toHaveLength(2);
    expect(simOpps).toHaveLength(0);
  });

  it('markRecovered on opportunity A does not affect opportunity B', async () => {
    const store = new InMemoryRecoveryOpportunityStore();
    const oppA = await seedOpportunity(store, MERCHANT_A, 'evt_mr_a');
    const oppB = await seedOpportunity(store, MERCHANT_A, 'evt_mr_b');

    await store.markRecovered({
      id: oppA.id,
      recoveryEventId: 'recovery_evt_1',
      resolvedAt: new Date(),
    });

    const updatedA = await store.findById(oppA.id);
    const updatedB = await store.findById(oppB.id);

    expect(updatedA!.status).toBe('RECOVERED');
    expect(updatedA!.recoveryEventId).toBe('recovery_evt_1');
    expect(updatedB!.status).toBe('OPEN');
    expect(updatedB!.recoveryEventId).toBeNull();
  });

  it('strategy memory is scoped per merchant — different merchants have independent memories', async () => {
    const store = createMerchantStrategyMemoryStoreMock();
    await store.upsert({
      merchantId: MERCHANT_A,
      strategy: 'RETRY',
      failureType: 'GATEWAY_ERROR',
    });
    await store.upsert({
      merchantId: MERCHANT_B,
      strategy: 'PAYMENT_LINK',
      failureType: 'GATEWAY_ERROR',
    });

    const aStrategies = await store.listByMerchant(MERCHANT_A);
    const bStrategies = await store.listByMerchant(MERCHANT_B);

    expect(aStrategies).toHaveLength(1);
    expect(aStrategies[0]!.strategy).toBe('RETRY');
    expect(bStrategies).toHaveLength(1);
    expect(bStrategies[0]!.strategy).toBe('PAYMENT_LINK');

    const aOverview = await store.getOverview(MERCHANT_A);
    const bOverview = await store.getOverview(MERCHANT_B);

    expect(aOverview.strategies).toHaveLength(1);
    expect(bOverview.strategies).toHaveLength(1);
    expect(aOverview.strategies[0]!.strategy).toBe('RETRY');
    expect(bOverview.strategies[0]!.strategy).toBe('PAYMENT_LINK');
  });
});
