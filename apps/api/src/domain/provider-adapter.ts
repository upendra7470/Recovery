import type { PaymentProviderName } from './payment-event.js';

/** Envelope fields every webhook consumer needs after validation. */
export interface WebhookEnvelope {
  event: string;
}

export interface NormalizedPaymentEvent {
  provider: PaymentProviderName;
  eventType: string;
  /**
   * Stable identity used for idempotency. Razorpay payloads do not carry a
   * dedicated event id, so the adapter derives one from the event type and
   * the provider payment id (e.g. "payment.captured:pay_123").
   */
  providerEventId: string;
  providerPaymentId: string;
  providerOrderId: string | null;
  /** Amount in the provider's smallest currency unit (paise for Razorpay INR). */
  amount: number | null;
  currency: string | null;
  status: string | null;
  method: string | null;
  email: string | null;
  contact: string | null;
  bank: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  errorSource: string | null;
  errorStep: string | null;
  errorReason: string | null;
  /** Provider account identifier from the webhook envelope, when present. */
  providerAccountId: string | null;
  /**
   * Subscription identifier for recurring payments, when the provider reports
   * one on the payment entity. Null when the payment is not subscription-based.
   */
  subscriptionId: string | null;
  /** When the payment entity was created at the provider, if reported. */
  paymentCreatedAt: Date | null;
  /** Best-known occurrence time of the event itself. */
  occurredAt: Date;
}

export interface PaymentProviderAdapter {
  readonly provider: PaymentProviderName;
  /**
   * Timing-safe verification of the provider signature over the exact raw
   * request bytes.
   */
  verifySignature(secret: string, rawBody: Buffer, signature: string): boolean;
  /**
   * Structural validation of a decoded webhook payload. Returns the envelope
   * (with the event name) on success; throws ValidationError otherwise.
   */
  validatePayload(payload: unknown): WebhookEnvelope;
  supportsEvent(eventType: string): boolean;
  normalizeEvent(payload: unknown): NormalizedPaymentEvent;
}
