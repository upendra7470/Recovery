import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  InMemoryPaymentEventStore,
  InMemoryRecoveryOpportunityStore,
  InMemoryRecoveryDecisionStore,
  InMemoryRecoveryAIAdviceStore,
} from '../helpers.js';

function makeEvent(overrides: { providerEventId?: string; provider?: string } = {}) {
  return {
    paymentAccountId: null as string | null,
    merchantId: null as string | null,
    provider: (overrides.provider ?? 'razorpay') as 'razorpay',
    providerEventId: overrides.providerEventId ?? 'evt_dup_1',
    eventType: 'payment.failed',
    providerPaymentId: 'pay_dup_1',
    providerOrderId: null as string | null,
    eventCreatedAt: new Date(),
    receivedAt: new Date(),
    payload: {},
    normalizedData: {
      provider: 'razorpay',
      eventType: 'payment.failed',
      providerPaymentId: 'pay_dup_1',
      providerOrderId: null,
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
    processingStatus: 'processed' as const,
    processingAttempts: 1,
    processedAt: new Date(),
    failureReason: null as string | null,
  };
}

function makeOpportunity(overrides: { sourceEventId?: string; type?: string } = {}) {
  return {
    merchantId: null as string | null,
    paymentAccountId: null as string | null,
    type: (overrides.type ?? 'FAILED_PAYMENT') as 'FAILED_PAYMENT',
    status: 'OPEN' as const,
    sourceEventId: overrides.sourceEventId ?? 'src_dup_1',
    providerPaymentId: 'pay_dup_1',
    providerOrderId: null as string | null,
    amountAtRisk: 50000,
    currency: 'INR',
    reason: 'Test failure',
    evidence: { sourceEventId: 'evt_1', providerPaymentId: 'pay_dup_1', providerOrderId: null, eventType: 'payment.failed', amount: 50000, currency: 'INR', occurredAt: new Date().toISOString(), failureCode: 'GATEWAY_ERROR' },
    recoveryEventId: null as string | null,
    detectedAt: new Date(),
    expiresAt: null as Date | null,
    resolvedAt: null as Date | null,
  };
}

describe('duplicate event handling', () => {
  it('rejects duplicate payment events with P2002', async () => {
    const store = new InMemoryPaymentEventStore();
    await store.insert(makeEvent());

    await expect(store.insert(makeEvent())).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    try {
      await store.insert(makeEvent());
    } catch (error) {
      expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
    }
  });

  it('rejects duplicate opportunity creation with P2002 and the existing record is findable', async () => {
    const store = new InMemoryRecoveryOpportunityStore();
    const existing = await store.insert(makeOpportunity());

    await expect(store.insert(makeOpportunity())).rejects.toThrow(Prisma.PrismaClientKnownRequestError);

    const found = await store.findBySourceEventAndType(
      existing.sourceEventId,
      existing.type,
    );
    expect(found?.id).toBe(existing.id);
  });

  it('upserts decision on duplicate (opportunityId, engineVersion) instead of creating a new row', async () => {
    const store = new InMemoryRecoveryDecisionStore();
    const data = {
      merchantId: null as string | null,
      opportunityId: 'opp_decision_1',
      engineVersion: 'v1',
      score: 60,
      priority: 'HIGH' as const,
      confidence: 80,
      recommendedAction: 'RETRY' as const,
      reasons: ['first evaluation'],
      factors: [],
      riskFlags: [],
      evaluatedAt: new Date(),
    };

    const first = await store.upsert(data);
    const second = await store.upsert({ ...data, score: 75, reasons: ['updated'] });

    expect(first.id).toBe(second.id);
    expect(store.rows.size).toBe(1);
    expect(second.score).toBe(75);
    expect(second.reasons).toEqual(['updated']);
  });

  it('upserts advice on duplicate (decisionId, advisorVersion, model)', async () => {
    const store = new InMemoryRecoveryAIAdviceStore();
    const data = {
      merchantId: null as string | null,
      opportunityId: 'opp_1',
      decisionId: 'dec_1',
      provider: 'fake',
      model: 'fake-model',
      advisorVersion: 'v1',
      promptVersion: 'v1',
      status: 'AVAILABLE' as const,
      summary: 'initial',
      explanation: 'initial explanation text here',
      nextStep: 'step one',
      customerMessage: null as string | null,
      operatorMessage: null as string | null,
      confidence: 70,
      warnings: [] as string[],
      safetyConstrained: false,
      decisionFingerprint: 'fp1',
    };

    const first = await store.upsert(data);
    const second = await store.upsert({ ...data, summary: 'updated', confidence: 90 });

    expect(first.id).toBe(second.id);
    expect(store.rows.size).toBe(1);
    expect(second.summary).toBe('updated');
    expect(second.confidence).toBe(90);
  });

  it('same event creates only one opportunity — the second insert is rejected', async () => {
    const store = new InMemoryRecoveryOpportunityStore();
    await store.insert(makeOpportunity({ sourceEventId: 'evt_single', type: 'FAILED_PAYMENT' }));

    await expect(
      store.insert(makeOpportunity({ sourceEventId: 'evt_single', type: 'FAILED_PAYMENT' })),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);

    const all = await store.list({});
    expect(all.length).toBe(1);
  });

  it('findByProviderEventId returns the existing event after a duplicate insert attempt', async () => {
    const store = new InMemoryPaymentEventStore();
    const original = await store.insert(makeEvent({ providerEventId: 'evt_idem_1' }));

    try {
      await store.insert(makeEvent({ providerEventId: 'evt_idem_1' }));
    } catch {
      // expected P2002
    }

    const found = await store.findByProviderEventId('razorpay', 'evt_idem_1');
    expect(found?.id).toBe(original.id);
    expect(store.rows.size).toBe(1);
  });
});
