import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryPaymentEventStore,
  InMemoryRecoveryOpportunityStore,
  InMemoryRecoveryDecisionStore,
  InMemoryRecoveryExecutionStore,
  createMerchantStrategyMemoryStoreMock,
  createSimulationRunStoreMock,
  createDbExecutorMock,
} from '../helpers.js';
import { MerchantMemoryService } from '../../src/services/merchant-memory.service.js';
import { SimulationAnalyticsService } from '../../src/services/simulation-analytics.service.js';
import type { MerchantStrategyMemoryStore } from '../../src/domain/merchant-memory.js';
import type { NormalizedPaymentEventData } from '../../src/domain/payment-event.js';

const MERCHANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MERCHANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makeNormalizedData(overrides: Partial<NormalizedPaymentEventData> = {}): NormalizedPaymentEventData {
  return {
    provider: 'razorpay',
    eventType: 'payment.failed',
    providerPaymentId: 'pay_1',
    providerOrderId: 'order_1',
    amount: 100,
    currency: 'INR',
    status: 'failed',
    method: 'card',
    email: null,
    contact: null,
    bank: null,
    errorCode: 'GATEWAY_ERROR',
    errorDescription: 'Test error',
    errorSource: 'bank',
    errorStep: 'payment_authorization',
    errorReason: 'temporary',
    subscriptionId: null,
    paymentCreatedAt: null,
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Merchant isolation', () => {
  // -----------------------------------------------------------------------
  // 1. Payment events scoped per merchant
  // -----------------------------------------------------------------------
  describe('Payment events are scoped per merchant', () => {
    let store: InMemoryPaymentEventStore;

    beforeEach(() => {
      store = new InMemoryPaymentEventStore();
    });

    it('inserts events for both merchants and returns correct event by id', async () => {
      // Arrange
      const eventA = await store.insert({
        merchantId: MERCHANT_A,
        paymentAccountId: null,
        provider: 'razorpay',
        providerEventId: 'pay_evt_a1',
        eventType: 'payment.failed',
        providerPaymentId: 'pay_a1',
        providerOrderId: 'order_a1',
        eventCreatedAt: new Date('2025-01-01T10:00:00Z'),
        receivedAt: new Date('2025-01-01T10:00:01Z'),
        payload: {},
        normalizedData: makeNormalizedData(),
        signatureVerified: true,
        processingStatus: 'processed',
        processingAttempts: 1,
        processedAt: new Date('2025-01-01T10:00:02Z'),
        failureReason: null,
      });

      const eventB = await store.insert({
        merchantId: MERCHANT_B,
        paymentAccountId: null,
        provider: 'razorpay',
        providerEventId: 'pay_evt_b1',
        eventType: 'payment.failed',
        providerPaymentId: 'pay_b1',
        providerOrderId: 'order_b1',
        eventCreatedAt: new Date('2025-01-01T10:00:00Z'),
        receivedAt: new Date('2025-01-01T10:00:01Z'),
        payload: {},
        normalizedData: makeNormalizedData(),
        signatureVerified: true,
        processingStatus: 'processed',
        processingAttempts: 1,
        processedAt: new Date('2025-01-01T10:00:02Z'),
        failureReason: null,
      });

      // Act
      const fetchedA = await store.findById(eventA.id);
      const fetchedB = await store.findById(eventB.id);

      // Assert
      expect(fetchedA).not.toBeNull();
      expect(fetchedB).not.toBeNull();
      expect(fetchedA!.merchantId).toBe(MERCHANT_A);
      expect(fetchedB!.merchantId).toBe(MERCHANT_B);
    });

    it('findRelatedByOrderOrPayment only returns events matching the payment identity', async () => {
      // Arrange
      await store.insert({
        merchantId: MERCHANT_A,
        paymentAccountId: null,
        provider: 'razorpay',
        providerEventId: 'pay_evt_a1',
        eventType: 'payment.failed',
        providerPaymentId: 'pay_shared',
        providerOrderId: null,
        eventCreatedAt: new Date('2025-01-01T10:00:00Z'),
        receivedAt: new Date('2025-01-01T10:00:01Z'),
        payload: {},
        normalizedData: makeNormalizedData(),
        signatureVerified: true,
        processingStatus: 'processed',
        processingAttempts: 1,
        processedAt: new Date(),
        failureReason: null,
      });

      await store.insert({
        merchantId: MERCHANT_B,
        paymentAccountId: null,
        provider: 'razorpay',
        providerEventId: 'pay_evt_b1',
        eventType: 'payment.failed',
        providerPaymentId: 'pay_other',
        providerOrderId: null,
        eventCreatedAt: new Date('2025-01-01T10:00:00Z'),
        receivedAt: new Date('2025-01-01T10:00:01Z'),
        payload: {},
        normalizedData: makeNormalizedData(),
        signatureVerified: true,
        processingStatus: 'processed',
        processingAttempts: 1,
        processedAt: new Date(),
        failureReason: null,
      });

      // Act
      const related = await store.findRelatedByOrderOrPayment({
        providerPaymentId: 'pay_shared',
        providerOrderId: null,
        occurredAfter: new Date('2025-01-01T00:00:00Z'),
        occurredBefore: new Date('2025-01-02T00:00:00Z'),
      });

      // Assert — only the event with matching providerPaymentId is returned
      expect(related).toHaveLength(1);
      expect(related[0]!.providerPaymentId).toBe('pay_shared');
      expect(related[0]!.merchantId).toBe(MERCHANT_A);
    });

    it('findByProviderEventId returns only the event with the matching composite key', async () => {
      // Arrange
      await store.insert({
        merchantId: MERCHANT_A,
        paymentAccountId: null,
        provider: 'razorpay',
        providerEventId: 'evt_a_unique',
        eventType: 'payment.failed',
        providerPaymentId: 'pay_a1',
        providerOrderId: null,
        eventCreatedAt: new Date(),
        receivedAt: new Date(),
        payload: {},
        normalizedData: makeNormalizedData(),
        signatureVerified: true,
        processingStatus: 'processed',
        processingAttempts: 1,
        processedAt: new Date(),
        failureReason: null,
      });

      await store.insert({
        merchantId: MERCHANT_B,
        paymentAccountId: null,
        provider: 'razorpay',
        providerEventId: 'evt_b_unique',
        eventType: 'payment.failed',
        providerPaymentId: 'pay_b1',
        providerOrderId: null,
        eventCreatedAt: new Date(),
        receivedAt: new Date(),
        payload: {},
        normalizedData: makeNormalizedData(),
        signatureVerified: true,
        processingStatus: 'processed',
        processingAttempts: 1,
        processedAt: new Date(),
        failureReason: null,
      });

      // Act
      const foundA = await store.findByProviderEventId('razorpay', 'evt_a_unique');
      const foundB = await store.findByProviderEventId('razorpay', 'evt_b_unique');

      // Assert
      expect(foundA).not.toBeNull();
      expect(foundA!.merchantId).toBe(MERCHANT_A);
      expect(foundB).not.toBeNull();
      expect(foundB!.merchantId).toBe(MERCHANT_B);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Opportunities scoped per merchant
  // -----------------------------------------------------------------------
  describe('Opportunities are scoped per merchant', () => {
    let store: InMemoryRecoveryOpportunityStore;

    beforeEach(() => {
      store = new InMemoryRecoveryOpportunityStore();
    });

    async function seedOpp(merchantId: string, sourceEventId: string) {
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

    it('list with merchantId filter returns only that merchant opportunities', async () => {
      // Arrange
      await seedOpp(MERCHANT_A, 'evt_a1');
      await seedOpp(MERCHANT_A, 'evt_a2');
      await seedOpp(MERCHANT_B, 'evt_b1');

      // Act
      const listA = await store.list({ merchantId: MERCHANT_A });
      const listB = await store.list({ merchantId: MERCHANT_B });

      // Assert
      expect(listA).toHaveLength(2);
      expect(listB).toHaveLength(1);
      expect(listA.every((o) => o.merchantId === MERCHANT_A)).toBe(true);
      expect(listB.every((o) => o.merchantId === MERCHANT_B)).toBe(true);
    });

    it('count with merchantId filter returns correct count', async () => {
      // Arrange
      await seedOpp(MERCHANT_A, 'evt_a1');
      await seedOpp(MERCHANT_A, 'evt_a2');
      await seedOpp(MERCHANT_A, 'evt_a3');
      await seedOpp(MERCHANT_B, 'evt_b1');

      // Act
      const countA = await store.count({ merchantId: MERCHANT_A });
      const countB = await store.count({ merchantId: MERCHANT_B });

      // Assert
      expect(countA).toBe(3);
      expect(countB).toBe(1);
    });

    it('countByType with merchantId filter scopes correctly', async () => {
      // Arrange
      await store.insert({
        merchantId: MERCHANT_A,
        paymentAccountId: null,
        type: 'SUBSCRIPTION_PAYMENT_FAILED',
        status: 'OPEN',
        sourceEventId: 'evt_sub_a',
        providerPaymentId: 'pay_sub_a',
        providerOrderId: null,
        amountAtRisk: 100_000,
        currency: 'INR',
        reason: 'Subscription failed',
        evidence: {},
        detectedAt: new Date(),
        expiresAt: null,
        resolvedAt: null,
        recoveryEventId: null,
      });
      await seedOpp(MERCHANT_A, 'evt_fp_a');
      await store.insert({
        merchantId: MERCHANT_B,
        paymentAccountId: null,
        type: 'SUBSCRIPTION_PAYMENT_FAILED',
        status: 'OPEN',
        sourceEventId: 'evt_sub_b',
        providerPaymentId: 'pay_sub_b',
        providerOrderId: null,
        amountAtRisk: 200_000,
        currency: 'INR',
        reason: 'Subscription failed',
        evidence: {},
        detectedAt: new Date(),
        expiresAt: null,
        resolvedAt: null,
        recoveryEventId: null,
      });

      // Act
      const subCountA = await store.countByType('SUBSCRIPTION_PAYMENT_FAILED', MERCHANT_A);
      const subCountB = await store.countByType('SUBSCRIPTION_PAYMENT_FAILED', MERCHANT_B);
      const fpCountA = await store.countByType('FAILED_PAYMENT', MERCHANT_A);

      // Assert
      expect(subCountA).toBe(1);
      expect(subCountB).toBe(1);
      expect(fpCountA).toBe(1);
    });

    it('summarizeByStatusAndCurrency scopes to merchant', async () => {
      // Arrange
      await seedOpp(MERCHANT_A, 'evt_a1');
      await seedOpp(MERCHANT_B, 'evt_b1');

      // Act
      const summaryA = await store.summarizeByStatusAndCurrency(MERCHANT_A);
      const summaryB = await store.summarizeByStatusAndCurrency(MERCHANT_B);

      // Assert
      expect(summaryA).toHaveLength(1);
      expect(summaryA[0]!.count).toBe(1);
      expect(summaryB).toHaveLength(1);
      expect(summaryB[0]!.count).toBe(1);

      // Verify amounts are independent
      expect(summaryA[0]!.totalAmountAtRisk).toBe(500_000);
      expect(summaryB[0]!.totalAmountAtRisk).toBe(500_000);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Decisions scoped per merchant
  // -----------------------------------------------------------------------
  describe('Decisions are scoped per merchant', () => {
    let store: InMemoryRecoveryDecisionStore;

    beforeEach(() => {
      store = new InMemoryRecoveryDecisionStore();
    });

    it('listAll with merchantId filter returns only that merchant decisions', async () => {
      // Arrange
      await store.upsert({
        merchantId: MERCHANT_A,
        opportunityId: '00000000-0000-4000-8000-000000000101',
        engineVersion: 'v1',
        score: 80,
        priority: 'HIGH',
        confidence: 85,
        recommendedAction: 'RETRY',
        reasons: ['Transient failure'],
        factors: [],
        riskFlags: [],
        evaluatedAt: new Date('2025-01-01T10:00:00Z'),
      });
      await store.upsert({
        merchantId: MERCHANT_A,
        opportunityId: '00000000-0000-4000-8000-000000000102',
        engineVersion: 'v1',
        score: 30,
        priority: 'LOW',
        confidence: 40,
        recommendedAction: 'REVIEW',
        reasons: ['Low confidence'],
        factors: [],
        riskFlags: [],
        evaluatedAt: new Date('2025-01-01T10:01:00Z'),
      });
      await store.upsert({
        merchantId: MERCHANT_B,
        opportunityId: '00000000-0000-4000-8000-000000000201',
        engineVersion: 'v1',
        score: 60,
        priority: 'MEDIUM',
        confidence: 70,
        recommendedAction: 'RETRY',
        reasons: ['Recoverable'],
        factors: [],
        riskFlags: [],
        evaluatedAt: new Date('2025-01-01T10:02:00Z'),
      });

      // Act
      const listA = await store.listAll({ merchantId: MERCHANT_A });
      const listB = await store.listAll({ merchantId: MERCHANT_B });

      // Assert
      expect(listA).toHaveLength(2);
      expect(listB).toHaveLength(1);
      expect(listA.every((d) => d.merchantId === MERCHANT_A)).toBe(true);
      expect(listB.every((d) => d.merchantId === MERCHANT_B)).toBe(true);
    });

    it('countByPriority scopes to merchant', async () => {
      // Arrange
      await store.upsert({
        merchantId: MERCHANT_A,
        opportunityId: '00000000-0000-4000-8000-000000000301',
        engineVersion: 'v1',
        score: 90,
        priority: 'CRITICAL',
        confidence: 90,
        recommendedAction: 'RETRY',
        reasons: [],
        factors: [],
        riskFlags: [],
        evaluatedAt: new Date(),
      });
      await store.upsert({
        merchantId: MERCHANT_A,
        opportunityId: '00000000-0000-4000-8000-000000000302',
        engineVersion: 'v1',
        score: 85,
        priority: 'CRITICAL',
        confidence: 80,
        recommendedAction: 'RETRY',
        reasons: [],
        factors: [],
        riskFlags: [],
        evaluatedAt: new Date(),
      });
      await store.upsert({
        merchantId: MERCHANT_B,
        opportunityId: '00000000-0000-4000-8000-000000000303',
        engineVersion: 'v1',
        score: 92,
        priority: 'CRITICAL',
        confidence: 95,
        recommendedAction: 'RETRY',
        reasons: [],
        factors: [],
        riskFlags: [],
        evaluatedAt: new Date(),
      });

      // Act
      const criticalA = await store.countByPriority('CRITICAL', MERCHANT_A);
      const criticalB = await store.countByPriority('CRITICAL', MERCHANT_B);
      const criticalAll = await store.countByPriority('CRITICAL');

      // Assert
      expect(criticalA).toBe(2);
      expect(criticalB).toBe(1);
      expect(criticalAll).toBe(3);
    });

    it('countByRecommendedAction scopes to merchant', async () => {
      // Arrange
      await store.upsert({
        merchantId: MERCHANT_A,
        opportunityId: '00000000-0000-4000-8000-000000000401',
        engineVersion: 'v1',
        score: 50,
        priority: 'MEDIUM',
        confidence: 60,
        recommendedAction: 'DO_NOT_RETRY',
        reasons: [],
        factors: [],
        riskFlags: [],
        evaluatedAt: new Date(),
      });
      await store.upsert({
        merchantId: MERCHANT_B,
        opportunityId: '00000000-0000-4000-8000-000000000402',
        engineVersion: 'v1',
        score: 50,
        priority: 'MEDIUM',
        confidence: 60,
        recommendedAction: 'DO_NOT_RETRY',
        reasons: [],
        factors: [],
        riskFlags: [],
        evaluatedAt: new Date(),
      });

      // Act
      const dnrA = await store.countByRecommendedAction('DO_NOT_RETRY', MERCHANT_A);
      const dnrB = await store.countByRecommendedAction('DO_NOT_RETRY', MERCHANT_B);

      // Assert
      expect(dnrA).toBe(1);
      expect(dnrB).toBe(1);
    });

    it('averageConfidence scopes to merchant', async () => {
      // Arrange
      await store.upsert({
        merchantId: MERCHANT_A,
        opportunityId: '00000000-0000-4000-8000-000000000501',
        engineVersion: 'v1',
        score: 50,
        priority: 'MEDIUM',
        confidence: 80,
        recommendedAction: 'RETRY',
        reasons: [],
        factors: [],
        riskFlags: [],
        evaluatedAt: new Date(),
      });
      await store.upsert({
        merchantId: MERCHANT_A,
        opportunityId: '00000000-0000-4000-8000-000000000502',
        engineVersion: 'v1',
        score: 50,
        priority: 'MEDIUM',
        confidence: 60,
        recommendedAction: 'RETRY',
        reasons: [],
        factors: [],
        riskFlags: [],
        evaluatedAt: new Date(),
      });
      await store.upsert({
        merchantId: MERCHANT_B,
        opportunityId: '00000000-0000-4000-8000-000000000503',
        engineVersion: 'v1',
        score: 50,
        priority: 'MEDIUM',
        confidence: 40,
        recommendedAction: 'RETRY',
        reasons: [],
        factors: [],
        riskFlags: [],
        evaluatedAt: new Date(),
      });

      // Act
      const avgA = await store.averageConfidence(MERCHANT_A);
      const avgB = await store.averageConfidence(MERCHANT_B);

      // Assert — MERCHANT_A: (80+60)/2 = 70, MERCHANT_B: 40
      expect(avgA).toBe(70);
      expect(avgB).toBe(40);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Executions scoped per merchant
  // -----------------------------------------------------------------------
  describe('Executions are scoped per merchant', () => {
    let store: InMemoryRecoveryExecutionStore;

    beforeEach(() => {
      store = new InMemoryRecoveryExecutionStore();
    });

    it('listAll with merchantId filter returns only that merchant executions', async () => {
      // Arrange
      await store.insert({
        merchantId: MERCHANT_A,
        opportunityId: 'opp_a1',
        decisionId: 'dec_a1',
        action: 'RETRY',
        status: 'PENDING',
        origin: 'MANUAL',
        attempt: 1,
        nextAttemptAt: null,
        scheduledAt: null,
        idempotencyKey: 'idem_a1',
        provider: null,
        providerPaymentId: 'pay_a1',
        requestedAt: new Date(),
        startedAt: null,
        completedAt: null,
        failureCode: null,
        failureReason: null,
      });
      await store.insert({
        merchantId: MERCHANT_A,
        opportunityId: 'opp_a2',
        decisionId: 'dec_a2',
        action: 'RETRY',
        status: 'SUCCEEDED',
        origin: 'AUTOMATED',
        attempt: 1,
        nextAttemptAt: null,
        scheduledAt: null,
        idempotencyKey: 'idem_a2',
        provider: 'razorpay',
        providerPaymentId: 'pay_a2',
        requestedAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
        failureCode: null,
        failureReason: null,
      });
      await store.insert({
        merchantId: MERCHANT_B,
        opportunityId: 'opp_b1',
        decisionId: 'dec_b1',
        action: 'RETRY',
        status: 'FAILED',
        origin: 'MANUAL',
        attempt: 2,
        nextAttemptAt: null,
        scheduledAt: null,
        idempotencyKey: 'idem_b1',
        provider: 'razorpay',
        providerPaymentId: 'pay_b1',
        requestedAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
        failureCode: 'PROVIDER_ERROR',
        failureReason: 'Gateway timeout',
      });

      // Act
      const listA = await store.listAll({ merchantId: MERCHANT_A });
      const listB = await store.listAll({ merchantId: MERCHANT_B });
      const listAll = await store.listAll({});

      // Assert
      expect(listA).toHaveLength(2);
      expect(listA.every((e) => e.merchantId === MERCHANT_A)).toBe(true);
      expect(listB).toHaveLength(1);
      expect(listB[0]!.merchantId).toBe(MERCHANT_B);
      expect(listAll).toHaveLength(3);
    });

    it('listRecent does not filter by merchant — verified it returns all', async () => {
      // Arrange
      await store.insert({
        merchantId: MERCHANT_A,
        opportunityId: 'opp_a1',
        decisionId: 'dec_a1',
        action: 'RETRY',
        status: 'PENDING',
        origin: 'MANUAL',
        attempt: 1,
        nextAttemptAt: null,
        scheduledAt: null,
        idempotencyKey: 'idem_lr_a',
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
        opportunityId: 'opp_b1',
        decisionId: 'dec_b1',
        action: 'RETRY',
        status: 'PENDING',
        origin: 'MANUAL',
        attempt: 1,
        nextAttemptAt: null,
        scheduledAt: null,
        idempotencyKey: 'idem_lr_b',
        provider: null,
        providerPaymentId: 'pay_b',
        requestedAt: new Date(),
        startedAt: null,
        completedAt: null,
        failureCode: null,
        failureReason: null,
      });

      // Act
      const recent = await store.listRecent({ limit: 10 });

      // Assert — listRecent is unscoped; both merchants appear
      expect(recent).toHaveLength(2);
    });

    it('listByOpportunity returns only executions for that specific opportunity', async () => {
      // Arrange
      await store.insert({
        merchantId: MERCHANT_A,
        opportunityId: 'opp_shared',
        decisionId: 'dec_a1',
        action: 'RETRY',
        status: 'PENDING',
        origin: 'MANUAL',
        attempt: 1,
        nextAttemptAt: null,
        scheduledAt: null,
        idempotencyKey: 'idem_lbo_a',
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
        opportunityId: 'opp_other',
        decisionId: 'dec_b1',
        action: 'RETRY',
        status: 'SUCCEEDED',
        origin: 'AUTOMATED',
        attempt: 1,
        nextAttemptAt: null,
        scheduledAt: null,
        idempotencyKey: 'idem_lbo_b',
        provider: 'razorpay',
        providerPaymentId: 'pay_b',
        requestedAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
        failureCode: null,
        failureReason: null,
      });

      // Act
      const execs = await store.listByOpportunity('opp_shared');

      // Assert
      expect(execs).toHaveLength(1);
      expect(execs[0]!.opportunityId).toBe('opp_shared');
      expect(execs[0]!.merchantId).toBe(MERCHANT_A);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Merchant memory independent per merchant
  // -----------------------------------------------------------------------
  describe('Merchant memory is independent per merchant', () => {
    let memoryStore: MerchantStrategyMemoryStore;
    let service: MerchantMemoryService;

    beforeEach(() => {
      memoryStore = createMerchantStrategyMemoryStoreMock();
      service = new MerchantMemoryService(memoryStore);
    });

    it('records different outcomes per merchant without cross-contamination', async () => {
      // Arrange & Act — Merchant A: 2 successful RETRY/GATEWAY_ERROR
      await service.recordOutcome(MERCHANT_A, 'RETRY', 'GATEWAY_ERROR', 'success', 100_000, 100_000);
      await service.recordOutcome(MERCHANT_A, 'RETRY', 'GATEWAY_ERROR', 'success', 200_000, 200_000);

      // Merchant B: 1 failed RETRY/GATEWAY_ERROR
      await service.recordOutcome(MERCHANT_B, 'RETRY', 'GATEWAY_ERROR', 'failure', 300_000, 0);

      // Assert
      const overviewA = await service.getOverview(MERCHANT_A);
      const overviewB = await service.getOverview(MERCHANT_B);

      expect(overviewA.totalOutcomes).toBe(2);
      expect(overviewA.totalRecovered).toBe(2);
      expect(overviewA.totalAmountRecovered).toBe(300_000);

      expect(overviewB.totalOutcomes).toBe(1);
      expect(overviewB.totalRecovered).toBe(0);
      expect(overviewB.totalAmountRecovered).toBe(0);
    });

    it('same strategy/failureType combo is isolated per merchant', async () => {
      // Arrange & Act
      await service.recordOutcome(MERCHANT_A, 'RETRY', 'GATEWAY_ERROR', 'success', 100_000, 100_000);
      await service.recordOutcome(MERCHANT_B, 'RETRY', 'GATEWAY_ERROR', 'success', 500_000, 500_000);

      // Act
      const overviewA = await service.getOverview(MERCHANT_A);
      const overviewB = await service.getOverview(MERCHANT_B);

      // Assert — same strategy, different merchants, independent amounts
      expect(overviewA.totalAmountRecovered).toBe(100_000);
      expect(overviewB.totalAmountRecovered).toBe(500_000);
      expect(overviewA.strategies).toHaveLength(1);
      expect(overviewB.strategies).toHaveLength(1);
    });

    it('recordBlocked does not affect other merchants', async () => {
      // Arrange & Act
      await service.recordOutcome(MERCHANT_A, 'RETRY', 'CARD_DECLINED', 'failure', 100_000, 0);
      await service.recordBlocked(MERCHANT_B, 'DO_NOT_RETRY', 'CARD_DECLINED');

      // Assert
      const overviewA = await service.getOverview(MERCHANT_A);
      const overviewB = await service.getOverview(MERCHANT_B);

      expect(overviewA.strategies[0]!.blocked).toBe(0);
      expect(overviewB.strategies[0]!.blocked).toBe(1);
    });

    it('getEvidenceForAI returns only the queried merchants data', async () => {
      // Arrange
      await service.recordOutcome(MERCHANT_A, 'RETRY', 'GATEWAY_ERROR', 'success', 100_000, 100_000);
      await service.recordOutcome(MERCHANT_A, 'WAIT', 'INSUFFICIENT_FUNDS', 'failure', 50_000, 0);
      await service.recordOutcome(MERCHANT_B, 'RETRY', 'GATEWAY_ERROR', 'failure', 200_000, 0);

      // Act
      const evidenceA = await service.getEvidenceForAI(MERCHANT_A);
      const evidenceB = await service.getEvidenceForAI(MERCHANT_B);

      // Assert
      expect(evidenceA.merchantId).toBe(MERCHANT_A);
      expect(evidenceA.strategyPerformance).toHaveLength(2);
      expect(evidenceA.strategyPerformance.map((s) => s.strategy).sort()).toEqual(['RETRY', 'WAIT']);

      expect(evidenceB.merchantId).toBe(MERCHANT_B);
      expect(evidenceB.strategyPerformance).toHaveLength(1);
      expect(evidenceB.strategyPerformance[0]!.strategy).toBe('RETRY');
    });

    it('clearAll for one merchant does not affect the other', async () => {
      // Arrange
      await service.recordOutcome(MERCHANT_A, 'RETRY', 'GATEWAY_ERROR', 'success', 100_000, 100_000);
      await service.recordOutcome(MERCHANT_B, 'RETRY', 'GATEWAY_ERROR', 'failure', 200_000, 0);

      // Act
      const cleared = await service.clearAll(MERCHANT_A);

      // Assert
      expect(cleared).toBe(1);

      const overviewA = await service.getOverview(MERCHANT_A);
      const overviewB = await service.getOverview(MERCHANT_B);

      expect(overviewA.totalOutcomes).toBe(0);
      expect(overviewB.totalOutcomes).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Merchant memory overview scoped
  // -----------------------------------------------------------------------
  describe('Merchant memory overview is scoped', () => {
    let memoryStore: MerchantStrategyMemoryStore;
    let service: MerchantMemoryService;

    beforeEach(() => {
      memoryStore = createMerchantStrategyMemoryStoreMock();
      service = new MerchantMemoryService(memoryStore);
    });

    it('overview metrics are independent per merchant', async () => {
      // Arrange
      // Merchant A: 5 successes for RETRY/GATEWAY_ERROR
      for (let i = 0; i < 5; i++) {
        await service.recordOutcome(MERCHANT_A, 'RETRY', 'GATEWAY_ERROR', 'success', 100_000, 100_000);
      }
      // Merchant A: 2 failures for WAIT/INSUFFICIENT_FUNDS
      await service.recordOutcome(MERCHANT_A, 'WAIT', 'INSUFFICIENT_FUNDS', 'failure', 100_000, 0);
      await service.recordOutcome(MERCHANT_A, 'WAIT', 'INSUFFICIENT_FUNDS', 'failure', 100_000, 0);

      // Merchant B: 3 failures for RETRY/GATEWAY_ERROR
      for (let i = 0; i < 3; i++) {
        await service.recordOutcome(MERCHANT_B, 'RETRY', 'GATEWAY_ERROR', 'failure', 100_000, 0);
      }

      // Act
      const overviewA = await service.getOverview(MERCHANT_A);
      const overviewB = await service.getOverview(MERCHANT_B);

      // Assert — Merchant A
      expect(overviewA.totalOutcomes).toBe(7);
      expect(overviewA.totalRecovered).toBe(5);
      expect(overviewA.strategies).toHaveLength(2);
      expect(overviewA.bestStrategy).toBe('RETRY');
      expect(overviewA.failurePatterns.length).toBeGreaterThanOrEqual(2);

      // Assert — Merchant B
      expect(overviewB.totalOutcomes).toBe(3);
      expect(overviewB.totalRecovered).toBe(0);
      expect(overviewB.strategies).toHaveLength(1);
      // Merchant B has 3 samples (all failures) — bestStrategy is set because
      // sampleCount >= 3, but effectivenessScore is very low (~1.4).
      expect(overviewB.bestStrategy).toBe('RETRY');
      expect(overviewB.strategies[0]!.effectivenessScore).toBeLessThan(5);
    });

    it('confidence levels are computed independently', async () => {
      // Arrange — Merchant A gets enough samples for SUFFICIENT confidence
      for (let i = 0; i < 20; i++) {
        await service.recordOutcome(MERCHANT_A, 'RETRY', 'GATEWAY_ERROR', 'success', 100_000, 100_000);
      }
      // Merchant B stays at LOW confidence
      await service.recordOutcome(MERCHANT_B, 'RETRY', 'GATEWAY_ERROR', 'success', 100_000, 100_000);

      // Act
      const overviewA = await service.getOverview(MERCHANT_A);
      const overviewB = await service.getOverview(MERCHANT_B);

      // Assert
      expect(overviewA.confidence).toBe('SUFFICIENT');
      expect(overviewB.confidence).toBe('LOW');
    });

    it('recoveryRate is computed from independent amount data', async () => {
      // Arrange
      await service.recordOutcome(MERCHANT_A, 'RETRY', 'GATEWAY_ERROR', 'success', 200_000, 200_000);
      await service.recordOutcome(MERCHANT_A, 'RETRY', 'GATEWAY_ERROR', 'failure', 100_000, 0);

      await service.recordOutcome(MERCHANT_B, 'RETRY', 'GATEWAY_ERROR', 'failure', 500_000, 0);

      // Act
      const overviewA = await service.getOverview(MERCHANT_A);
      const overviewB = await service.getOverview(MERCHANT_B);

      // Assert — Merchant A recovered 200k out of 300k = 0.666...
      expect(overviewA.recoveryRate).toBeCloseTo(200_000 / 300_000, 4);
      // Merchant B recovered 0 out of 500k = 0
      expect(overviewB.recoveryRate).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 7. Dashboard metrics scoped
  // -----------------------------------------------------------------------
  describe('Dashboard metrics are scoped per merchant', () => {
    let oppStore: InMemoryRecoveryOpportunityStore;

    beforeEach(() => {
      oppStore = new InMemoryRecoveryOpportunityStore();
    });

    async function seedOpp(
      merchantId: string,
      sourceEventId: string,
      amountAtRisk: number,
      status: 'OPEN' | 'RECOVERED' = 'OPEN'
    ) {
      return oppStore.insert({
        merchantId,
        paymentAccountId: null,
        type: 'FAILED_PAYMENT',
        status,
        sourceEventId,
        providerPaymentId: `pay_${sourceEventId}`,
        providerOrderId: `order_${sourceEventId}`,
        amountAtRisk,
        currency: 'INR',
        reason: 'Payment failed',
        evidence: {
          sourceEventId,
          providerPaymentId: `pay_${sourceEventId}`,
          providerOrderId: `order_${sourceEventId}`,
          eventType: 'payment.failed',
          amount: amountAtRisk,
          currency: 'INR',
          occurredAt: new Date().toISOString(),
          failureCode: 'GATEWAY_ERROR',
        },
        detectedAt: new Date(),
        expiresAt: null,
        resolvedAt: status === 'RECOVERED' ? new Date() : null,
        recoveryEventId: status === 'RECOVERED' ? 'recovery_evt_1' : null,
      });
    }

    it('summarizeByStatusAndCurrency returns only the queried merchants data', async () => {
      // Arrange
      await seedOpp(MERCHANT_A, 'evt_a1', 100_000);
      await seedOpp(MERCHANT_A, 'evt_a2', 200_000);
      await seedOpp(MERCHANT_A, 'evt_a3', 300_000, 'RECOVERED');
      await seedOpp(MERCHANT_B, 'evt_b1', 500_000);
      await seedOpp(MERCHANT_B, 'evt_b2', 150_000, 'RECOVERED');

      // Act
      const summaryA = await oppStore.summarizeByStatusAndCurrency(MERCHANT_A);
      const summaryB = await oppStore.summarizeByStatusAndCurrency(MERCHANT_B);

      // Assert — Merchant A: 2 OPEN + 1 RECOVERED
      const openA = summaryA.find((s) => s.status === 'OPEN');
      const recoveredA = summaryA.find((s) => s.status === 'RECOVERED');
      expect(openA!.count).toBe(2);
      expect(openA!.totalAmountAtRisk).toBe(300_000);
      expect(recoveredA!.count).toBe(1);
      expect(recoveredA!.totalAmountAtRisk).toBe(300_000);

      // Assert — Merchant B: 1 OPEN + 1 RECOVERED
      const openB = summaryB.find((s) => s.status === 'OPEN');
      const recoveredB = summaryB.find((s) => s.status === 'RECOVERED');
      expect(openB!.count).toBe(1);
      expect(openB!.totalAmountAtRisk).toBe(500_000);
      expect(recoveredB!.count).toBe(1);
      expect(recoveredB!.totalAmountAtRisk).toBe(150_000);
    });

    it('count with merchantId filter is independent', async () => {
      // Arrange
      await seedOpp(MERCHANT_A, 'evt_a1', 100_000);
      await seedOpp(MERCHANT_A, 'evt_a2', 200_000);
      await seedOpp(MERCHANT_B, 'evt_b1', 300_000);

      // Act
      const countA = await oppStore.count({ merchantId: MERCHANT_A });
      const countB = await oppStore.count({ merchantId: MERCHANT_B });
      const countAll = await oppStore.count({});

      // Assert
      expect(countA).toBe(2);
      expect(countB).toBe(1);
      expect(countAll).toBe(3);
    });

    it('count with status+merchantId filter scopes correctly', async () => {
      // Arrange
      await seedOpp(MERCHANT_A, 'evt_a1', 100_000);
      await seedOpp(MERCHANT_A, 'evt_a2', 200_000, 'RECOVERED');
      await seedOpp(MERCHANT_B, 'evt_b1', 300_000, 'RECOVERED');

      // Act
      const openA = await oppStore.count({ merchantId: MERCHANT_A, status: 'OPEN' });
      const recoveredA = await oppStore.count({ merchantId: MERCHANT_A, status: 'RECOVERED' });
      const recoveredB = await oppStore.count({ merchantId: MERCHANT_B, status: 'RECOVERED' });

      // Assert
      expect(openA).toBe(1);
      expect(recoveredA).toBe(1);
      expect(recoveredB).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // 8. Simulation analytics scoped
  // -----------------------------------------------------------------------
  describe('Simulation analytics are scoped per run', () => {
    it('getAnalytics returns data only for the queried run', async () => {
      // Arrange
      const simStore = createSimulationRunStoreMock();
      const db = createDbExecutorMock(undefined, { simulationRun: simStore });
      const service = new SimulationAnalyticsService(db);

      await simStore.create({
        id: 'run-001',
        seed: 42,
        merchantCount: 10,
        eventsPerMerchant: 50,
        totalEvents: 500,
        status: 'completed',
      });
      await simStore.update('run-001', {
        processedEvents: 500,
        successfulPayments: 400,
        failedPayments: 100,
        opportunitiesDetected: 25,
        executionsAttempted: 20,
        executionsBlocked: 5,
        humanReviews: 2,
        recoveriesVerified: 15,
        revenueAtRisk: 2_500_000,
        recoverableRevenue: 2_000_000,
        recoveredRevenue: 1_500_000,
        processingDurationMs: 5000,
        startedAt: new Date('2025-01-01T10:00:00Z'),
        completedAt: new Date('2025-01-01T10:00:05Z'),
      });

      await simStore.create({
        id: 'run-002',
        seed: 99,
        merchantCount: 5,
        eventsPerMerchant: 100,
        totalEvents: 500,
        status: 'completed',
      });
      await simStore.update('run-002', {
        processedEvents: 500,
        successfulPayments: 300,
        failedPayments: 200,
        opportunitiesDetected: 40,
        executionsAttempted: 30,
        executionsBlocked: 10,
        humanReviews: 5,
        recoveriesVerified: 10,
        revenueAtRisk: 5_000_000,
        recoverableRevenue: 4_000_000,
        recoveredRevenue: 800_000,
        processingDurationMs: 10000,
        startedAt: new Date('2025-01-02T10:00:00Z'),
        completedAt: new Date('2025-01-02T10:00:10Z'),
      });

      // Act
      const analytics1 = await service.getAnalytics('run-001');
      const analytics2 = await service.getAnalytics('run-002');

      // Assert — run-001
      expect(analytics1).not.toBeNull();
      expect(analytics1!.runId).toBe('run-001');
      expect(analytics1!.payments.successful).toBe(400);
      expect(analytics1!.payments.failed).toBe(100);
      expect(analytics1!.revenue.recovered).toBe(1_500_000);
      expect(analytics1!.recovery.opportunitiesDetected).toBe(25);
      expect(analytics1!.performance.durationMs).toBe(5000);

      // Assert — run-002 (different data, no cross-contamination)
      expect(analytics2).not.toBeNull();
      expect(analytics2!.runId).toBe('run-002');
      expect(analytics2!.payments.successful).toBe(300);
      expect(analytics2!.payments.failed).toBe(200);
      expect(analytics2!.revenue.recovered).toBe(800_000);
      expect(analytics2!.recovery.opportunitiesDetected).toBe(40);
      expect(analytics2!.performance.durationMs).toBe(10000);
    });

    it('getAnalytics returns null for non-existent run', async () => {
      // Arrange
      const simStore = createSimulationRunStoreMock();
      const db = createDbExecutorMock(undefined, { simulationRun: simStore });
      const service = new SimulationAnalyticsService(db);

      // Act
      const analytics = await service.getAnalytics('run-nonexistent');

      // Assert
      expect(analytics).toBeNull();
    });

    it('computeAnalytics produces independent results per run', async () => {
      // Arrange
      const simStore = createSimulationRunStoreMock();
      const db = createDbExecutorMock(undefined, { simulationRun: simStore });
      const service = new SimulationAnalyticsService(db);

      await simStore.create({
        id: 'run-a',
        seed: 1,
        merchantCount: 3,
        eventsPerMerchant: 10,
        totalEvents: 30,
        status: 'completed',
      });
      await simStore.update('run-a', {
        processedEvents: 30,
        successfulPayments: 28,
        failedPayments: 2,
        revenueAtRisk: 500_000,
        recoveredRevenue: 450_000,
        recoverableRevenue: 500_000,
      });

      await simStore.create({
        id: 'run-b',
        seed: 2,
        merchantCount: 7,
        eventsPerMerchant: 20,
        totalEvents: 140,
        status: 'completed',
      });
      await simStore.update('run-b', {
        processedEvents: 140,
        successfulPayments: 100,
        failedPayments: 40,
        revenueAtRisk: 1_000_000,
        recoveredRevenue: 200_000,
        recoverableRevenue: 1_000_000,
      });

      // Act
      const analyticsA = await service.getAnalytics('run-a');
      const analyticsB = await service.getAnalytics('run-b');

      // Assert — recoveryRate: run-a = 450k/500k = 0.9, run-b = 200k/1000k = 0.2
      expect(analyticsA!.revenue.recoveryRate).toBeCloseTo(0.9, 4);
      expect(analyticsB!.revenue.recoveryRate).toBeCloseTo(0.2, 4);

      // Dataset config is different
      expect(analyticsA!.dataset.merchants).toBe(3);
      expect(analyticsB!.dataset.merchants).toBe(7);
      expect(analyticsA!.dataset.eventsPerMerchant).toBe(10);
      expect(analyticsB!.dataset.eventsPerMerchant).toBe(20);
    });
  });

  // -----------------------------------------------------------------------
  // 9. markRecovered on Merchant A does not affect Merchant B
  // -----------------------------------------------------------------------
  describe('markRecovered is scoped — cross-merchant providerPaymentId isolation', () => {
    let store: InMemoryRecoveryOpportunityStore;

    beforeEach(() => {
      store = new InMemoryRecoveryOpportunityStore();
    });

    it('capturing one merchants opportunity does not recover the other merchants opportunity with the same providerPaymentId', async () => {
      // Arrange — two opportunities for different merchants sharing the same providerPaymentId
      // Note: sourceEventId must differ to satisfy the (sourceEventId, type) unique constraint.
      const oppA = await store.insert({
        merchantId: MERCHANT_A,
        paymentAccountId: null,
        type: 'FAILED_PAYMENT',
        status: 'OPEN',
        sourceEventId: 'evt_a_shared_pay',
        providerPaymentId: 'pay_shared_123',
        providerOrderId: 'order_shared_123',
        amountAtRisk: 500_000,
        currency: 'INR',
        reason: 'Payment failed',
        evidence: {
          sourceEventId: 'evt_a_shared_pay',
          providerPaymentId: 'pay_shared_123',
          providerOrderId: 'order_shared_123',
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

      const oppB = await store.insert({
        merchantId: MERCHANT_B,
        paymentAccountId: null,
        type: 'FAILED_PAYMENT',
        status: 'OPEN',
        sourceEventId: 'evt_b_shared_pay',
        providerPaymentId: 'pay_shared_123',
        providerOrderId: 'order_shared_123',
        amountAtRisk: 500_000,
        currency: 'INR',
        reason: 'Payment failed',
        evidence: {
          sourceEventId: 'evt_b_shared_pay',
          providerPaymentId: 'pay_shared_123',
          providerOrderId: 'order_shared_123',
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

      // Act — mark Merchant A's opportunity as recovered
      await store.markRecovered({
        id: oppA.id,
        recoveryEventId: 'recovery_evt_a',
        resolvedAt: new Date(),
      });

      // Assert
      const updatedA = await store.findById(oppA.id);
      const updatedB = await store.findById(oppB.id);

      expect(updatedA!.status).toBe('RECOVERED');
      expect(updatedA!.recoveryEventId).toBe('recovery_evt_a');
      expect(updatedA!.resolvedAt).not.toBeNull();

      // Merchant B's opportunity is still OPEN — not affected
      expect(updatedB!.status).toBe('OPEN');
      expect(updatedB!.recoveryEventId).toBeNull();
      expect(updatedB!.resolvedAt).toBeNull();
    });

    it('list queries respect the merchant boundary even with matching providerPaymentId', async () => {
      // Arrange
      await store.insert({
        merchantId: MERCHANT_A,
        paymentAccountId: null,
        type: 'FAILED_PAYMENT',
        status: 'OPEN',
        sourceEventId: 'evt_list_a',
        providerPaymentId: 'pay_dup',
        providerOrderId: null,
        amountAtRisk: 100_000,
        currency: 'INR',
        reason: 'Failed',
        evidence: {},
        detectedAt: new Date(),
        expiresAt: null,
        resolvedAt: null,
        recoveryEventId: null,
      });
      await store.insert({
        merchantId: MERCHANT_B,
        paymentAccountId: null,
        type: 'FAILED_PAYMENT',
        status: 'OPEN',
        sourceEventId: 'evt_list_b',
        providerPaymentId: 'pay_dup',
        providerOrderId: null,
        amountAtRisk: 200_000,
        currency: 'INR',
        reason: 'Failed',
        evidence: {},
        detectedAt: new Date(),
        expiresAt: null,
        resolvedAt: null,
        recoveryEventId: null,
      });

      // Act
      const listA = await store.list({ merchantId: MERCHANT_A });
      const listB = await store.list({ merchantId: MERCHANT_B });

      // Assert — each merchant sees only their own, despite same providerPaymentId
      expect(listA).toHaveLength(1);
      expect(listA[0]!.merchantId).toBe(MERCHANT_A);
      expect(listA[0]!.providerPaymentId).toBe('pay_dup');

      expect(listB).toHaveLength(1);
      expect(listB[0]!.merchantId).toBe(MERCHANT_B);
      expect(listB[0]!.providerPaymentId).toBe('pay_dup');
    });

    it('findOpenByPaymentCorrelation returns opportunities from both merchants (payment-level query)', async () => {
      // Arrange
      await store.insert({
        merchantId: MERCHANT_A,
        paymentAccountId: null,
        type: 'FAILED_PAYMENT',
        status: 'OPEN',
        sourceEventId: 'evt_corr_a',
        providerPaymentId: 'pay_corr',
        providerOrderId: null,
        amountAtRisk: 100_000,
        currency: 'INR',
        reason: 'Failed',
        evidence: {},
        detectedAt: new Date(),
        expiresAt: null,
        resolvedAt: null,
        recoveryEventId: null,
      });
      await store.insert({
        merchantId: MERCHANT_B,
        paymentAccountId: null,
        type: 'FAILED_PAYMENT',
        status: 'OPEN',
        sourceEventId: 'evt_corr_b',
        providerPaymentId: 'pay_corr',
        providerOrderId: null,
        amountAtRisk: 200_000,
        currency: 'INR',
        reason: 'Failed',
        evidence: {},
        detectedAt: new Date(),
        expiresAt: null,
        resolvedAt: null,
        recoveryEventId: null,
      });

      // Act — payment correlation is a payment-level query (not merchant-scoped)
      const found = await store.findOpenByPaymentCorrelation({
        providerPaymentId: 'pay_corr',
        providerOrderId: null,
      });

      // Assert — both merchants' opportunities returned (correct for payment-level queries)
      expect(found).toHaveLength(2);
      const merchantIds = found.map((o) => o.merchantId).sort();
      expect(merchantIds).toEqual([MERCHANT_A, MERCHANT_B]);
    });
  });

  // -----------------------------------------------------------------------
  // 10. Strategy ranking independent per merchant
  // -----------------------------------------------------------------------
  describe('Strategy ranking is independent per merchant', () => {
    let memoryStore: MerchantStrategyMemoryStore;
    let service: MerchantMemoryService;

    beforeEach(() => {
      memoryStore = createMerchantStrategyMemoryStoreMock();
      service = new MerchantMemoryService(memoryStore);
    });

    it('bestStrategy reflects per-merchant performance, not global', async () => {
      // Arrange — Merchant A: RETRY is highly successful (5/5)
      for (let i = 0; i < 5; i++) {
        await service.recordOutcome(MERCHANT_A, 'RETRY', 'GATEWAY_ERROR', 'success', 100_000, 100_000);
      }

      // Merchant B: same RETRY strategy fails (0/3)
      for (let i = 0; i < 3; i++) {
        await service.recordOutcome(MERCHANT_B, 'RETRY', 'GATEWAY_ERROR', 'failure', 100_000, 0);
      }

      // Act
      const overviewA = await service.getOverview(MERCHANT_A);
      const overviewB = await service.getOverview(MERCHANT_B);

      // Assert
      expect(overviewA.bestStrategy).toBe('RETRY');
      expect(overviewA.strategies[0]!.successRate).toBe(1);

      // Merchant B has only failures — bestStrategy is set because sampleCount >= 3,
      // but effectivenessScore is very low (~1.4) since successRate and recoveryRate are 0.
      expect(overviewB.strategies[0]!.successRate).toBe(0);
      expect(overviewB.totalRecovered).toBe(0);
      expect(overviewB.strategies[0]!.effectivenessScore).toBeLessThan(5);
    });

    it('effectivenessScore diverges per merchant for the same strategy', async () => {
      // Arrange — identical input parameters, different outcomes
      await service.recordOutcome(MERCHANT_A, 'RETRY', 'GATEWAY_ERROR', 'success', 100_000, 100_000);
      await service.recordOutcome(MERCHANT_A, 'RETRY', 'GATEWAY_ERROR', 'success', 100_000, 100_000);
      await service.recordOutcome(MERCHANT_A, 'RETRY', 'GATEWAY_ERROR', 'success', 100_000, 100_000);

      await service.recordOutcome(MERCHANT_B, 'RETRY', 'GATEWAY_ERROR', 'failure', 100_000, 0);
      await service.recordOutcome(MERCHANT_B, 'RETRY', 'GATEWAY_ERROR', 'failure', 100_000, 0);
      await service.recordOutcome(MERCHANT_B, 'RETRY', 'GATEWAY_ERROR', 'failure', 100_000, 0);

      // Act
      const overviewA = await service.getOverview(MERCHANT_A);
      const overviewB = await service.getOverview(MERCHANT_B);

      // Assert — same strategy, same failureType, different effectiveness
      const scoreA = overviewA.strategies.find((s) => s.strategy === 'RETRY')!.effectivenessScore;
      const scoreB = overviewB.strategies.find((s) => s.strategy === 'RETRY')!.effectivenessScore;

      expect(scoreA).toBeGreaterThan(scoreB);
      expect(scoreA).toBeGreaterThan(50);
      expect(scoreB).toBeLessThan(20);
    });

    it('multiple strategies ranked independently per merchant', async () => {
      // Arrange — Merchant A: PAYMENT_LINK is better than RETRY
      await service.recordOutcome(MERCHANT_A, 'PAYMENT_LINK', 'CARD_DECLINED', 'success', 100_000, 100_000);
      await service.recordOutcome(MERCHANT_A, 'PAYMENT_LINK', 'CARD_DECLINED', 'success', 100_000, 100_000);
      await service.recordOutcome(MERCHANT_A, 'PAYMENT_LINK', 'CARD_DECLINED', 'success', 100_000, 100_000);
      await service.recordOutcome(MERCHANT_A, 'RETRY', 'CARD_DECLINED', 'failure', 100_000, 0);
      await service.recordOutcome(MERCHANT_A, 'RETRY', 'CARD_DECLINED', 'failure', 100_000, 0);

      // Merchant B: RETRY is better than PAYMENT_LINK
      await service.recordOutcome(MERCHANT_B, 'RETRY', 'CARD_DECLINED', 'success', 100_000, 100_000);
      await service.recordOutcome(MERCHANT_B, 'RETRY', 'CARD_DECLINED', 'success', 100_000, 100_000);
      await service.recordOutcome(MERCHANT_B, 'RETRY', 'CARD_DECLINED', 'success', 100_000, 100_000);
      await service.recordOutcome(MERCHANT_B, 'PAYMENT_LINK', 'CARD_DECLINED', 'failure', 100_000, 0);
      await service.recordOutcome(MERCHANT_B, 'PAYMENT_LINK', 'CARD_DECLINED', 'failure', 100_000, 0);

      // Act
      const listA = await memoryStore.listByMerchant(MERCHANT_A);
      const listB = await memoryStore.listByMerchant(MERCHANT_B);

      // Assert — listByMerchant sorts by effectivenessScore descending
      // Merchant A: PAYMENT_LINK (score ~high) > RETRY (score ~low)
      const plA = listA.find((s) => s.strategy === 'PAYMENT_LINK')!;
      const rtA = listA.find((s) => s.strategy === 'RETRY')!;
      expect(plA.effectivenessScore).toBeGreaterThan(rtA.effectivenessScore);

      // Merchant B: RETRY (score ~high) > PAYMENT_LINK (score ~low)
      const rtB = listB.find((s) => s.strategy === 'RETRY')!;
      const plB = listB.find((s) => s.strategy === 'PAYMENT_LINK')!;
      expect(rtB.effectivenessScore).toBeGreaterThan(plB.effectivenessScore);
    });

    it('getEvidenceForAI returns per-merchant strategy performance for ranking', async () => {
      // Arrange
      await service.recordOutcome(MERCHANT_A, 'RETRY', 'GATEWAY_ERROR', 'success', 100_000, 100_000);
      await service.recordOutcome(MERCHANT_A, 'WAIT', 'GATEWAY_ERROR', 'failure', 100_000, 0);

      await service.recordOutcome(MERCHANT_B, 'RETRY', 'GATEWAY_ERROR', 'failure', 100_000, 0);
      await service.recordOutcome(MERCHANT_B, 'PAYMENT_LINK', 'GATEWAY_ERROR', 'success', 100_000, 100_000);

      // Act
      const evidenceA = await service.getEvidenceForAI(MERCHANT_A);
      const evidenceB = await service.getEvidenceForAI(MERCHANT_B);

      // Assert — Merchant A: RETRY has high successRate, WAIT has 0
      const retryPerfA = evidenceA.strategyPerformance.find((s) => s.strategy === 'RETRY')!;
      const waitPerfA = evidenceA.strategyPerformance.find((s) => s.strategy === 'WAIT')!;
      expect(retryPerfA.successRate).toBe(1);
      expect(waitPerfA.successRate).toBe(0);

      // Merchant B: PAYMENT_LINK has high successRate, RETRY has 0 (reversed)
      const plPerfB = evidenceB.strategyPerformance.find((s) => s.strategy === 'PAYMENT_LINK')!;
      const retryPerfB = evidenceB.strategyPerformance.find((s) => s.strategy === 'RETRY')!;
      expect(plPerfB.successRate).toBe(1);
      expect(retryPerfB.successRate).toBe(0);
    });
  });
});
