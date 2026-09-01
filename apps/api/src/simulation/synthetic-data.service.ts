import type { PaymentAccountLookupStore, PaymentEventStore } from '../domain/payment-event.js';
import type { SyntheticDatasetConfig, DistributionConfig, PaymentMethodDistribution } from './synthetic-data.config.js';
import { syntheticDatasetConfigSchema, DEFAULT_DISTRIBUTION, DEFAULT_PAYMENT_METHOD_DISTRIBUTION } from './synthetic-data.config.js';
import {
  generateDataset,
  computeDatasetMetrics,
} from './synthetic-data.generator.js';
import type {
  SyntheticDataset,
  SyntheticDatasetMetrics,
  SyntheticDatasetPersistResult,
} from './synthetic-data.types.js';

/**
 * Phase 13.1 — Synthetic Dataset Service.
 *
 * Orchestrates generation + persistence of synthetic payment data via
 * existing PaymentEventStore and PaymentAccountStore interfaces.
 *
 * This service is the ONLY persistence boundary. It does NOT create
 * recovery opportunities, decisions, or executions — those are created
 * by the existing RecoveryOS pipeline when events are later processed.
 */

export interface SyntheticDatasetStatus {
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
}

export class SyntheticDatasetService {
  constructor(
    private readonly paymentEventStore: PaymentEventStore,
    private readonly paymentAccountStore: PaymentAccountLookupStore,
  ) {}

  /**
   * Generate and persist a synthetic dataset.
   *
   * @param config - Generation configuration (seed + volume + distribution)
   * @param merchantId - Existing merchant to associate generated data with
   * @param paymentAccountId - Existing payment account to associate generated data with
   */
  async generateAndPersist(
    config: SyntheticDatasetConfig,
    merchantId: string,
    paymentAccountId: string,
  ): Promise<SyntheticDatasetPersistResult> {
    const dataset = generateDataset(config);

    const result = await this.persistDataset(dataset, merchantId, paymentAccountId);

    return {
      runId: dataset.runId,
      seed: dataset.seed,
      merchantsPersisted: result.merchantsPersisted,
      customersPersisted: result.customersPersisted,
      ordersPersisted: result.ordersPersisted,
      paymentsPersisted: result.paymentsPersisted,
      successfulPayments: result.successfulPayments,
      failedPayments: result.failedPayments,
      totalPaymentVolume: result.totalPaymentVolume,
      failedPaymentVolume: result.failedPaymentVolume,
    };
  }

  /**
   * Return metrics for a generated dataset without persisting.
   */
  preview(config: SyntheticDatasetConfig): SyntheticDatasetMetrics {
    const dataset = generateDataset(config);
    return computeDatasetMetrics(dataset);
  }

  /**
   * Get status of a generated dataset (for reporting purposes).
   */
  getStatus(dataset: SyntheticDataset): SyntheticDatasetMetrics {
    return computeDatasetMetrics(dataset);
  }

  /**
   * Create a config with defaults applied.
   */
  createConfig(
    seed: number,
    overrides?: Partial<Omit<SyntheticDatasetConfig, 'seed'>> & {
      distribution?: Partial<DistributionConfig>;
      paymentMethodDistribution?: Partial<PaymentMethodDistribution>;
    },
  ): SyntheticDatasetConfig {
    const raw: Record<string, unknown> = {
      seed,
      ...overrides,
    };

    // Apply distribution defaults
    if (overrides?.distribution) {
      raw.distribution = { ...DEFAULT_DISTRIBUTION, ...overrides.distribution };
    } else {
      raw.distribution = { ...DEFAULT_DISTRIBUTION };
    }

    // Apply payment method distribution defaults
    if (overrides?.paymentMethodDistribution) {
      raw.paymentMethodDistribution = {
        ...DEFAULT_PAYMENT_METHOD_DISTRIBUTION,
        ...overrides.paymentMethodDistribution,
      };
    } else {
      raw.paymentMethodDistribution = { ...DEFAULT_PAYMENT_METHOD_DISTRIBUTION };
    }

    // Apply date defaults if not provided
    if (raw.startDate === undefined) {
      raw.startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    }
    if (raw.endDate === undefined) {
      raw.endDate = new Date();
    }

    // Parse through Zod schema to apply all defaults and validation
    return syntheticDatasetConfigSchema.parse(raw);
  }

  // ---------------------------------------------------------------------------
  // Private persistence
  // ---------------------------------------------------------------------------

  private async persistDataset(
    dataset: SyntheticDataset,
    merchantId: string,
    paymentAccountId: string,
  ): Promise<{
    merchantsPersisted: number;
    customersPersisted: number;
    ordersPersisted: number;
    paymentsPersisted: number;
    successfulPayments: number;
    failedPayments: number;
    totalPaymentVolume: number;
    failedPaymentVolume: number;
  }> {
    let successfulPayments = 0;
    let failedPayments = 0;
    let totalPaymentVolume = 0;
    let failedPaymentVolume = 0;

    // Persist payment events via existing store interface
    for (const payment of dataset.payments) {
      const eventType = payment.status === 'captured' ? 'payment.captured' : 'payment.failed';

      const normalizedData = {
        provider: 'razorpay' as const,
        eventType,
        providerPaymentId: `pay_syn_${payment.id.slice(0, 8)}`,
        providerOrderId: `order_syn_${payment.orderId.slice(0, 8)}`,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status === 'captured' ? 'captured' : 'failed',
        method: payment.method,
        email: null,
        contact: null,
        bank: null,
        errorCode: payment.errorCode,
        errorDescription: payment.errorDescription,
        errorSource: payment.errorSource,
        errorStep: payment.errorStep,
        errorReason: payment.errorReason,
        subscriptionId: payment.subscriptionId,
        paymentCreatedAt: payment.createdAt.toISOString(),
        occurredAt: payment.createdAt.toISOString(),
      };

      const payload = {
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        method: payment.method,
        order_id: normalizedData.providerOrderId,
        bank: normalizedData.bank,
        error_code: payment.errorCode,
        error_description: payment.errorDescription,
        created_at: payment.createdAt.toISOString(),
        // Synthetic metadata
        _synthetic: true,
        _runId: dataset.runId,
        _merchantId: payment.merchantId,
        _customerId: payment.customerId,
      };

      await this.paymentEventStore.insert({
        paymentAccountId,
        merchantId,
        provider: 'razorpay',
        providerEventId: `${eventType}:${normalizedData.providerPaymentId}`,
        eventType,
        providerPaymentId: normalizedData.providerPaymentId,
        providerOrderId: normalizedData.providerOrderId,
        eventCreatedAt: payment.createdAt,
        receivedAt: new Date(),
        payload,
        normalizedData,
        signatureVerified: true,
        processingStatus: 'processed',
        processingAttempts: 1,
        processedAt: new Date(),
        failureReason: payment.failureType,
      });

      // Accumulate metrics
      totalPaymentVolume += payment.amount;
      if (payment.status === 'captured') {
        successfulPayments++;
      } else {
        failedPayments++;
        failedPaymentVolume += payment.amount;
      }
    }

    return {
      merchantsPersisted: dataset.merchants.length,
      customersPersisted: dataset.customers.length,
      ordersPersisted: dataset.orders.length,
      paymentsPersisted: dataset.payments.length,
      successfulPayments,
      failedPayments,
      totalPaymentVolume,
      failedPaymentVolume,
    };
  }
}
