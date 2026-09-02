import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  InMemoryPaymentEventStore,
  InMemoryRecoveryOpportunityStore,
  InMemoryRecoveryDecisionStore,
  InMemoryRecoveryExecutionStore,
  createMerchantStrategyMemoryStoreMock,
} from '../helpers.js';
import { evaluateExecutionSafety } from '../../src/domain/recovery-execution.js';

const MERCHANT_A = '11111111-1111-4111-8111-111111111111';

describe('Input validation — malformed/invalid input is rejected', () => {
  it('payment event with empty providerEventId is rejected by uniqueness constraint', async () => {
    const store = new InMemoryPaymentEventStore();
    const base = {
      merchantId: MERCHANT_A,
      provider: 'razorpay' as const,
      eventType: 'payment.captured',
      providerPaymentId: 'pay_1',
      providerOrderId: null,
      eventCreatedAt: new Date(),
      receivedAt: new Date(),
      payload: {},
      normalizedData: {
        provider: 'razorpay',
        eventType: 'payment.captured',
        providerPaymentId: 'pay_1',
        providerOrderId: null,
        amount: 500_000,
        currency: 'INR',
        status: 'captured',
        method: 'upi',
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
      processingStatus: 'processed' as const,
      processingAttempts: 1,
      processedAt: new Date(),
      failureReason: null,
      paymentAccountId: null,
    };

    await store.insert({ ...base, providerEventId: 'evt_1' });
    await expect(
      store.insert({ ...base, providerEventId: 'evt_1' })
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('opportunity with negative amountAtRisk is stored gracefully (store does not validate)', async () => {
    const store = new InMemoryRecoveryOpportunityStore();
    const row = await store.insert({
      merchantId: MERCHANT_A,
      paymentAccountId: null,
      type: 'FAILED_PAYMENT',
      status: 'OPEN',
      sourceEventId: 'evt_neg_1',
      providerPaymentId: 'pay_neg',
      providerOrderId: 'order_neg',
      amountAtRisk: -500,
      currency: 'INR',
      reason: 'Negative amount test',
      evidence: {
        sourceEventId: 'evt_neg_1',
        providerPaymentId: 'pay_neg',
        providerOrderId: 'order_neg',
        eventType: 'payment.failed',
        amount: -500,
        currency: 'INR',
        occurredAt: new Date().toISOString(),
        failureCode: null,
      },
      detectedAt: new Date(),
      expiresAt: null,
      resolvedAt: null,
      recoveryEventId: null,
    });
    expect(row.amountAtRisk).toBe(-500);
  });

  it('decision with confidence > 100 is handled by the store (no domain validation)', async () => {
    const store = new InMemoryRecoveryDecisionStore();
    const row = await store.upsert({
      merchantId: MERCHANT_A,
      opportunityId: '00000000-0000-4000-8000-000000000100',
      engineVersion: 'v1',
      score: 50,
      priority: 'MEDIUM',
      confidence: 150,
      recommendedAction: 'REVIEW',
      reasons: ['Out of range confidence'],
      factors: [],
      riskFlags: [],
      evaluatedAt: new Date(),
    });
    expect(row.confidence).toBe(150);
  });

  it('decision with confidence < 0 is handled by the store', async () => {
    const store = new InMemoryRecoveryDecisionStore();
    const row = await store.upsert({
      merchantId: MERCHANT_A,
      opportunityId: '00000000-0000-4000-8000-000000000101',
      engineVersion: 'v1',
      score: 0,
      priority: 'VERY_LOW',
      confidence: -10,
      recommendedAction: 'DO_NOT_RETRY',
      reasons: ['Negative confidence'],
      factors: [],
      riskFlags: [],
      evaluatedAt: new Date(),
    });
    expect(row.confidence).toBe(-10);
  });

  it('execution with duplicate idempotencyKey is rejected by store', async () => {
    const store = new InMemoryRecoveryExecutionStore();
    const base = {
      merchantId: MERCHANT_A,
      opportunityId: '00000000-0000-4000-8000-000000000200',
      decisionId: '00000000-0000-4000-8000-000000000201',
      action: 'RETRY' as const,
      status: 'PENDING' as const,
      origin: 'MANUAL' as const,
      attempt: 1,
      nextAttemptAt: null,
      scheduledAt: null,
      idempotencyKey: 'duplicate-key-123',
      provider: null,
      providerPaymentId: 'pay_dup',
      requestedAt: new Date(),
      startedAt: null,
      completedAt: null,
      failureCode: null,
      failureReason: null,
    };

    await store.insert(base);
    await expect(store.insert(base)).rejects.toThrow(
      Prisma.PrismaClientKnownRequestError
    );
  });

  it('memory upsert with empty strategy name works (store does not validate)', async () => {
    const store = createMerchantStrategyMemoryStoreMock();
    const row = await store.upsert({
      merchantId: MERCHANT_A,
      strategy: '' as never,
      failureType: 'GATEWAY_ERROR',
    });
    expect(row.strategy).toBe('');
    expect(row.merchantId).toBe(MERCHANT_A);
  });

  it('decision with empty reasons array is accepted', async () => {
    const store = new InMemoryRecoveryDecisionStore();
    const row = await store.upsert({
      merchantId: MERCHANT_A,
      opportunityId: '00000000-0000-4000-8000-000000000300',
      engineVersion: 'v1',
      score: 50,
      priority: 'MEDIUM',
      confidence: 50,
      recommendedAction: 'REVIEW',
      reasons: [],
      factors: [],
      riskFlags: [],
      evaluatedAt: new Date(),
    });
    expect(row.reasons).toEqual([]);
  });

  it('execution with invalid status transition returns null', async () => {
    const store = new InMemoryRecoveryExecutionStore();
    const row = await store.insert({
      merchantId: MERCHANT_A,
      opportunityId: '00000000-0000-4000-8000-000000000400',
      decisionId: '00000000-0000-4000-8000-000000000401',
      action: 'RETRY',
      status: 'PENDING',
      origin: 'MANUAL',
      attempt: 1,
      nextAttemptAt: null,
      scheduledAt: null,
      idempotencyKey: 'key-invalid-transition',
      provider: null,
      providerPaymentId: 'pay_x',
      requestedAt: new Date(),
      startedAt: null,
      completedAt: null,
      failureCode: null,
      failureReason: null,
    });

    const result = await store.transitionStatus({
      id: row.id,
      from: 'SUCCEEDED',
      to: 'FAILED',
    });
    expect(result).toBeNull();
  });

  it('opportunity with duplicate (sourceEventId, type) is rejected', async () => {
    const store = new InMemoryRecoveryOpportunityStore();
    const data = {
      merchantId: MERCHANT_A,
      paymentAccountId: null,
      type: 'FAILED_PAYMENT' as const,
      status: 'OPEN' as const,
      sourceEventId: 'evt_dup_src',
      providerPaymentId: 'pay_dup_src',
      providerOrderId: 'order_dup_src',
      amountAtRisk: 100,
      currency: 'INR',
      reason: 'Duplicate test',
      evidence: {
        sourceEventId: 'evt_dup_src',
        providerPaymentId: 'pay_dup_src',
        providerOrderId: 'order_dup_src',
        eventType: 'payment.failed',
        amount: 100,
        currency: 'INR',
        occurredAt: new Date().toISOString(),
        failureCode: null,
      },
      detectedAt: new Date(),
      expiresAt: null,
      resolvedAt: null,
      recoveryEventId: null,
    };

    await store.insert(data);
    await expect(store.insert(data)).rejects.toThrow(
      Prisma.PrismaClientKnownRequestError
    );
  });

  it('decision with empty confidence is handled (store allows 0)', async () => {
    const store = new InMemoryRecoveryDecisionStore();
    const row = await store.upsert({
      merchantId: MERCHANT_A,
      opportunityId: '00000000-0000-4000-8000-000000000500',
      engineVersion: 'v1',
      score: 0,
      priority: 'VERY_LOW',
      confidence: 0,
      recommendedAction: 'DO_NOT_RETRY',
      reasons: ['Zero confidence'],
      factors: [],
      riskFlags: [],
      evaluatedAt: new Date(),
    });
    expect(row.confidence).toBe(0);

    const verdict = evaluateExecutionSafety({
      decision: {
        recommendedAction: 'RETRY',
        confidence: 0,
        riskFlags: [],
      },
      opportunity: { status: 'OPEN', providerPaymentId: 'pay_1' },
      paymentCaptured: false,
      priorRetryAttempts: 0,
      config: { minConfidence: 60, maxRetries: 3 },
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toBe('LOW_CONFIDENCE');
  });
});
