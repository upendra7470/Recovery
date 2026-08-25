import { describe, expect, it } from 'vitest';
import type { PaymentEventRow } from '../../src/domain/payment-event.js';
import type { DetectionFinding } from '../../src/detection/detection-rule.js';
import {
  InMemoryRecoveryOpportunityStore,
} from '../helpers.js';
import { RecoveryOpportunityRepository } from '../../src/repositories/recovery-opportunity.repository.js';
import { makeEventRow } from '../fixtures/payment-events.js';

const MERCHANT_A = '11111111-1111-4111-8111-111111111111';
const MERCHANT_B = '22222222-2222-4222-8222-222222222222';
const DETECTED_AT = new Date('2026-08-25T10:00:10.000Z');

function sourceEvent(overrides: Partial<PaymentEventRow> = {}): PaymentEventRow {
  return makeEventRow({
    ...overrides,
    merchantId: overrides.merchantId ?? MERCHANT_A,
    normalizedData: { amount: 249900, currency: 'INR', errorCode: 'PAYMENT_DECLINED' },
  });
}

function makeFinding(overrides: Partial<DetectionFinding> = {}): DetectionFinding {
  return {
    type: 'FAILED_PAYMENT',
    reason: 'Customer attempted to pay but no successful payment was observed.',
    evidence: {
      sourceEventId: 'evt_001',
      providerPaymentId: 'pay_test_1',
      providerOrderId: 'order_test_1',
      eventType: 'payment.failed',
      amount: 249900,
      currency: 'INR',
      occurredAt: '2026-08-25T10:00:05.000Z',
      failureCode: 'PAYMENT_DECLINED',
    },
    expiresAt: null,
    ...overrides,
  };
}

describe('RecoveryOpportunityRepository', () => {
  it('creates an opportunity mapping all fields from the finding and source event', async () => {
    const store = new InMemoryRecoveryOpportunityStore();
    const repo = new RecoveryOpportunityRepository(store);
    const event = sourceEvent();
    const finding = makeFinding();

    const result = await repo.createFromFinding({
      finding,
      sourceEvent: event,
      detectedAt: DETECTED_AT,
    });

    expect(result.isNew).toBe(true);
    expect(store.rows.size).toBe(1);
    const row = [...store.rows.values()][0]!;
    expect(row.id).toBe(result.opportunity.id);
    expect(row.sourceEventId).toBe(event.id);
    expect(row.type).toBe('FAILED_PAYMENT');
    expect(row.status).toBe('OPEN');
    expect(row.amountAtRisk).toBe(249900);
    expect(row.currency).toBe('INR');
    expect(row.merchantId).toBe(MERCHANT_A);
    expect(row.paymentAccountId).toBeNull();
    expect(row.providerPaymentId).toBe('pay_test_1');
    expect(row.providerOrderId).toBe('order_test_1');
    expect(row.reason).toContain('no successful payment');
    expect(row.evidence).toBeDefined();
    expect(row.detectedAt).toEqual(DETECTED_AT);
    expect(row.expiresAt).toBeNull();
    expect(row.recoveryEventId).toBeNull();
    expect(row.resolvedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  it('maps the expiration window from findings that carry an expiry', async () => {
    const store = new InMemoryRecoveryOpportunityStore();
    const repo = new RecoveryOpportunityRepository(store);
    const expiresAt = new Date('2026-08-26T10:00:00.000Z');

    await repo.createFromFinding({
      finding: makeFinding({ type: 'CHECKOUT_DROPOFF', expiresAt }),
      sourceEvent: sourceEvent(),
      detectedAt: DETECTED_AT,
    });

    const row = [...store.rows.values()][0]!;
    expect(row.type).toBe('CHECKOUT_DROPOFF');
    expect(row.expiresAt).toEqual(expiresAt);
  });

  it('attributes merchant and account only from the source event', async () => {
    const store = new InMemoryRecoveryOpportunityStore();
    const repo = new RecoveryOpportunityRepository(store);
    const event = sourceEvent({ merchantId: MERCHANT_B, paymentAccountId: 'acct_456' });

    await repo.createFromFinding({
      finding: makeFinding(),
      sourceEvent: event,
      detectedAt: DETECTED_AT,
    });

    const row = [...store.rows.values()][0]!;
    expect(row.merchantId).toBe(MERCHANT_B);
    expect(row.paymentAccountId).toBe('acct_456');
  });

  describe('P2002 idempotency', () => {
    it('falls back to a lookup and returns isNew false when a duplicate is detected', async () => {
      const store = new InMemoryRecoveryOpportunityStore();
      const event = sourceEvent();
      // Pre-insert a row for the same (source event, type) pair so the fallback
      // lookup finds the winning row after the P2002.
      const preExisting = await store.insert({
        sourceEventId: event.id,
        type: 'FAILED_PAYMENT',
        status: 'OPEN',
        amountAtRisk: 10000,
        currency: 'INR',
        reason: 'Pre-existing',
        evidence: {},
        merchantId: null,
        paymentAccountId: null,
        providerPaymentId: null,
        providerOrderId: null,
        detectedAt: DETECTED_AT,
        expiresAt: null,
        resolvedAt: null,
        recoveryEventId: null,
      });
      store.duplicateKey = true;
      const repo = new RecoveryOpportunityRepository(store);
      const finding = makeFinding();

      const result = await repo.createFromFinding({
        finding,
        sourceEvent: event,
        detectedAt: DETECTED_AT,
      });

      expect(result.isNew).toBe(false);
      expect(result.opportunity.id).toBe(preExisting.id);
    });

    it('throws an InternalError for unexpected persistence failures', async () => {
      const store = new InMemoryRecoveryOpportunityStore();
      store.insertError = new Error('connection refused');
      const repo = new RecoveryOpportunityRepository(store);

      await expect(
        repo.createFromFinding({
          finding: makeFinding(),
          sourceEvent: sourceEvent(),
          detectedAt: DETECTED_AT,
        })
      ).rejects.toThrow('Failed to persist recovery opportunity');
    });
  });

  describe('markRecovered', () => {
    it('delegates to the store with a resolved timestamp', async () => {
      const store = new InMemoryRecoveryOpportunityStore();
      const repo = new RecoveryOpportunityRepository(store);
      const inserted = await store.insert({
        sourceEventId: 'evt_recover',
        type: 'FAILED_PAYMENT',
        status: 'OPEN',
        amountAtRisk: 10000,
        currency: 'INR',
        reason: 'Test',
        evidence: {},
        merchantId: null,
        paymentAccountId: null,
        providerPaymentId: null,
        providerOrderId: null,
        detectedAt: DETECTED_AT,
        expiresAt: null,
        resolvedAt: null,
        recoveryEventId: null,
      });
      const resolvedAt = new Date();

      await repo.markRecovered({ id: inserted.id, recoveryEventId: 'evt_capture_1', resolvedAt });

      expect(store.markRecoveredCalls).toEqual([
        { id: inserted.id, recoveryEventId: 'evt_capture_1', resolvedAt },
      ]);
    });
  });
});
