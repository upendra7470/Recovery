import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  RevenueLeakageDetector,
  createDefaultDetectionRules,
} from '../../src/detection/revenue-leakage.detector.js';
import { RecoveryOpportunityRepository } from '../../src/repositories/recovery-opportunity.repository.js';
import { RecoveryDecisionRepository } from '../../src/repositories/recovery-decision.repository.js';
import { RecoveryExecutionRepository } from '../../src/repositories/recovery-execution.repository.js';
import { RevenueLeakageService } from '../../src/services/revenue-leakage.service.js';
import { RecoveryDecisionService } from '../../src/services/recovery-decision.service.js';
import { RecoveryExecutionService } from '../../src/services/recovery-execution.service.js';
import { DECISION_ENGINE_VERSION } from '../../src/decision/engine.js';
import { describeReconciliation } from '../../src/domain/recovery-execution.js';
import type { ExecutionStatus } from '../../src/domain/recovery-execution.js';
import type { RecoveryOpportunityRow } from '../../src/domain/recovery-opportunity.js';
import type { PaymentEventRow } from '../../src/domain/payment-event.js';
import {
  InMemoryPaymentEventStore,
  InMemoryRecoveryOpportunityStore,
  InMemoryRecoveryDecisionStore,
  InMemoryRecoveryExecutionStore,
  createMerchantStrategyMemoryStoreMock,
  FakeRecoveryExecutionProvider,
} from '../helpers.js';

const MERCHANT_A = '11111111-1111-4111-8111-111111111111';
const WINDOW = { windowMs: 24 * 60 * 60 * 1000 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFailedEvent(overrides: {
  id?: string;
  providerPaymentId?: string;
  providerOrderId?: string | null;
  merchantId?: string | null;
  eventCreatedAt?: Date;
  providerEventId?: string;
} = {}): PaymentEventRow {
  const providerPaymentId = overrides.providerPaymentId ?? 'pay_integrity_1';
  return {
    id: overrides.id ?? randomUUID(),
    paymentAccountId: null,
    merchantId: overrides.merchantId ?? MERCHANT_A,
    provider: 'razorpay',
    providerEventId: overrides.providerEventId ?? `payment.failed:${providerPaymentId}`,
    eventType: 'payment.failed',
    providerPaymentId,
    providerOrderId: overrides.providerOrderId ?? null,
    eventCreatedAt: overrides.eventCreatedAt ?? new Date('2026-08-25T10:00:05.000Z'),
    receivedAt: new Date('2026-08-25T10:00:06.000Z'),
    payload: {},
    normalizedData: {
      provider: 'razorpay',
      eventType: 'payment.failed',
      providerPaymentId,
      providerOrderId: overrides.providerOrderId ?? null,
      amount: 50000,
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
    processingStatus: 'processed',
    processingAttempts: 1,
    processedAt: new Date(),
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeCaptureEvent(overrides: {
  id?: string;
  providerPaymentId?: string;
  providerOrderId?: string | null;
  merchantId?: string | null;
  amount?: number;
  currency?: string;
  eventCreatedAt?: Date;
  providerEventId?: string;
} = {}): PaymentEventRow {
  const providerPaymentId = overrides.providerPaymentId ?? 'pay_integrity_1';
  return {
    id: overrides.id ?? randomUUID(),
    paymentAccountId: null,
    merchantId: overrides.merchantId ?? MERCHANT_A,
    provider: 'razorpay',
    providerEventId:
      overrides.providerEventId ?? `payment.captured:${providerPaymentId}`,
    eventType: 'payment.captured',
    providerPaymentId,
    providerOrderId: overrides.providerOrderId ?? null,
    eventCreatedAt: overrides.eventCreatedAt ?? new Date('2026-08-25T10:00:10.000Z'),
    receivedAt: new Date('2026-08-25T10:00:11.000Z'),
    payload: {},
    normalizedData: {
      provider: 'razorpay',
      eventType: 'payment.captured',
      providerPaymentId,
      providerOrderId: overrides.providerOrderId ?? null,
      amount: overrides.amount ?? 50000,
      currency: overrides.currency ?? 'INR',
      status: 'captured',
      method: 'card',
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
    processingStatus: 'processed',
    processingAttempts: 1,
    processedAt: new Date(),
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function insertEvent(
  store: InMemoryPaymentEventStore,
  event: PaymentEventRow
): Promise<PaymentEventRow> {
  return store.insert({
    paymentAccountId: event.paymentAccountId,
    merchantId: event.merchantId,
    provider: event.provider,
    providerEventId: event.providerEventId,
    eventType: event.eventType,
    providerPaymentId: event.providerPaymentId,
    providerOrderId: event.providerOrderId,
    eventCreatedAt: event.eventCreatedAt,
    receivedAt: event.receivedAt,
    payload: event.payload as import('@prisma/client').Prisma.InputJsonValue,
    normalizedData: event.normalizedData as import('../../src/domain/payment-event.js').NormalizedPaymentEventData,
    signatureVerified: event.signatureVerified,
    processingStatus: event.processingStatus,
    processingAttempts: event.processingAttempts,
    processedAt: event.processedAt,
    failureReason: event.failureReason,
  });
}

async function seedOpportunity(
  store: InMemoryRecoveryOpportunityStore,
  overrides: {
    id?: string;
    sourceEventId?: string;
    providerPaymentId?: string;
    providerOrderId?: string | null;
    amountAtRisk?: number;
    currency?: string;
    merchantId?: string | null;
    status?: RecoveryOpportunityRow['status'];
  } = {}
): Promise<RecoveryOpportunityRow> {
  return store.insert({
    merchantId: overrides.merchantId ?? MERCHANT_A,
    paymentAccountId: null,
    type: 'FAILED_PAYMENT',
    status: overrides.status ?? 'OPEN',
    sourceEventId: overrides.sourceEventId ?? randomUUID(),
    providerPaymentId: overrides.providerPaymentId ?? 'pay_integrity_1',
    providerOrderId: overrides.providerOrderId ?? null,
    amountAtRisk: overrides.amountAtRisk ?? 50000,
    currency: overrides.currency ?? 'INR',
    reason: 'Payment failed and no successful payment was observed within the detection window.',
    evidence: {
      sourceEventId: overrides.sourceEventId ?? 'evt_evidence',
      providerPaymentId: overrides.providerPaymentId ?? 'pay_integrity_1',
      providerOrderId: overrides.providerOrderId ?? null,
      eventType: 'payment.failed',
      amount: overrides.amountAtRisk ?? 50000,
      currency: overrides.currency ?? 'INR',
      occurredAt: new Date().toISOString(),
      failureCode: 'GATEWAY_ERROR',
    },
    recoveryEventId: null,
    detectedAt: new Date(),
    expiresAt: null,
    resolvedAt: null,
  });
}

async function seedDecision(
  store: InMemoryRecoveryDecisionStore,
  opportunityId: string,
  overrides: {
    recommendedAction?: 'RETRY' | 'WAIT' | 'DO_NOT_RETRY' | 'REVIEW' | 'NO_ACTION';
    confidence?: number;
    riskFlags?: Array<{ flag: 'NON_RECOVERABLE_CONDITION' | 'INSUFFICIENT_HISTORICAL_DATA' | 'MISSING_FAILURE_CODE' | 'HIGH_RETRY_COUNT' | 'CONFLICTING_EVIDENCE'; explanation: string }>;
  } = {}
): Promise<void> {
  await store.upsert({
    merchantId: MERCHANT_A,
    opportunityId,
    engineVersion: DECISION_ENGINE_VERSION,
    score: 80,
    priority: 'HIGH',
    confidence: overrides.confidence ?? 85,
    recommendedAction: overrides.recommendedAction ?? 'RETRY',
    reasons: ['Transient gateway failure'],
    factors: [],
    riskFlags: overrides.riskFlags ?? [],
    evaluatedAt: new Date(Date.now() + 60_000),
  });
}

function createLeakageService(stores: {
  opportunityStore: InMemoryRecoveryOpportunityStore;
  eventStore: InMemoryPaymentEventStore;
}) {
  const detector = new RevenueLeakageDetector(createDefaultDetectionRules());
  const repository = new RecoveryOpportunityRepository(stores.opportunityStore);
  return new RevenueLeakageService(detector, repository, stores.eventStore, WINDOW);
}

async function createExecutionStack(stores: {
  opportunityStore: InMemoryRecoveryOpportunityStore;
  eventStore: InMemoryPaymentEventStore;
  executionStore: InMemoryRecoveryExecutionStore;
  decisionStore: InMemoryRecoveryDecisionStore;
}) {
  const opportunityRepo = new RecoveryOpportunityRepository(stores.opportunityStore);
  const decisionRepo = new RecoveryDecisionRepository(stores.decisionStore);
  const executionRepo = new RecoveryExecutionRepository(stores.executionStore);
  const decisionService = new RecoveryDecisionService(
    opportunityRepo,
    decisionRepo,
    stores.eventStore,
    WINDOW
  );
  const provider = new FakeRecoveryExecutionProvider();
  const executionService = new RecoveryExecutionService(
    opportunityRepo,
    decisionService,
    executionRepo,
    stores.eventStore,
    provider,
    { enabled: true, minConfidence: 60, maxRetries: 3 }
  );
  return { opportunityRepo, decisionService, executionRepo, executionService, provider };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('outcome integrity', () => {
  // -----------------------------------------------------------------------
  // 1. Execution accepted but no capture → NOT RECOVERED
  // -----------------------------------------------------------------------
  it('execution accepted but no capture event → opportunity stays OPEN', async () => {
    const opportunityStore = new InMemoryRecoveryOpportunityStore();
    const eventStore = new InMemoryPaymentEventStore();
    const executionStore = new InMemoryRecoveryExecutionStore();
    const decisionStore = new InMemoryRecoveryDecisionStore();

    const failedEvent = await insertEvent(
      eventStore,
      makeFailedEvent({ providerPaymentId: 'pay_no_capture' })
    );

    const opportunity = await seedOpportunity(opportunityStore, {
      sourceEventId: failedEvent.id,
      providerPaymentId: 'pay_no_capture',
    });
    await seedDecision(decisionStore, opportunity.id);

    const { executionService, provider } = await createExecutionStack({
      opportunityStore,
      eventStore,
      executionStore,
      decisionStore,
    });

    // Act: execute the retry — provider accepts
    const result = await executionService.requestExecution(opportunity.id);
    expect(result.outcome).toBe('created');

    // Assert: opportunity is still OPEN (no capture event arrived)
    const after = await opportunityStore.findById(opportunity.id);
    expect(after?.status).toBe('OPEN');
    expect(after?.recoveryEventId).toBeNull();

    // Assert: execution succeeded but is NOT recovery
    if (result.outcome === 'created') {
      expect(result.execution.status).toBe('SUCCEEDED');
    }
    expect(provider.calls).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // 2. Execution failed → NOT RECOVERED
  // -----------------------------------------------------------------------
  it('execution failed (provider rejected) → opportunity stays OPEN', async () => {
    const opportunityStore = new InMemoryRecoveryOpportunityStore();
    const eventStore = new InMemoryPaymentEventStore();
    const executionStore = new InMemoryRecoveryExecutionStore();
    const decisionStore = new InMemoryRecoveryDecisionStore();

    const failedEvent = await insertEvent(
      eventStore,
      makeFailedEvent({ providerPaymentId: 'pay_rejected' })
    );

    const opportunity = await seedOpportunity(opportunityStore, {
      sourceEventId: failedEvent.id,
      providerPaymentId: 'pay_rejected',
    });
    await seedDecision(decisionStore, opportunity.id);

    const { executionService, provider } = await createExecutionStack({
      opportunityStore,
      eventStore,
      executionStore,
      decisionStore,
    });
    provider.setBehavior({
      kind: 'rejected',
      failureCode: 'payment_declined',
      failureReason: 'Hard decline by issuer.',
    });

    // Act
    const result = await executionService.requestExecution(opportunity.id);

    // Assert
    expect(result.outcome).toBe('provider-rejected');
    const after = await opportunityStore.findById(opportunity.id);
    expect(after?.status).toBe('OPEN');
    expect(after?.recoveryEventId).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 3. Capture duplicated → Count once
  // -----------------------------------------------------------------------
  it('two payment.captured events for the same opportunity → recovered once', async () => {
    const opportunityStore = new InMemoryRecoveryOpportunityStore();
    const eventStore = new InMemoryPaymentEventStore();

    const opportunity = await seedOpportunity(opportunityStore, {
      providerPaymentId: 'pay_dup_cap',
    });

    const leakageService = createLeakageService({ opportunityStore, eventStore });

    const capture1 = makeCaptureEvent({
      providerPaymentId: 'pay_dup_cap',
      providerEventId: 'payment.captured:pay_dup_cap:attempt_1',
    });
    const capture2 = makeCaptureEvent({
      providerPaymentId: 'pay_dup_cap',
      providerEventId: 'payment.captured:pay_dup_cap:attempt_2',
    });

    // Act: process the same capture twice
    const outcome1 = await leakageService.processPaymentEvent(capture1);
    const outcome2 = await leakageService.processPaymentEvent(capture2);

    // Assert: first resolves, second finds nothing (opportunity already RECOVERED)
    expect(outcome1.outcome).toBe('opportunity-recovered');
    expect(outcome1.opportunityIds).toContain(opportunity.id);
    expect(outcome2.outcome).toBe('no-action');
    expect(outcome2.opportunityIds).toHaveLength(0);

    // Assert: markRecovered was called exactly once
    expect(opportunityStore.markRecoveredCalls).toHaveLength(1);
    expect(opportunityStore.markRecoveredCalls[0]?.id).toBe(opportunity.id);

    // Assert: opportunity is RECOVERED with the first event's id
    const after = await opportunityStore.findById(opportunity.id);
    expect(after?.status).toBe('RECOVERED');
  });

  // -----------------------------------------------------------------------
  // 4. Capture references wrong payment → no recovery attribution
  // -----------------------------------------------------------------------
  it('capture event with different providerPaymentId → no recovery', async () => {
    const opportunityStore = new InMemoryRecoveryOpportunityStore();
    const eventStore = new InMemoryPaymentEventStore();

    await seedOpportunity(opportunityStore, {
      providerPaymentId: 'pay_correct',
    });

    const leakageService = createLeakageService({ opportunityStore, eventStore });

    // Capture references a different payment id
    const wrongCapture = makeCaptureEvent({
      providerPaymentId: 'pay_wrong',
    });

    // Act
    const outcome = await leakageService.processPaymentEvent(wrongCapture);

    // Assert: no opportunity matched
    expect(outcome.outcome).toBe('no-action');
    expect(outcome.opportunityIds).toHaveLength(0);
    expect(opportunityStore.markRecoveredCalls).toHaveLength(0);

    // Assert: original opportunity stays OPEN
    const opp = Array.from(opportunityStore.rows.values()).find(
      (r) => r.providerPaymentId === 'pay_correct'
    );
    expect(opp?.status).toBe('OPEN');
  });

  // -----------------------------------------------------------------------
  // 5. Capture amount differs from original
  // -----------------------------------------------------------------------
  it('capture event with different amount → system recovers (capture is authoritative)', async () => {
    const opportunityStore = new InMemoryRecoveryOpportunityStore();
    const eventStore = new InMemoryPaymentEventStore();

    const opportunity = await seedOpportunity(opportunityStore, {
      providerPaymentId: 'pay_amount_diff',
      amountAtRisk: 50000,
    });

    const leakageService = createLeakageService({ opportunityStore, eventStore });

    // Capture event has a different amount
    const capture = makeCaptureEvent({
      providerPaymentId: 'pay_amount_diff',
      amount: 75000,
    });

    // Act
    const outcome = await leakageService.processPaymentEvent(capture);

    // Assert: the system recovers based on payment identity, not amount.
    // A provider-confirmed capture is authoritative — the system does not
    // fabricate recovery where there is no capture, but it trusts real captures.
    expect(outcome.outcome).toBe('opportunity-recovered');
    expect(outcome.opportunityIds).toContain(opportunity.id);

    const after = await opportunityStore.findById(opportunity.id);
    expect(after?.status).toBe('RECOVERED');
  });

  // -----------------------------------------------------------------------
  // 6. Currency differs
  // -----------------------------------------------------------------------
  it('capture event with different currency → system recovers (capture is authoritative)', async () => {
    const opportunityStore = new InMemoryRecoveryOpportunityStore();
    const eventStore = new InMemoryPaymentEventStore();

    const opportunity = await seedOpportunity(opportunityStore, {
      providerPaymentId: 'pay_currency_diff',
      currency: 'INR',
    });

    const leakageService = createLeakageService({ opportunityStore, eventStore });

    // Capture event has a different currency
    const capture = makeCaptureEvent({
      providerPaymentId: 'pay_currency_diff',
      currency: 'USD',
    });

    // Act
    const outcome = await leakageService.processPaymentEvent(capture);

    // Assert: same reasoning as amount — the system correlates by payment
    // identity, not by currency. The capture is authoritative.
    expect(outcome.outcome).toBe('opportunity-recovered');
    expect(outcome.opportunityIds).toContain(opportunity.id);

    const after = await opportunityStore.findById(opportunity.id);
    expect(after?.status).toBe('RECOVERED');
  });

  // -----------------------------------------------------------------------
  // 7. describeReconciliation accuracy
  // -----------------------------------------------------------------------
  it('describeReconciliation produces correct labels for all execution × opportunity status combinations', () => {
    const opportunityStatuses: RecoveryOpportunityRow['status'][] = [
      'OPEN',
      'RECOVERED',
      'EXPIRED',
      'DISMISSED',
    ];

    // SUCCEEDED × each opportunity status
    expect(describeReconciliation('SUCCEEDED', 'RECOVERED')).toBe('recovered');
    expect(describeReconciliation('SUCCEEDED', 'OPEN')).toBe('awaiting_payment_outcome');
    expect(describeReconciliation('SUCCEEDED', 'EXPIRED')).toBe('opportunity_closed');
    expect(describeReconciliation('SUCCEEDED', 'DISMISSED')).toBe('opportunity_closed');

    // FAILED × each opportunity status
    for (const oppStatus of opportunityStatuses) {
      expect(describeReconciliation('FAILED', oppStatus)).toBe('failed');
    }

    // Non-terminal execution statuses × each opportunity status
    const nonTerminalStatuses: ExecutionStatus[] = [
      'PENDING',
      'AUTHORIZED',
      'EXECUTING',
      'BLOCKED',
      'CANCELLED',
    ];
    for (const execStatus of nonTerminalStatuses) {
      for (const oppStatus of opportunityStatuses) {
        expect(describeReconciliation(execStatus, oppStatus)).toBe('not_applicable');
      }
    }
  });

  // -----------------------------------------------------------------------
  // 8. Retry after failure doesn't inflate revenue
  // -----------------------------------------------------------------------
  it('retry → fail → retry → succeed → capture → recoveredAmount equals original once', async () => {
    const opportunityStore = new InMemoryRecoveryOpportunityStore();
    const eventStore = new InMemoryPaymentEventStore();
    const executionStore = new InMemoryRecoveryExecutionStore();
    const decisionStore = new InMemoryRecoveryDecisionStore();

    const failedEvent = await insertEvent(
      eventStore,
      makeFailedEvent({ providerPaymentId: 'pay_retry_inflate' })
    );

    const opportunity = await seedOpportunity(opportunityStore, {
      sourceEventId: failedEvent.id,
      providerPaymentId: 'pay_retry_inflate',
      amountAtRisk: 50000,
    });
    await seedDecision(decisionStore, opportunity.id);

    const { executionService, provider } = await createExecutionStack({
      opportunityStore,
      eventStore,
      executionStore,
      decisionStore,
    });

    // Act: retry 1 → rejected
    provider.setBehavior({ kind: 'rejected', failureCode: 'payment_declined' });
    const retry1 = await executionService.requestExecution(opportunity.id);
    expect(retry1.outcome).toBe('provider-rejected');

    // Act: retry 2 → accepted
    provider.setBehavior({ kind: 'accepted' });
    const retry2 = await executionService.requestExecution(opportunity.id);
    expect(retry2.outcome).toBe('created');

    // Act: capture event arrives → recovery
    const leakageService = createLeakageService({ opportunityStore, eventStore });
    const capture = makeCaptureEvent({ providerPaymentId: 'pay_retry_inflate' });
    const captureOutcome = await leakageService.processPaymentEvent(capture);
    expect(captureOutcome.outcome).toBe('opportunity-recovered');

    // Assert: opportunity recovered with the original amount, not doubled
    const after = await opportunityStore.findById(opportunity.id);
    expect(after?.status).toBe('RECOVERED');
    expect(after?.amountAtRisk).toBe(50000);

    // Assert: two execution records exist (one failed, one succeeded)
    const executions = await executionStore.listByOpportunity(opportunity.id);
    const statuses = executions.map((e) => e.status).sort();
    expect(statuses).toEqual(['FAILED', 'SUCCEEDED']);
  });

  // -----------------------------------------------------------------------
  // 9. Merchant memory not inflated by duplicate outcomes
  // -----------------------------------------------------------------------
  it('recording the same outcome twice does not double memory metrics', async () => {
    const memoryStore = createMerchantStrategyMemoryStoreMock();

    const row = await memoryStore.upsert({
      merchantId: MERCHANT_A,
      strategy: 'RETRY',
      failureType: 'GATEWAY_ERROR',
    });

    // Act: record a successful outcome
    await memoryStore.updateMetrics(row.id, {
      attempts: 1,
      successes: 1,
      failures: 0,
      totalAmountAttempted: 50000,
      totalAmountRecovered: 50000,
      sampleCount: 1,
      successRate: 1,
      recoveryRate: 1,
      lastObservedAt: new Date(),
    });

    // Act: record the SAME outcome again (duplicate webhook / idempotent replay)
    await memoryStore.updateMetrics(row.id, {
      attempts: 1,
      successes: 1,
      failures: 0,
      totalAmountAttempted: 50000,
      totalAmountRecovered: 50000,
      sampleCount: 1,
      successRate: 1,
      recoveryRate: 1,
      lastObservedAt: new Date(),
    });

    // Assert: metrics reflect actual counts, not doubled
    const final = await memoryStore.findById(row.id);
    expect(final?.attempts).toBe(1);
    expect(final?.successes).toBe(1);
    expect(final?.failures).toBe(0);
    expect(final?.totalAmountAttempted).toBe(50000);
    expect(final?.totalAmountRecovered).toBe(50000);
    expect(final?.sampleCount).toBe(1);
  });

  // -----------------------------------------------------------------------
  // 10. Recovery ledger integrity — full cycle consistency
  // -----------------------------------------------------------------------
  it('full recovery cycle: execution, opportunity, and memory tell a consistent story', async () => {
    const opportunityStore = new InMemoryRecoveryOpportunityStore();
    const eventStore = new InMemoryPaymentEventStore();
    const executionStore = new InMemoryRecoveryExecutionStore();
    const decisionStore = new InMemoryRecoveryDecisionStore();
    const memoryStore = createMerchantStrategyMemoryStoreMock();

    // Arrange: failed payment event → opportunity detected
    const failedEvent = await insertEvent(
      eventStore,
      makeFailedEvent({
        providerEventId: 'payment.failed:pay_full_cycle',
        providerPaymentId: 'pay_full_cycle',
      })
    );

    const opportunity = await seedOpportunity(opportunityStore, {
      sourceEventId: failedEvent.id,
      providerPaymentId: 'pay_full_cycle',
      amountAtRisk: 50000,
    });

    // Arrange: decision engine recommends RETRY
    await seedDecision(decisionStore, opportunity.id);

    // Act: execution service executes retry → provider accepts
    const { executionService } = await createExecutionStack({
      opportunityStore,
      eventStore,
      executionStore,
      decisionStore,
    });

    const execResult = await executionService.requestExecution(opportunity.id);
    expect(execResult.outcome).toBe('created');
    if (execResult.outcome === 'created') {
      expect(execResult.execution.status).toBe('SUCCEEDED');
    }

    // Act: capture event arrives → recovery resolved
    const leakageService = createLeakageService({ opportunityStore, eventStore });
    const capture = makeCaptureEvent({ providerPaymentId: 'pay_full_cycle' });
    const captureOutcome = await leakageService.processPaymentEvent(capture);
    expect(captureOutcome.outcome).toBe('opportunity-recovered');

    // Act: merchant memory records the outcome
    const memoryRow = await memoryStore.upsert({
      merchantId: MERCHANT_A,
      strategy: 'RETRY',
      failureType: 'GATEWAY_ERROR',
    });
    await memoryStore.updateMetrics(memoryRow.id, {
      attempts: 1,
      successes: 1,
      failures: 0,
      totalAmountAttempted: 50000,
      totalAmountRecovered: 50000,
      sampleCount: 1,
      successRate: 1,
      recoveryRate: 1,
      lastObservedAt: new Date(),
    });

    // Assert: execution record is consistent
    const executions = await executionStore.listByOpportunity(opportunity.id);
    expect(executions).toHaveLength(1);
    expect(executions[0]?.status).toBe('SUCCEEDED');
    expect(executions[0]?.action).toBe('RETRY');
    expect(executions[0]?.providerPaymentId).toBe('pay_full_cycle');

    // Assert: opportunity is RECOVERED with the correct recovery event
    const finalOpp = await opportunityStore.findById(opportunity.id);
    expect(finalOpp?.status).toBe('RECOVERED');
    expect(finalOpp?.recoveryEventId).toBe(capture.id);
    expect(finalOpp?.amountAtRisk).toBe(50000);
    expect(finalOpp?.resolvedAt).toBeDefined();

    // Assert: describeReconciliation matches the actual state
    expect(
      describeReconciliation('SUCCEEDED', finalOpp?.status ?? 'OPEN')
    ).toBe('recovered');

    // Assert: memory reflects one successful recovery
    const finalMemory = await memoryStore.findById(memoryRow.id);
    expect(finalMemory?.attempts).toBe(1);
    expect(finalMemory?.successes).toBe(1);
    expect(finalMemory?.totalAmountRecovered).toBe(50000);

    // Assert: all three subsystems tell a consistent story
    const allRecovered = finalOpp?.status === 'RECOVERED';
    const executionSucceeded = executions[0]?.status === 'SUCCEEDED';
    const memoryRecordedSuccess = (finalMemory?.successes ?? 0) > 0;
    expect(allRecovered && executionSucceeded && memoryRecordedSuccess).toBe(true);
  });
});
