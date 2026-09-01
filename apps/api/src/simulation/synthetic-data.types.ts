/**
 * Phase 13.1 — Synthetic Dataset Types.
 *
 * Defines the structures produced by the synthetic data generator.
 * These types are used internally by the generator and service; they do NOT
 * represent persisted entities beyond the existing PaymentEvent model.
 */

/** Behavioral profile controlling payment outcome probability. */
export type CustomerBehavior =
  | 'reliable'
  | 'occasional_failure'
  | 'frequent_failure'
  | 'high_value'
  | 'new_customer'
  | 'returning';

/** Merchant industry profile affecting payment method distribution and failure rates. */
export type MerchantProfile =
  | 'high_volume_upi'
  | 'high_card_usage'
  | 'mixed_methods'
  | 'subscription_heavy'
  | 'b2b_high_value';

/** Payment methods compatible with the existing domain. */
export type SyntheticPaymentMethod = 'card' | 'upi' | 'netbanking' | 'wallet';

/** Failure types that map to existing RecoveryOS failure classification. */
export type SyntheticFailureType =
  | 'GATEWAY_ERROR'
  | 'NETWORK_ERROR'
  | 'INSUFFICIENT_FUNDS'
  | 'EXPIRED_CARD'
  | 'AUTHENTICATION_FAILED'
  | 'UNKNOWN_ERROR';

/** A generated synthetic merchant. */
export interface SyntheticMerchant {
  id: string;
  name: string;
  profile: MerchantProfile;
  currency: string;
  createdAt: Date;
}

/** A generated synthetic customer. */
export interface SyntheticCustomer {
  id: string;
  merchantId: string;
  displayId: string;
  behavior: CustomerBehavior;
  createdAt: Date;
}

/** A generated synthetic order. */
export interface SyntheticOrder {
  id: string;
  merchantId: string;
  customerId: string;
  amount: number;
  currency: string;
  createdAt: Date;
}

/** A generated synthetic payment attempt — produces PaymentEvents. */
export interface SyntheticPaymentAttempt {
  id: string;
  merchantId: string;
  customerId: string;
  orderId: string;
  amount: number;
  currency: string;
  method: SyntheticPaymentMethod;
  status: 'captured' | 'failed';
  failureType: SyntheticFailureType | null;
  errorCode: string | null;
  errorDescription: string | null;
  errorSource: string | null;
  errorStep: string | null;
  errorReason: string | null;
  subscriptionId: string | null;
  createdAt: Date;
}

/** Complete generated dataset (in-memory, before persistence). */
export interface SyntheticDataset {
  runId: string;
  seed: number;
  merchants: SyntheticMerchant[];
  customers: SyntheticCustomer[];
  orders: SyntheticOrder[];
  payments: SyntheticPaymentAttempt[];
  createdAt: Date;
}

/** Aggregate metrics for a generated dataset. */
export interface SyntheticDatasetMetrics {
  runId: string;
  seed: number;
  createdAt: Date;
  merchantsGenerated: number;
  customersGenerated: number;
  ordersGenerated: number;
  paymentsGenerated: number;
  successfulPayments: number;
  failedPayments: number;
  totalPaymentVolume: number;
  failedPaymentVolume: number;
  failureDistribution: Record<SyntheticFailureType, number>;
  paymentMethodDistribution: Record<SyntheticPaymentMethod, number>;
}

/** Result of persisting a synthetic dataset. */
export interface SyntheticDatasetPersistResult {
  runId: string;
  seed: number;
  merchantsPersisted: number;
  customersPersisted: number;
  ordersPersisted: number;
  paymentsPersisted: number;
  successfulPayments: number;
  failedPayments: number;
  totalPaymentVolume: number;
  failedPaymentVolume: number;
}
