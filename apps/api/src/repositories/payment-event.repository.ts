import { Prisma } from '@prisma/client';
import type {
  AccountReference,
  NewPaymentEventData,
  NormalizedPaymentEventData,
  PaymentAccountLookupStore,
  PaymentEventRow,
  PaymentEventStore,
  PaymentProviderName,
} from '../domain/payment-event.js';
import type { NormalizedPaymentEvent } from '../domain/provider-adapter.js';
import { InternalError } from '../lib/errors.js';

export interface WebhookPersistArgs {
  normalized: NormalizedPaymentEvent;
  /** Decoded webhook body (validated) stored verbatim for audit purposes. */
  rawPayload: Prisma.InputJsonValue;
  paymentAccountId: string | null;
  merchantId: string | null;
}

export interface WebhookPersistResult {
  event: PaymentEventRow;
  /**
   * true when a new row was created; false when an existing row for the same
   * provider event identity was returned instead (idempotent replay).
   */
  isNew: boolean;
}

/**
 * Persistence facade for payment event ingestion. Handles idempotency at the
 * database boundary: the (provider, provider_event_id) unique constraint is
 * the source of truth, and unique-violation races are resolved by re-reading
 * the winning row.
 */
export class PaymentEventRepository {
  constructor(
    private readonly events: PaymentEventStore,
    private readonly accounts: PaymentAccountLookupStore
  ) {}

  findAccountByExternalId(
    provider: PaymentProviderName,
    externalAccountId: string
  ): Promise<AccountReference | null> {
    return this.accounts.findActiveByExternalId(provider, externalAccountId);
  }

  findAccountById(id: string): Promise<AccountReference | null> {
    return this.accounts.findById(id);
  }

  async persistEvent(args: WebhookPersistArgs): Promise<WebhookPersistResult> {
    const data = this.toRowData(args);

    try {
      const event = await this.events.insert(data);
      return { event, isNew: true };
    } catch (error) {
      // Concurrent delivery of the same event lost the insert race; return
      // the persisted row so the caller reports an idempotent duplicate.
      if (isUniqueConstraintViolation(error)) {
        const existing = await this.events.findByProviderEventId(
          data.provider,
          data.providerEventId
        );
        if (existing) {
          return { event: existing, isNew: false };
        }
      }
      throw new InternalError('Failed to persist payment event.', { cause: error });
    }
  }

  private toRowData(args: WebhookPersistArgs): NewPaymentEventData {
    const { normalized } = args;
    return {
      paymentAccountId: args.paymentAccountId,
      merchantId: args.merchantId,
      provider: normalized.provider,
      providerEventId: normalized.providerEventId,
      eventType: normalized.eventType,
      providerPaymentId: normalized.providerPaymentId,
      providerOrderId: normalized.providerOrderId,
      eventCreatedAt: normalized.occurredAt,
      receivedAt: new Date(),
      payload: args.rawPayload,
      normalizedData: toNormalizedData(normalized),
      signatureVerified: true,
      processingStatus: 'processed',
      processingAttempts: 1,
      processedAt: new Date(),
      failureReason: null,
    };
  }
}

function toNormalizedData(normalized: NormalizedPaymentEvent): NormalizedPaymentEventData {
  return {
    provider: normalized.provider,
    eventType: normalized.eventType,
    providerPaymentId: normalized.providerPaymentId,
    providerOrderId: normalized.providerOrderId,
    amount: normalized.amount,
    currency: normalized.currency,
    status: normalized.status,
    method: normalized.method,
    email: normalized.email,
    contact: normalized.contact,
    bank: normalized.bank,
    errorCode: normalized.errorCode,
    errorDescription: normalized.errorDescription,
    errorSource: normalized.errorSource,
    errorStep: normalized.errorStep,
    errorReason: normalized.errorReason,
    subscriptionId: normalized.subscriptionId,
    paymentCreatedAt: normalized.paymentCreatedAt?.toISOString() ?? null,
    occurredAt: normalized.occurredAt.toISOString(),
  };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
