import type { Prisma } from '@prisma/client';

/**
 * Providers supported by the ingestion pipeline. Kept in lockstep with the
 * `PaymentProvider` enum in prisma/schema.prisma.
 */
export const PAYMENT_PROVIDERS = ['razorpay'] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

/**
 * Processing lifecycle of an ingested event. Mirrors the `ProcessingStatus`
 * enum in prisma/schema.prisma.
 */
export const PAYMENT_EVENT_PROCESSING_STATUSES = [
  'pending',
  'processed',
  'duplicate',
  'unsupported',
  'failed',
] as const;
export type PaymentEventProcessingStatus =
  (typeof PAYMENT_EVENT_PROCESSING_STATUSES)[number];

/** Persisted shape of a payment_events row. */
export interface PaymentEventRow {
  id: string;
  paymentAccountId: string | null;
  merchantId: string | null;
  provider: PaymentProviderName;
  providerEventId: string;
  eventType: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  eventCreatedAt: Date;
  receivedAt: Date;
  payload: unknown;
  normalizedData: unknown;
  signatureVerified: boolean;
  processingStatus: PaymentEventProcessingStatus;
  processingAttempts: number;
  processedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Normalized provider-agnostic payment data persisted alongside the raw
 * webhook payload. JSON-safe by construction (the index signature enforces
 * it and satisfies Prisma's InputJsonObject): timestamps are ISO strings so
 * the object can be stored in the `normalized_data` JSONB column as-is.
 */
export interface NormalizedPaymentEventData {
  [key: string]: string | number | boolean | null;
  provider: string;
  eventType: string;
  providerPaymentId: string | null;
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
  /** Provider subscription identifier for recurring payments, when present. */
  subscriptionId: string | null;
  paymentCreatedAt: string | null;
  occurredAt: string;
}

/** Data required to persist a new payment event. */
export interface NewPaymentEventData {
  paymentAccountId: string | null;
  merchantId: string | null;
  provider: PaymentProviderName;
  providerEventId: string;
  eventType: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  eventCreatedAt: Date;
  receivedAt: Date;
  /**
   * Prisma's JSON input type is used here because this is the serialization
   * boundary into the JSONB columns; it avoids unsafe casts at every call site.
   */
  payload: Prisma.InputJsonValue;
  normalizedData: NormalizedPaymentEventData;
  signatureVerified: boolean;
  processingStatus: PaymentEventProcessingStatus;
  processingAttempts: number;
  processedAt: Date | null;
  failureReason: string | null;
}

/** Minimal merchant-scoped reference to a payment account. */
export interface AccountReference {
  id: string;
  merchantId: string;
}

/**
 * Persistence boundary for payment events. Implemented by a thin Prisma
 * adapter (see repositories/prisma-stores.ts); the domain never touches the
 * Prisma client directly.
 */
export interface PaymentEventStore {
  insert(data: NewPaymentEventData): Promise<PaymentEventRow>;
  findByProviderEventId(
    provider: PaymentProviderName,
    providerEventId: string
  ): Promise<PaymentEventRow | null>;
  findById(id: string): Promise<PaymentEventRow | null>;
  /**
   * Events correlated to a payment/order identity within a time range — the
   * evidence window used by detection rules (e.g. "did a captured payment
   * follow this failure?").
   */
  findRelatedByOrderOrPayment(args: {
    providerPaymentId: string | null;
    providerOrderId: string | null;
    occurredAfter: Date;
    occurredBefore: Date;
  }): Promise<PaymentEventRow[]>;
  /**
   * Find payment events matching filters, with pagination.
   * Used by the replay engine to load synthetic events for processing.
   */
  findMany?(args: {
    merchantId?: string;
    eventCreatedAt?: { gte?: Date; lte?: Date };
    skip?: number;
    take?: number;
    orderBy?: 'asc' | 'desc';
  }): Promise<PaymentEventRow[]>;
}

/** Read-only lookup boundary for payment accounts during ingestion. */
export interface PaymentAccountLookupStore {
  findActiveByExternalId(
    provider: PaymentProviderName,
    externalAccountId: string
  ): Promise<AccountReference | null>;
  findById(id: string): Promise<AccountReference | null>;
}
