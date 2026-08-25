import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RazorpayAdapter } from '../../src/adapters/razorpay.js';
import { InternalError, ValidationError } from '../../src/lib/errors.js';
import {
  createAccountLookupStoreMock,
  createPaymentEventStoreMock,
} from '../helpers.js';
import { PaymentEventRepository } from '../../src/repositories/payment-event.repository.js';
import { WebhookService, type WebhookServiceConfig } from '../../src/services/webhook.service.js';
import {
  generateSignature,
  MALFORMED_PAYLOAD_MISSING_EVENT,
  PAYMENT_CAPTURED_PAYLOAD,
  PAYMENT_FAILED_PAYLOAD,
  UNSUPPORTED_EVENT_PAYLOAD,
  WEBHOOK_SECRET,
} from '../fixtures/razorpay.js';

interface ServiceHarness {
  service: WebhookService;
  accountLookup: ReturnType<typeof createAccountLookupStoreMock>;
  eventStore: ReturnType<typeof createPaymentEventStoreMock>;
}

function makeService(
  options: {
    config?: Partial<WebhookServiceConfig>;
    eventStoreOverrides?: Parameters<typeof createPaymentEventStoreMock>[0];
    accountOverrides?: Parameters<typeof createAccountLookupStoreMock>[0];
  } = {}
): ServiceHarness {
  const adapter = new RazorpayAdapter();
  const eventStore = createPaymentEventStoreMock(options.eventStoreOverrides);
  const accountLookup = createAccountLookupStoreMock(options.accountOverrides);
  const repository = new PaymentEventRepository(eventStore, accountLookup);
  const config: WebhookServiceConfig = {
    razorpayWebhookSecret: WEBHOOK_SECRET,
    ...options.config,
  };
  return { service: new WebhookService(adapter, repository, config), accountLookup, eventStore };
}

function webhookInput(payload: unknown) {
  const body = JSON.stringify(payload);
  return {
    rawBody: Buffer.from(body),
    signature: generateSignature(WEBHOOK_SECRET, body),
    payload,
  };
}

describe('WebhookService', () => {
  it('processes a valid payment.captured webhook and persists it', async () => {
    const { service, eventStore } = makeService();

    const result = await service.processWebhook(webhookInput(PAYMENT_CAPTURED_PAYLOAD));

    expect(result).toMatchObject({
      status: 'processed',
      isNew: true,
      eventType: 'payment.captured',
    });
    expect(result.eventId).toBe(result.eventId);
    expect(eventStore.insert).toHaveBeenCalledTimes(1);
    const inserted = vi.mocked(eventStore.insert).mock.calls[0]?.[0];
    expect(inserted?.providerEventId).toBe('payment.captured:pay_GHIjklMnOp');
    expect(inserted?.processingStatus).toBe('processed');
    expect(inserted?.processedAt).toBeInstanceOf(Date);
  });

  it('reports duplicate status when the same event is replayed', async () => {
    const existingId = '11111111-1111-4111-8111-111111111111';
    const { service } = makeService({
      eventStoreOverrides: {
        insert: vi.fn(async () => {
          throw new Prisma.PrismaClientKnownRequestError(
            'Unique constraint failed on the fields (provider,providerEventId)',
            { code: 'P2002', clientVersion: 'test' }
          );
        }),
        findByProviderEventId: vi.fn(async () => ({
          id: existingId,
          paymentAccountId: null,
          merchantId: null,
          provider: 'razorpay' as const,
          providerEventId: 'payment.captured:pay_GHIjklMnOp',
          eventType: 'payment.captured',
          providerPaymentId: 'pay_GHIjklMnOp',
          providerOrderId: null,
          eventCreatedAt: new Date(),
          receivedAt: new Date(),
          payload: {},
          normalizedData: null,
          signatureVerified: true,
          processingStatus: 'processed' as const,
          processingAttempts: 1,
          processedAt: new Date(),
          failureReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      },
    });

    const result = await service.processWebhook(webhookInput(PAYMENT_CAPTURED_PAYLOAD));

    expect(result.status).toBe('duplicate');
    expect(result.isNew).toBe(false);
    expect(result.eventId).toBe(existingId);
  });

  it('throws ValidationError for an invalid signature', async () => {
    const { service } = makeService();

    await expect(
      service.processWebhook({
        rawBody: Buffer.from(JSON.stringify(PAYMENT_CAPTURED_PAYLOAD)),
        signature: 'invalid_signature',
        payload: PAYMENT_CAPTURED_PAYLOAD,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for a modified payload carrying the original signature', async () => {
    const { service } = makeService();

    const originalBody = JSON.stringify(PAYMENT_CAPTURED_PAYLOAD);
    const modifiedBody = JSON.stringify({ ...PAYMENT_CAPTURED_PAYLOAD, event: 'payment.failed' });

    await expect(
      service.processWebhook({
        rawBody: Buffer.from(modifiedBody),
        signature: generateSignature(WEBHOOK_SECRET, originalBody),
        payload: { ...PAYMENT_CAPTURED_PAYLOAD, event: 'payment.failed' },
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for a malformed payload', async () => {
    const { service } = makeService();

    await expect(service.processWebhook(webhookInput(MALFORMED_PAYLOAD_MISSING_EVENT))).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('acknowledges unsupported events without persisting anything', async () => {
    const { service, eventStore } = makeService();

    const result = await service.processWebhook(webhookInput(UNSUPPORTED_EVENT_PAYLOAD));

    expect(result.status).toBe('unsupported');
    expect(result.isNew).toBe(false);
    expect(result.eventType).toBe('refund.created');
    expect(eventStore.insert).not.toHaveBeenCalled();
  });

  it('resolves the payment account from the envelope account_id', async () => {
    const accountRef = { id: 'account-uuid-456', merchantId: 'merchant-uuid-789' };
    const { service, accountLookup, eventStore } = makeService({
      accountOverrides: {
        findActiveByExternalId: vi.fn(async () => accountRef),
      },
    });

    await service.processWebhook(webhookInput(PAYMENT_CAPTURED_PAYLOAD));

    expect(accountLookup.findActiveByExternalId).toHaveBeenCalledWith('razorpay', 'acc_123456');
    const inserted = vi.mocked(eventStore.insert).mock.calls[0]?.[0];
    expect(inserted?.paymentAccountId).toBe('account-uuid-456');
    expect(inserted?.merchantId).toBe('merchant-uuid-789');
  });

  it('falls back to the configured default test payment account by id', async () => {
    const accountRef = { id: 'fallback-account-uuid', merchantId: 'fallback-merchant-uuid' };
    const { service, accountLookup } = makeService({
      config: { defaultTestPaymentAccountId: 'fallback-account-uuid' },
      accountOverrides: {
        findActiveByExternalId: vi.fn(async () => null),
        findById: vi.fn(async () => accountRef),
      },
    });

    const payloadWithoutAccountId = { ...PAYMENT_CAPTURED_PAYLOAD, account_id: undefined };

    await service.processWebhook(webhookInput(payloadWithoutAccountId));

    expect(accountLookup.findById).toHaveBeenCalledWith('fallback-account-uuid');
  });

  it('persists events with null account linkage when resolution fails', async () => {
    const { service, eventStore } = makeService();

    await service.processWebhook(webhookInput(PAYMENT_CAPTURED_PAYLOAD));

    const inserted = vi.mocked(eventStore.insert).mock.calls[0]?.[0];
    expect(inserted?.paymentAccountId).toBeNull();
    expect(inserted?.merchantId).toBeNull();
  });

  it('processes payment.failed webhooks with error details', async () => {
    const { service } = makeService();

    const result = await service.processWebhook(webhookInput(PAYMENT_FAILED_PAYLOAD));

    expect(result.status).toBe('processed');
    expect(result.eventType).toBe('payment.failed');
  });

  it('fails closed with InternalError when no secret is configured', async () => {
    const { service } = makeService({ config: { razorpayWebhookSecret: undefined } });

    await expect(service.processWebhook(webhookInput(PAYMENT_CAPTURED_PAYLOAD))).rejects.toBeInstanceOf(
      InternalError
    );
  });
});
