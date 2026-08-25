import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type {
  NewPaymentEventData,
  PaymentEventRow,
} from '../../src/domain/payment-event.js';
import type { NormalizedPaymentEvent } from '../../src/domain/provider-adapter.js';
import { InternalError } from '../../src/lib/errors.js';
import { PaymentEventRepository } from '../../src/repositories/payment-event.repository.js';

function normalized(overrides: Partial<NormalizedPaymentEvent> = {}): NormalizedPaymentEvent {
  return {
    provider: 'razorpay',
    eventType: 'payment.captured',
    providerEventId: 'payment.captured:pay_123',
    providerPaymentId: 'pay_123',
    providerOrderId: 'order_123',
    amount: 50000,
    currency: 'INR',
    status: 'captured',
    method: 'upi',
    email: 'customer@example.com',
    contact: '+919876543210',
    bank: null,
    errorCode: null,
    errorDescription: null,
    errorSource: null,
    errorStep: null,
    errorReason: null,
    providerAccountId: 'acc_123456',
    subscriptionId: null,
    paymentCreatedAt: new Date(1690000000 * 1000),
    occurredAt: new Date(1690000100 * 1000),
    ...overrides,
  };
}

function persistedRow(data: NewPaymentEventData): PaymentEventRow {
  return { ...data, id: 'event-row-id', createdAt: new Date(), updatedAt: new Date() };
}

function existingRow(overrides: Partial<PaymentEventRow> = {}): PaymentEventRow {
  return {
    id: 'existing-row-id',
    paymentAccountId: null,
    merchantId: null,
    provider: 'razorpay',
    providerEventId: 'payment.captured:pay_123',
    eventType: 'payment.captured',
    providerPaymentId: 'pay_123',
    providerOrderId: null,
    eventCreatedAt: new Date(),
    receivedAt: new Date(),
    payload: {},
    normalizedData: null,
    signatureVerified: true,
    processingStatus: 'processed',
    processingAttempts: 1,
    processedAt: new Date(),
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const VALID_RAW_PAYLOAD = { event: 'payment.captured', payload: {} };

function makeStores() {
  const events = {
    insert: vi.fn(async (data: NewPaymentEventData) => persistedRow(data)),
    findByProviderEventId: vi.fn(
      async (): Promise<PaymentEventRow | null> => null
    ),
    findById: vi.fn(async (): Promise<PaymentEventRow | null> => null),
    findRelatedByOrderOrPayment: vi.fn(async (): Promise<PaymentEventRow[]> => []),
  };
  const accounts = {
    findActiveByExternalId: vi.fn(
      async (): Promise<{ id: string; merchantId: string } | null> => null
    ),
    findById: vi.fn(async (): Promise<{ id: string; merchantId: string } | null> => null),
  };
  return { events, accounts };
}

describe('PaymentEventRepository', () => {
  it('persists a new event and maps the normalized data to JSON-safe values', async () => {
    const stores = makeStores();
    const repository = new PaymentEventRepository(stores.events, stores.accounts);

    const result = await repository.persistEvent({
      normalized: normalized(),
      rawPayload: VALID_RAW_PAYLOAD,
      paymentAccountId: 'account-1',
      merchantId: 'merchant-1',
    });

    expect(result.isNew).toBe(true);
    expect(result.event.id).toBe('event-row-id');

    const inserted = vi.mocked(stores.events.insert).mock.calls[0]?.[0];
    expect(inserted).toMatchObject({
      provider: 'razorpay',
      providerEventId: 'payment.captured:pay_123',
      eventType: 'payment.captured',
      providerPaymentId: 'pay_123',
      providerOrderId: 'order_123',
      eventCreatedAt: new Date(1690000100 * 1000),
      paymentAccountId: 'account-1',
      merchantId: 'merchant-1',
      signatureVerified: true,
      processingStatus: 'processed',
      processingAttempts: 1,
    });
    expect(inserted?.processedAt).toBeInstanceOf(Date);
    // JSONB-safe normalized payload: dates serialized as ISO strings.
    expect(inserted?.normalizedData).toEqual({
      provider: 'razorpay',
      eventType: 'payment.captured',
      providerPaymentId: 'pay_123',
      providerOrderId: 'order_123',
      amount: 50000,
      currency: 'INR',
      status: 'captured',
      method: 'upi',
      email: 'customer@example.com',
      contact: '+919876543210',
      bank: null,
      errorCode: null,
      errorDescription: null,
      errorSource: null,
      errorStep: null,
      errorReason: null,
      subscriptionId: null,
      paymentCreatedAt: new Date(1690000000 * 1000).toISOString(),
      occurredAt: new Date(1690000100 * 1000).toISOString(),
    });
  });

  it('returns the existing row when insertion hits the unique constraint', async () => {
    const stores = makeStores();
    stores.events.insert.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      })
    );
    stores.events.findByProviderEventId.mockResolvedValue(existingRow());
    const repository = new PaymentEventRepository(stores.events, stores.accounts);

    const result = await repository.persistEvent({
      normalized: normalized(),
      rawPayload: VALID_RAW_PAYLOAD,
      paymentAccountId: null,
      merchantId: null,
    });

    expect(result.isNew).toBe(false);
    expect(result.event.id).toBe('existing-row-id');
    expect(stores.events.findByProviderEventId).toHaveBeenCalledWith(
      'razorpay',
      'payment.captured:pay_123'
    );
  });

  it('wraps non-constraint store failures in InternalError with the cause', async () => {
    const stores = makeStores();
    stores.events.insert.mockRejectedValue(new Error('connection refused'));
    const repository = new PaymentEventRepository(stores.events, stores.accounts);

    const promise = repository.persistEvent({
      normalized: normalized(),
      rawPayload: VALID_RAW_PAYLOAD,
      paymentAccountId: null,
      merchantId: null,
    });

    await expect(promise).rejects.toBeInstanceOf(InternalError);
    await promise.catch((error: InternalError) => {
      expect(error.cause).toBeInstanceOf(Error);
      expect((error.cause as Error).message).toBe('connection refused');
    });
  });

  it('resolves accounts through the account lookup store', async () => {
    const stores = makeStores();
    stores.accounts.findActiveByExternalId.mockResolvedValue({
      id: 'account-1',
      merchantId: 'merchant-1',
    });
    stores.accounts.findById.mockResolvedValue({
      id: 'account-2',
      merchantId: 'merchant-2',
    });
    const repository = new PaymentEventRepository(stores.events, stores.accounts);

    await expect(repository.findAccountByExternalId('razorpay', 'acc_X')).resolves.toEqual({
      id: 'account-1',
      merchantId: 'merchant-1',
    });
    await expect(repository.findAccountById('account-2')).resolves.toEqual({
      id: 'account-2',
      merchantId: 'merchant-2',
    });
  });
});
