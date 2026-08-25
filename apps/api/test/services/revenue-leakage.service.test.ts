import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  createDefaultDetectionRules,
  RevenueLeakageDetector,
} from '../../src/detection/revenue-leakage.detector.js';
import {
  InMemoryPaymentEventStore,
  InMemoryRecoveryOpportunityStore,
} from '../helpers.js';
import type { NormalizedPaymentEventData, PaymentEventRow } from '../../src/domain/payment-event.js';
import { RecoveryOpportunityRepository } from '../../src/repositories/recovery-opportunity.repository.js';
import { RevenueLeakageService } from '../../src/services/revenue-leakage.service.js';
import { makeEventRow } from '../fixtures/payment-events.js';

const MERCHANT_A = '11111111-1111-4111-8111-111111111111';
const MERCHANT_B = '22222222-2222-4222-8222-222222222222';
const WINDOW = { windowMs: 24 * 60 * 60 * 1000 };

function makeService(seedEvents: readonly PaymentEventRow[] = []) {
  const detector = new RevenueLeakageDetector(createDefaultDetectionRules());
  const opportunityStore = new InMemoryRecoveryOpportunityStore();
  const eventStore = new InMemoryPaymentEventStore();
  for (const event of seedEvents) {
    void eventStore.insert({
      paymentAccountId: event.paymentAccountId,
      merchantId: event.merchantId,
      provider: event.provider,
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      providerPaymentId: event.providerPaymentId,
      providerOrderId: event.providerOrderId,
      eventCreatedAt: event.eventCreatedAt,
      receivedAt: event.receivedAt,
      payload: event.payload as Prisma.InputJsonValue,
      normalizedData: event.normalizedData as NormalizedPaymentEventData,
      signatureVerified: event.signatureVerified,
      processingStatus: event.processingStatus,
      processingAttempts: event.processingAttempts,
      processedAt: event.processedAt,
      failureReason: event.failureReason,
    });
  }
  const repository = new RecoveryOpportunityRepository(opportunityStore);
  const service = new RevenueLeakageService(detector, repository, eventStore, WINDOW);
  return { service, opportunityStore, eventStore };
}

function onlyOpportunity(store: InMemoryRecoveryOpportunityStore) {
  expect(store.rows.size).toBe(1);
  return [...store.rows.values()][0]!;
}

describe('RevenueLeakageService', () => {
  it('creates an opportunity with amount, currency, reason and evidence from the source event', async () => {
    const { service, opportunityStore } = makeService();
    const failed = makeEventRow({
      eventType: 'payment.failed',
      merchantId: MERCHANT_A,
      normalizedData: { errorCode: 'PAYMENT_DECLINED' },
    });

    const outcome = await service.processPaymentEvent(failed);

    expect(outcome.outcome).toBe('opportunity-created');
    const opportunity = onlyOpportunity(opportunityStore);
    expect(opportunity.type).toBe('FAILED_PAYMENT');
    expect(opportunity.status).toBe('OPEN');
    expect(opportunity.amountAtRisk).toBe(249900);
    expect(opportunity.currency).toBe('INR');
    expect(opportunity.reason).toContain('no successful payment');
    // Attribution flows only from the source event (tenant isolation).
    expect(opportunity.merchantId).toBe(MERCHANT_A);
    expect(opportunity.paymentAccountId).toBeNull();
    const evidence = opportunity.evidence as Record<string, unknown>;
    expect(evidence['amount']).toBe(249900);
    expect(evidence['failureCode']).toBe('PAYMENT_DECLINED');
    expect(evidence['sourceEventId']).toBe(failed.id);
  });

  it('is idempotent: processing the same event twice yields one opportunity', async () => {
    const { service, opportunityStore } = makeService();
    const failed = makeEventRow({ eventType: 'payment.failed' });

    await service.processPaymentEvent(failed);
    const second = await service.processPaymentEvent(failed);

    expect(second.outcome).toBe('no-action');
    expect(opportunityStore.rows.size).toBe(1);
  });

  it('processes batches and stays idempotent across replays', async () => {
    const { service, opportunityStore } = makeService();
    const events = [
      makeEventRow({ eventType: 'payment.failed', providerPaymentId: 'pay_b1', providerOrderId: 'order_b1' }),
      makeEventRow({ eventType: 'payment.failed', providerPaymentId: 'pay_b2', providerOrderId: 'order_b2' }),
      makeEventRow({ eventType: 'payment.failed', providerPaymentId: 'pay_b3', providerOrderId: 'order_b3' }),
    ];

    const outcomes = await service.processPaymentEvents(events);
    const replays = await service.processPaymentEvents(events);

    expect(outcomes.every((o) => o.outcome === 'opportunity-created')).toBe(true);
    expect(replays.every((o) => o.outcome === 'no-action')).toBe(true);
    expect(opportunityStore.rows.size).toBe(3);
  });

  it('does not create an opportunity when a captured retry exists in the window', async () => {
    const failedAt = new Date('2026-08-25T10:00:00.000Z');
    const capturedRetry = makeEventRow({
      eventType: 'payment.captured',
      providerOrderId: 'order_test_1',
      providerPaymentId: 'pay_retry_ok',
      eventCreatedAt: new Date(failedAt.getTime() + 60 * 60 * 1000),
    });
    const { service, opportunityStore } = makeService([capturedRetry]);
    const failed = makeEventRow({
      eventType: 'payment.failed',
      eventCreatedAt: failedAt,
    });

    const outcome = await service.processPaymentEvent(failed);

    expect(outcome.outcome).toBe('no-action');
    expect(opportunityStore.rows.size).toBe(0);
  });
});

describe('RevenueLeakageService recovery resolution', () => {
  it('marks an existing open opportunity as recovered when a capture follows', async () => {
    const failedAt = new Date('2026-08-25T10:00:00.000Z');
    const failed = makeEventRow({
      eventType: 'payment.failed',
      merchantId: MERCHANT_A,
      providerOrderId: 'order_recover_1',
      eventCreatedAt: failedAt,
    });
    const { service, opportunityStore } = makeService();
    await service.processPaymentEvent(failed);

    const captured = makeEventRow({
      eventType: 'payment.captured',
      merchantId: MERCHANT_A,
      providerOrderId: 'order_recover_1',
      providerPaymentId: 'pay_retry_success',
      eventCreatedAt: new Date(failedAt.getTime() + 30 * 60 * 1000),
    });
    const outcome = await service.processPaymentEvent(captured);

    expect(outcome.outcome).toBe('opportunity-recovered');
    const opportunity = onlyOpportunity(opportunityStore);
    expect(opportunity.status).toBe('RECOVERED');
    expect(opportunity.recoveryEventId).toBe(captured.id);
    expect(opportunity.resolvedAt).toBeInstanceOf(Date);
  });

  it('never lets merchant B capture events touch merchant A opportunities', async () => {
    const failedAt = new Date('2026-08-25T10:00:00.000Z');
    const failedA = makeEventRow({
      eventType: 'payment.failed',
      merchantId: MERCHANT_A,
      providerOrderId: 'order_shared_1',
      eventCreatedAt: failedAt,
    });
    const { service, opportunityStore } = makeService();
    await service.processPaymentEvent(failedA);

    const capturedB = makeEventRow({
      eventType: 'payment.captured',
      merchantId: MERCHANT_B,
      providerOrderId: 'order_shared_1',
      eventCreatedAt: new Date(failedAt.getTime() + 30 * 60 * 1000),
    });
    const outcome = await service.processPaymentEvent(capturedB);

    expect(outcome.outcome).toBe('no-action');
    const opportunity = onlyOpportunity(opportunityStore);
    expect(opportunity.status).toBe('OPEN');
    expect(opportunity.merchantId).toBe(MERCHANT_A);
    expect(opportunity.recoveryEventId).toBeNull();
  });
});

describe('RevenueLeakageService checkout drop-off', () => {
  it('creates an expiring opportunity for an uncaptured authorization', async () => {
    const { service, opportunityStore } = makeService();
    const authorized = makeEventRow({
      eventType: 'payment.authorized',
      providerPaymentId: 'pay_auth_only',
      eventCreatedAt: new Date('2026-08-25T12:00:00.000Z'),
    });

    const outcome = await service.processPaymentEvent(authorized);

    expect(outcome.outcome).toBe('opportunity-created');
    const opportunity = onlyOpportunity(opportunityStore);
    expect(opportunity.type).toBe('CHECKOUT_DROPOFF');
    expect(opportunity.expiresAt).toEqual(
      new Date(authorized.eventCreatedAt.getTime() + WINDOW.windowMs)
    );
  });

  it('resolves the drop-off opportunity when the capture arrives', async () => {
    const authorizedAt = new Date('2026-08-25T12:00:00.000Z');
    const authorized = makeEventRow({
      eventType: 'payment.authorized',
      providerPaymentId: 'pay_flow_ok',
      eventCreatedAt: authorizedAt,
    });
    const { service, opportunityStore } = makeService();
    await service.processPaymentEvent(authorized);

    const captured = makeEventRow({
      eventType: 'payment.captured',
      providerPaymentId: 'pay_flow_ok',
      eventCreatedAt: new Date(authorizedAt.getTime() + 5000),
    });
    const outcome = await service.processPaymentEvent(captured);

    expect(outcome.outcome).toBe('opportunity-recovered');
    const opportunity = onlyOpportunity(opportunityStore);
    expect(opportunity.status).toBe('RECOVERED');
  });
});

describe('RevenueLeakageService safety', () => {
  it('skips unsupported providers safely', async () => {
    const { service, opportunityStore } = makeService();
    const event = { ...makeEventRow(), provider: 'stripe' as never };
    const outcome = await service.processPaymentEvent(event);
    expect(outcome.outcome).toBe('skipped');
    expect(opportunityStore.rows.size).toBe(0);
  });

  it('skips unrelated event types', async () => {
    const { service, opportunityStore } = makeService();
    const outcome = await service.processPaymentEvent(makeEventRow({ eventType: 'refund.created' }));
    expect(outcome.outcome).toBe('skipped');
    expect(opportunityStore.rows.size).toBe(0);
  });

  it('takes no action for failures missing an amount (never invents money)', async () => {
    const { service, opportunityStore } = makeService();
    const outcome = await service.processPaymentEvent(
      makeEventRow({ eventType: 'payment.failed', normalizedData: { amount: null } })
    );
    expect(outcome.outcome).toBe('no-action');
    expect(opportunityStore.rows.size).toBe(0);
  });

  it('routes subscription failures to their own category without duplicating', async () => {
    const { service, opportunityStore } = makeService();
    const outcome = await service.processPaymentEvent(
      makeEventRow({
        eventType: 'payment.failed',
        normalizedData: { subscriptionId: 'sub_123' },
      })
    );
    expect(outcome.outcome).toBe('opportunity-created');
    expect(opportunityStore.rows.size).toBe(1);
    expect(onlyOpportunity(opportunityStore).type).toBe('SUBSCRIPTION_PAYMENT_FAILED');
  });

  it('takes no action for captures with no matching open opportunities', async () => {
    const { service } = makeService();
    const outcome = await service.processPaymentEvent(
      makeEventRow({ eventType: 'payment.captured', providerPaymentId: 'pay_never_failed' })
    );
    expect(outcome.outcome).toBe('no-action');
  });
});
