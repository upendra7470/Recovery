import { randomUUID } from 'node:crypto';
import type {
  NormalizedPaymentEventData,
  PaymentEventProcessingStatus,
  PaymentEventRow,
} from '../../src/domain/payment-event.js';

export function normalizedData(overrides: Partial<NormalizedPaymentEventData> = {}): NormalizedPaymentEventData {
  return {
    provider: 'razorpay',
    eventType: 'payment.failed',
    providerPaymentId: 'pay_test_failed_1',
    providerOrderId: 'order_test_1',
    amount: 249900,
    currency: 'INR',
    status: 'failed',
    method: 'upi',
    email: 'customer@example.com',
    contact: '+919876543210',
    bank: null,
    errorCode: 'PAYMENT_DECLINED',
    errorDescription: 'Payment declined by issuer.',
    errorSource: 'bank',
    errorStep: 'payment_authentication',
    errorReason: 'declined',
    subscriptionId: null,
    paymentCreatedAt: '2026-08-25T10:00:00.000Z',
    occurredAt: '2026-08-25T10:00:05.000Z',
    ...overrides,
  };
}

export function makeEventRow(overrides: {
  id?: string;
  eventType?: string;
  merchantId?: string | null;
  paymentAccountId?: string | null;
  providerPaymentId?: string | null;
  providerOrderId?: string | null;
  eventCreatedAt?: Date;
  normalizedData?: Partial<NormalizedPaymentEventData>;
} = {}): PaymentEventRow {
  const data = normalizedData({
    ...(overrides.eventType !== undefined ? { eventType: overrides.eventType } : {}),
    ...(overrides.providerPaymentId !== undefined
      ? { providerPaymentId: overrides.providerPaymentId }
      : {}),
    ...(overrides.providerOrderId !== undefined
      ? { providerOrderId: overrides.providerOrderId }
      : {}),
    ...(overrides.normalizedData !== undefined ? overrides.normalizedData : {}),
  });
  return {
    id: overrides.id ?? randomUUID(),
    paymentAccountId: overrides.paymentAccountId ?? null,
    merchantId: overrides.merchantId ?? null,
    provider: 'razorpay',
    providerEventId: `${data.eventType}:${data.providerPaymentId ?? 'unknown'}`,
    eventType: data.eventType,
    providerPaymentId: data.providerPaymentId,
    providerOrderId: data.providerOrderId,
    eventCreatedAt: overrides.eventCreatedAt ?? new Date('2026-08-25T10:00:05.000Z'),
    receivedAt: new Date('2026-08-25T10:00:06.000Z'),
    payload: {},
    normalizedData: data,
    signatureVerified: true,
    processingStatus: 'processed' satisfies PaymentEventProcessingStatus,
    processingAttempts: 1,
    processedAt: new Date('2026-08-25T10:00:06.000Z'),
    failureReason: null,
    createdAt: new Date('2026-08-25T10:00:06.000Z'),
    updatedAt: new Date('2026-08-25T10:00:06.000Z'),
  };
}
