
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
  PAYMENT_CAPTURED_PAYLOAD,
  UNSUPPORTED_EVENT_PAYLOAD,
  WEBHOOK_SECRET,
} from '../fixtures/razorpay.js';

interface ServiceHarness {
  service: WebhookService;
  repository: PaymentEventRepository;
  eventStore: ReturnType<typeof createPaymentEventStoreMock>;
  accountLookup: ReturnType<typeof createAccountLookupStoreMock>;
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
  return {
    service: new WebhookService(adapter, repository, config),
    repository,
    eventStore,
    accountLookup,
  };
}

function signPayload(payload: unknown, secret: string = WEBHOOK_SECRET) {
  const body = JSON.stringify(payload);
  return { body, signature: generateSignature(secret, body) };
}

describe('Webhook security scenarios', () => {
  it('1. rejects a webhook with no X-Razorpay-Signature header', async () => {
    const { service } = makeService();
    const { body } = signPayload(PAYMENT_CAPTURED_PAYLOAD);

    await expect(
      service.processWebhook({
        rawBody: Buffer.from(body),
        signature: '',
        payload: PAYMENT_CAPTURED_PAYLOAD,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('2. rejects a webhook with an invalid signature', async () => {
    const { service } = makeService();
    const { body } = signPayload(PAYMENT_CAPTURED_PAYLOAD);

    await expect(
      service.processWebhook({
        rawBody: Buffer.from(body),
        signature: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        payload: PAYMENT_CAPTURED_PAYLOAD,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('3. rejects a webhook with a valid signature but modified payload', async () => {
    const { service } = makeService();
    const originalBody = JSON.stringify(PAYMENT_CAPTURED_PAYLOAD);
    const signature = generateSignature(WEBHOOK_SECRET, originalBody);
    const modifiedPayload = { ...PAYMENT_CAPTURED_PAYLOAD, event: 'payment.failed' };
    const modifiedBody = JSON.stringify(modifiedPayload);

    await expect(
      service.processWebhook({
        rawBody: Buffer.from(modifiedBody),
        signature,
        payload: modifiedPayload,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('4. rejects a non-JSON body', async () => {
    const { service } = makeService();
    const rawBody = Buffer.from('this is not json');
    const signature = generateSignature(WEBHOOK_SECRET, 'this is not json');

    await expect(
      service.processWebhook({
        rawBody,
        signature,
        payload: 'this is not json',
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('5. handles duplicate webhooks idempotently', async () => {
    const { service, eventStore } = makeService();

    const { body, signature } = signPayload(PAYMENT_CAPTURED_PAYLOAD);
    const rawBody = Buffer.from(body);

    const firstResult = await service.processWebhook({
      rawBody,
      signature,
      payload: PAYMENT_CAPTURED_PAYLOAD,
    });
    expect(firstResult.status).toBe('processed');
    expect(firstResult.isNew).toBe(true);

    const existingRow = {
      id: firstResult.eventId,
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
    };

    vi.mocked(eventStore.insert).mockImplementationOnce(async () => {
      const { Prisma } = await import('@prisma/client');
      throw new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields (provider,providerEventId)',
        { code: 'P2002', clientVersion: 'test' }
      );
    });
    vi.mocked(eventStore.findByProviderEventId).mockResolvedValueOnce(existingRow);

    const secondResult = await service.processWebhook({
      rawBody,
      signature,
      payload: PAYMENT_CAPTURED_PAYLOAD,
    });
    expect(secondResult.status).toBe('duplicate');
    expect(secondResult.isNew).toBe(false);
    expect(secondResult.eventId).toBe(firstResult.eventId);
  });

  it('6. acknowledges unsupported events without persisting', async () => {
    const { service, eventStore } = makeService();
    const { body, signature } = signPayload(UNSUPPORTED_EVENT_PAYLOAD);

    const result = await service.processWebhook({
      rawBody: Buffer.from(body),
      signature,
      payload: UNSUPPORTED_EVENT_PAYLOAD,
    });

    expect(result.status).toBe('unsupported');
    expect(result.isNew).toBe(false);
    expect(result.eventType).toBe('refund.created');
    expect(eventStore.insert).not.toHaveBeenCalled();
  });

  it('7. rejects an empty body', async () => {
    const { service } = makeService();
    const rawBody = Buffer.alloc(0);

    await expect(
      service.processWebhook({
        rawBody,
        signature: generateSignature(WEBHOOK_SECRET, ''),
        payload: undefined,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('8. throws InternalError when no webhook secret is configured', async () => {
    const { service } = makeService({ config: { razorpayWebhookSecret: undefined } });
    const { body } = signPayload(PAYMENT_CAPTURED_PAYLOAD);

    await expect(
      service.processWebhook({
        rawBody: Buffer.from(body),
        signature: generateSignature(WEBHOOK_SECRET, body),
        payload: PAYMENT_CAPTURED_PAYLOAD,
      })
    ).rejects.toBeInstanceOf(InternalError);
  });

  it('9. signature verification uses timing-safe comparison', () => {
    const adapter = new RazorpayAdapter();
    const body = Buffer.from(JSON.stringify(PAYMENT_CAPTURED_PAYLOAD));
    const correctSignature = generateSignature(WEBHOOK_SECRET, body.toString('utf8'));

    expect(adapter.verifySignature(WEBHOOK_SECRET, body, correctSignature)).toBe(true);
    expect(
      adapter.verifySignature(WEBHOOK_SECRET, body, 'zzz' + correctSignature.slice(3))
    ).toBe(false);
  });

  it('10. detection failure does not fail the webhook acknowledgement', async () => {
    const adapter = new RazorpayAdapter();
    const eventStore = createPaymentEventStoreMock();
    const accountLookup = createAccountLookupStoreMock();
    const repository = new PaymentEventRepository(eventStore, accountLookup);
    const config: WebhookServiceConfig = { razorpayWebhookSecret: WEBHOOK_SECRET };
    const service = new WebhookService(adapter, repository, config);

    const { body, signature } = signPayload(PAYMENT_CAPTURED_PAYLOAD);
    const rawBody = Buffer.from(body);

    const result = await service.processWebhook({
      rawBody,
      signature,
      payload: PAYMENT_CAPTURED_PAYLOAD,
    });

    expect(result.status).toBe('processed');
    expect(result.isNew).toBe(true);
  });
});
