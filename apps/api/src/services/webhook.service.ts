import type { NormalizedPaymentEvent, PaymentProviderAdapter } from '../domain/provider-adapter.js';
import type { AccountReference } from '../domain/payment-event.js';
import type { PaymentEventRepository } from '../repositories/payment-event.repository.js';
import { InternalError, ValidationError } from '../lib/errors.js';
import { toJsonValue } from '../lib/json.js';

export interface WebhookServiceConfig {
  /**
   * Webhook signature secret. Optional at the environment layer to preserve
   * existing deployment/test conventions; ingestion fails closed when unset.
   */
  razorpayWebhookSecret?: string;
  /** Optional fallback payment account (by id) used when the envelope has no
   * recognizable provider account — intended for local/test setups. */
  defaultTestPaymentAccountId?: string;
}

export type WebhookEventStatus = 'processed' | 'duplicate' | 'unsupported';

export interface WebhookProcessingResult {
  /** Persisted event id, or a synthetic "unsupported:*" marker for unsupported events. */
  eventId: string;
  status: WebhookEventStatus;
  isNew: boolean;
  eventType: string;
}

/**
 * Ingestion workflow for provider webhooks:
 * verify signature → validate payload → check support → normalize →
 * resolve account/merchant → persist idempotently → deterministic result.
 *
 * Safe to call repeatedly with the same webhook: duplicates resolve against
 * the database's unique constraint and return the persisted row.
 */
export class WebhookService {
  constructor(
    private readonly adapter: PaymentProviderAdapter,
    private readonly repository: PaymentEventRepository,
    private readonly config: WebhookServiceConfig
  ) {}

  async processWebhook(args: {
    rawBody: Buffer;
    signature: string;
    payload: unknown;
  }): Promise<WebhookProcessingResult> {
    const secret = this.config.razorpayWebhookSecret;
    if (!secret) {
      throw new InternalError('Webhook signature verification is not configured.');
    }

    if (!this.adapter.verifySignature(secret, args.rawBody, args.signature)) {
      throw new ValidationError('Invalid webhook signature.');
    }

    const envelope = this.adapter.validatePayload(args.payload);
    const { event: eventType } = envelope;

    if (!this.adapter.supportsEvent(eventType)) {
      // Acknowledge unsupported events without claiming they were processed.
      return {
        eventId: `unsupported:${eventType}`,
        isNew: false,
        status: 'unsupported',
        eventType,
      };
    }

    const normalized = this.adapter.normalizeEvent(args.payload);

    const jsonPayload = toJsonValue(args.payload);
    if (jsonPayload === undefined) {
      throw new ValidationError('Webhook payload must be valid JSON.');
    }

    const account = await this.resolveAccount(normalized);

    const persisted = await this.repository.persistEvent({
      normalized,
      rawPayload: jsonPayload,
      paymentAccountId: account?.id ?? null,
      merchantId: account?.merchantId ?? null,
    });

    return {
      eventId: persisted.event.id,
      isNew: persisted.isNew,
      status: persisted.isNew ? 'processed' : 'duplicate',
      eventType,
    };
  }

  private async resolveAccount(normalized: NormalizedPaymentEvent): Promise<AccountReference | null> {
    if (normalized.providerAccountId) {
      const byExternalId = await this.repository.findAccountByExternalId(
        normalized.provider,
        normalized.providerAccountId
      );
      if (byExternalId) {
        return byExternalId;
      }
    }

    if (this.config.defaultTestPaymentAccountId) {
      const byId = await this.repository.findAccountById(this.config.defaultTestPaymentAccountId);
      if (byId) {
        return byId;
      }
    }

    return null;
  }
}
