import type { PaymentEventRow } from '../domain/payment-event.js';

/**
 * Typed, defensive view over a persisted payment event. Detection rules work
 * exclusively through this view so they never touch raw payloads and always
 * fail safe on incomplete normalized data.
 */
export interface PaymentEventView {
  id: string;
  merchantId: string | null;
  paymentAccountId: string | null;
  eventType: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  /** Amount in the provider's smallest currency unit; null when unknown. */
  amount: number | null;
  currency: string | null;
  status: string | null;
  errorCode: string | null;
  subscriptionId: string | null;
  occurredAt: Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function optionalAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function toEventView(row: PaymentEventRow): PaymentEventView {
  const normalized = isRecord(row.normalizedData) ? row.normalizedData : {};
  return {
    id: row.id,
    merchantId: row.merchantId,
    paymentAccountId: row.paymentAccountId,
    eventType: row.eventType,
    providerPaymentId:
      optionalString(normalized['providerPaymentId']) ?? optionalString(row.providerPaymentId),
    providerOrderId:
      optionalString(normalized['providerOrderId']) ?? optionalString(row.providerOrderId),
    amount: optionalAmount(normalized['amount']),
    currency: optionalString(normalized['currency']),
    status: optionalString(normalized['status']),
    errorCode: optionalString(normalized['errorCode']),
    subscriptionId: optionalString(normalized['subscriptionId']),
    occurredAt: row.eventCreatedAt,
  };
}
