import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  NormalizedPaymentEvent,
  PaymentProviderAdapter,
  WebhookEnvelope,
} from '../domain/provider-adapter.js';
import type { PaymentProviderName } from '../domain/payment-event.js';
import { ValidationError } from '../lib/errors.js';

const SUPPORTED_EVENTS: ReadonlySet<string> = new Set([
  'payment.authorized',
  'payment.captured',
  'payment.failed',
]);

/** Events whose payload must contain a `payload.payment.entity` object. */
function isSupportedPaymentEvent(eventType: string): boolean {
  return SUPPORTED_EVENTS.has(eventType);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface RazorpayEnvelopeView {
  event: string;
  accountId: string | null;
  createdAt: number | null;
  payload: Record<string, unknown>;
}

/**
 * Razorpay webhook adapter.
 *
 * Signature verification follows Razorpay's scheme: HMAC-SHA256 of the exact
 * raw request body, hex-encoded, compared timing-safely against the
 * `X-Razorpay-Signature` header.
 */
export class RazorpayAdapter implements PaymentProviderAdapter {
  readonly provider: PaymentProviderName = 'razorpay';

  verifySignature(secret: string, rawBody: Buffer, signature: string): boolean {
    const expectedHex = createHmac('sha256', secret).update(rawBody).digest('hex');
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = Buffer.from(signature, 'hex');
    // Buffer.from is lenient on non-hex input; the length comparison keeps
    // timingSafeEqual from throwing while still rejecting the signature.
    if (expected.length !== actual.length) {
      return false;
    }
    return timingSafeEqual(expected, actual);
  }

  validatePayload(payload: unknown): WebhookEnvelope {
    const envelope = parseEnvelope(payload);
    if (isSupportedPaymentEvent(envelope.event)) {
      extractPaymentEntity(envelope.payload);
    }
    return { event: envelope.event };
  }

  supportsEvent(eventType: string): boolean {
    return isSupportedPaymentEvent(eventType);
  }

  normalizeEvent(payload: unknown): NormalizedPaymentEvent {
    const envelope = parseEnvelope(payload);
    const payment = extractPaymentEntity(envelope.payload);

    const providerPaymentId = requiredString(payment, 'id');
    const eventType = envelope.event;

    return {
      provider: this.provider,
      eventType,
      providerEventId: `${eventType}:${providerPaymentId}`,
      providerPaymentId,
      providerOrderId: optionalString(payment, 'order_id'),
      amount: optionalAmount(payment, 'amount'),
      currency: optionalString(payment, 'currency'),
      status: optionalString(payment, 'status'),
      method: optionalString(payment, 'method'),
      email: optionalString(payment, 'email'),
      contact: optionalString(payment, 'contact'),
      bank: optionalString(payment, 'bank'),
      errorCode: optionalString(payment, 'error_code'),
      errorDescription: optionalString(payment, 'error_description'),
      errorSource: optionalString(payment, 'error_source'),
      errorStep: optionalString(payment, 'error_step'),
      errorReason: optionalString(payment, 'error_reason'),
      providerAccountId: envelope.accountId,
      subscriptionId: optionalString(payment, 'subscription_id'),
      paymentCreatedAt: optionalUnixSecondsDate(payment['created_at']),
      occurredAt: resolveOccurredAt(envelope, payment),
    };
  }
}

function parseEnvelope(payload: unknown): RazorpayEnvelopeView {
  if (!isRecord(payload)) {
    throw new ValidationError('Webhook payload must be a JSON object.');
  }

  const event = payload['event'];
  if (typeof event !== 'string' || event.length === 0) {
    throw new ValidationError('Webhook payload is missing the "event" field.');
  }

  const body = payload['payload'];
  if (!isRecord(body)) {
    throw new ValidationError('Webhook payload is missing the "payload" object.');
  }

  return {
    event,
    accountId: optionalString(payload, 'account_id'),
    createdAt: optionalUnixSeconds(payload['created_at']),
    payload: body,
  };
}

function extractPaymentEntity(payloadBody: Record<string, unknown>): Record<string, unknown> {
  // In Razorpay webhooks `payload.payment` IS the payment entity; its
  // `entity: "payment"` field is a descriptive string on the object itself.
  const paymentEntity = payloadBody['payment'];
  if (!isRecord(paymentEntity)) {
    throw new ValidationError('Webhook payload is missing the "payload.payment" entity.');
  }
  return paymentEntity;
}

function requiredString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`Webhook payment entity is missing "${key}".`);
  }
  return value;
}

function optionalString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value.length > 0 ? value : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

/**
 * Razorpay amounts are integers in the provider's smallest currency unit
 * (paise for INR). They are preserved as-is; no conversion is applied here so
 * audit data stays faithful to the provider.
 */
function optionalAmount(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function optionalUnixSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function optionalUnixSecondsDate(value: unknown): Date | null {
  const seconds = optionalUnixSeconds(value);
  return seconds === null ? null : new Date(seconds * 1000);
}

function resolveOccurredAt(
  envelope: RazorpayEnvelopeView,
  payment: Record<string, unknown>
): Date {
  const fromEnvelope = optionalUnixSecondsDate(envelope.createdAt);
  if (fromEnvelope) {
    return fromEnvelope;
  }
  const fromPayment = optionalUnixSecondsDate(payment['created_at']);
  if (fromPayment) {
    return fromPayment;
  }
  return new Date();
}
