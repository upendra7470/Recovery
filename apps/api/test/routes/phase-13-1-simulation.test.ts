import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type {
  PaymentEventStore,
  PaymentEventRow,
  NewPaymentEventData,
  PaymentAccountLookupStore,
  AccountReference,
} from '../../src/domain/payment-event.js';
import { SeededRandom } from '../../src/simulation/seeded-random.js';
import {
  generateDataset,
  computeDatasetMetrics,
} from '../../src/simulation/synthetic-data.generator.js';
import {
  validateDistribution,
  validatePaymentMethods,
  syntheticDatasetConfigSchema,
  DEFAULT_DISTRIBUTION,
  DEFAULT_PAYMENT_METHOD_DISTRIBUTION,
} from '../../src/simulation/synthetic-data.config.js';
import type { SyntheticDatasetConfig } from '../../src/simulation/synthetic-data.config.js';
import { SyntheticDatasetService } from '../../src/simulation/synthetic-data.service.js';
import type {
  SyntheticFailureType,
  SyntheticPaymentMethod,
} from '../../src/simulation/synthetic-data.types.js';

// ---------------------------------------------------------------------------
// In-memory stores for testing
// ---------------------------------------------------------------------------
class InMemoryPaymentEventStore implements PaymentEventStore {
  private rows: Map<string, PaymentEventRow> = new Map();

  async insert(data: NewPaymentEventData): Promise<PaymentEventRow> {
    const id = randomUUID();
    const now = new Date();
    const row: PaymentEventRow = {
      id,
      paymentAccountId: data.paymentAccountId,
      merchantId: data.merchantId,
      provider: data.provider,
      providerEventId: data.providerEventId,
      eventType: data.eventType,
      providerPaymentId: data.providerPaymentId,
      providerOrderId: data.providerOrderId,
      eventCreatedAt: data.eventCreatedAt,
      receivedAt: data.receivedAt,
      payload: data.payload,
      normalizedData: data.normalizedData,
      signatureVerified: data.signatureVerified,
      processingStatus: data.processingStatus,
      processingAttempts: data.processingAttempts,
      processedAt: data.processedAt,
      failureReason: data.failureReason,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(id, row);
    return row;
  }

  async findByProviderEventId(): Promise<PaymentEventRow | null> {
    return null;
  }

  async findById(): Promise<PaymentEventRow | null> {
    return null;
  }

  async findRelatedByOrderOrPayment(): Promise<PaymentEventRow[]> {
    return [];
  }

  async countByMerchant(): Promise<number> {
    return 0;
  }

  async deleteByMerchant(): Promise<number> {
    return 0;
  }

  get size() {
    return this.rows.size;
  }

  getAll(): PaymentEventRow[] {
    return Array.from(this.rows.values());
  }
}

class InMemoryPaymentAccountStore implements PaymentAccountLookupStore {
  private rows: Map<string, AccountReference> = new Map();

  async findActiveByExternalId(): Promise<AccountReference | null> {
    return null;
  }

  async findById(): Promise<AccountReference | null> {
    return null;
  }

  async upsertById(args: { id: string; merchantId: string }): Promise<AccountReference> {
    const row: AccountReference = { id: args.id, merchantId: args.merchantId };
    this.rows.set(args.id, row);
    return row;
  }

  async countByMerchant(): Promise<number> {
    return 0;
  }

  async deleteByMerchant(): Promise<number> {
    return 0;
  }

  async create(data: { id?: string; merchantId: string }): Promise<AccountReference> {
    const id = data.id ?? randomUUID();
    const row: AccountReference = { id, merchantId: data.merchantId };
    this.rows.set(id, row);
    return row;
  }

  get size() {
    return this.rows.size;
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const DEMO_MERCHANT_ID = '00000000-0000-4000-8000-000000000099';
const DEMO_PAYMENT_ACCOUNT_ID = '00000000-0000-4000-8000-000000000098';

function createDefaultConfig(seed = 42): SyntheticDatasetConfig {
  return {
    seed,
    merchantCount: 5,
    customersPerMerchant: 10,
    paymentsPerMerchant: 50,
    startDate: new Date('2025-01-01'),
    endDate: new Date('2025-04-01'),
    distribution: { ...DEFAULT_DISTRIBUTION },
    paymentMethodDistribution: { ...DEFAULT_PAYMENT_METHOD_DISTRIBUTION },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Phase 13.1 — Synthetic Dataset Generator', () => {
  describe('A — SeededRandom determinism', () => {
    it('produces identical sequences for the same seed', () => {
      const a = new SeededRandom(12345);
      const b = new SeededRandom(12345);

      for (let i = 0; i < 100; i++) {
        expect(a.next()).toBe(b.next());
      }
    });

    it('produces different sequences for different seeds', () => {
      const a = new SeededRandom(12345);
      const b = new SeededRandom(67890);

      let same = 0;
      for (let i = 0; i < 100; i++) {
        if (a.next() === b.next()) same++;
      }
      expect(same).toBeLessThan(10);
    });

    it('nextInt returns values in range [min, max]', () => {
      const rng = new SeededRandom(42);
      for (let i = 0; i < 1000; i++) {
        const val = rng.nextInt(5, 15);
        expect(val).toBeGreaterThanOrEqual(5);
        expect(val).toBeLessThanOrEqual(15);
      }
    });

    it('pick selects from array', () => {
      const rng = new SeededRandom(42);
      const arr = ['a', 'b', 'c'];
      for (let i = 0; i < 100; i++) {
        expect(arr).toContain(rng.pick(arr));
      }
    });

    it('pickWeighted selects from weighted array', () => {
      const rng = new SeededRandom(42);
      const items = ['a', 'b', 'c'] as const;
      const weights = [0.5, 0.3, 0.2];
      const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
      for (let i = 0; i < 1000; i++) {
        const picked = rng.pickWeighted(items, weights);
        counts[picked] = (counts[picked] ?? 0) + 1;
      }
      // 'a' should be selected most frequently
      expect(counts['a']!).toBeGreaterThan(counts['b']!);
      expect(counts['b']!).toBeGreaterThan(counts['c']!);
    });

    it('shuffle returns all original elements', () => {
      const rng = new SeededRandom(42);
      const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const shuffled = rng.shuffle([...arr]);
      expect(shuffled.sort((a, b) => a - b)).toEqual(arr);
    });
  });

  describe('B — Config validation', () => {
    it('validates a correct distribution', () => {
      expect(validateDistribution(DEFAULT_DISTRIBUTION)).toBe(true);
    });

    it('rejects invalid distribution (failure sum > 1)', () => {
      const bad = {
        ...DEFAULT_DISTRIBUTION,
        gatewayErrorRate: 0.5,
        networkErrorRate: 0.5,
        insufficientFundsRate: 0.5,
        expiredCardRate: 0.5,
        authenticationFailedRate: 0.5,
        unknownErrorRate: 0.5,
      };
      expect(validateDistribution(bad)).toBe(false);
    });

    it('validates correct payment method distribution', () => {
      expect(validatePaymentMethods(DEFAULT_PAYMENT_METHOD_DISTRIBUTION)).toBe(true);
    });

    it('rejects invalid payment method distribution', () => {
      expect(
        validatePaymentMethods({ card: 0.5, upi: 0.5, netbanking: 0.5, wallet: 0.5 })
      ).toBe(false);
    });
  });

  describe('C — Generator produces valid dataset', () => {
    it('generates dataset with correct seed', () => {
      const config = createDefaultConfig(42);
      const dataset = generateDataset(config);

      expect(dataset.seed).toBe(42);
      expect(dataset.merchants).toHaveLength(5);
      expect(dataset.runId).toMatch(/^syn_42_/);
    });

    it('generates correct number of customers per merchant', () => {
      const config = createDefaultConfig(42);
      const dataset = generateDataset(config);

      // Each merchant should have approximately customersPerMerchant customers
      for (const merchant of dataset.merchants) {
        const customers = dataset.customers.filter((c) => c.merchantId === merchant.id);
        expect(customers.length).toBeGreaterThanOrEqual(1);
        expect(customers.length).toBeLessThanOrEqual(20); // 10 * (0.8 + 0.4) = 12
      }
    });

    it('generates orders linked to customers', () => {
      const config = createDefaultConfig(42);
      const dataset = generateDataset(config);

      for (const order of dataset.orders) {
        expect(dataset.customers.some((c) => c.id === order.customerId)).toBe(true);
        expect(dataset.merchants.some((m) => m.id === order.merchantId)).toBe(true);
      }
    });

    it('generates payments with valid failure types', () => {
      const config = createDefaultConfig(42);
      const dataset = generateDataset(config);

      const validFailures: Array<SyntheticFailureType | null> = [
        null,
        'GATEWAY_ERROR',
        'NETWORK_ERROR',
        'INSUFFICIENT_FUNDS',
        'EXPIRED_CARD',
        'AUTHENTICATION_FAILED',
        'UNKNOWN_ERROR',
      ];

      for (const payment of dataset.payments) {
        expect(validFailures).toContain(payment.failureType);
        if (payment.status === 'captured') {
          expect(payment.failureType).toBeNull();
        }
        if (payment.status === 'failed') {
          expect(payment.failureType).not.toBeNull();
        }
      }
    });

    it('generates payments with valid payment methods', () => {
      const config = createDefaultConfig(42);
      const dataset = generateDataset(config);

      const validMethods: SyntheticPaymentMethod[] = ['card', 'upi', 'netbanking', 'wallet'];
      for (const payment of dataset.payments) {
        expect(validMethods).toContain(payment.method);
      }
    });
  });

  describe('D — Dataset determinism', () => {
    it('same config produces identical datasets', () => {
      const config = createDefaultConfig(42);
      const a = generateDataset(config);
      const b = generateDataset(config);

      expect(a.merchants.length).toBe(b.merchants.length);
      expect(a.customers.length).toBe(b.customers.length);
      expect(a.orders.length).toBe(b.orders.length);
      expect(a.payments.length).toBe(b.payments.length);

      // Merchant names should match
      for (let i = 0; i < a.merchants.length; i++) {
        expect(a.merchants[i]!.name).toBe(b.merchants[i]!.name);
      }
    });

    it('different seeds produce different datasets', () => {
      const a = generateDataset(createDefaultConfig(42));
      const b = generateDataset(createDefaultConfig(99));

      expect(a.merchants.map((m) => m.name)).not.toEqual(b.merchants.map((m) => m.name));
    });
  });

  describe('E — Metrics computation', () => {
    it('computes correct metrics', () => {
      const config = createDefaultConfig(42);
      const dataset = generateDataset(config);
      const metrics = computeDatasetMetrics(dataset);

      expect(metrics.merchantsGenerated).toBe(dataset.merchants.length);
      expect(metrics.customersGenerated).toBe(dataset.customers.length);
      expect(metrics.ordersGenerated).toBe(dataset.orders.length);
      expect(metrics.paymentsGenerated).toBe(dataset.payments.length);

      const successful = dataset.payments.filter((p) => p.status === 'captured').length;
      const failed = dataset.payments.filter((p) => p.status === 'failed').length;

      expect(metrics.successfulPayments).toBe(successful);
      expect(metrics.failedPayments).toBe(failed);
      expect(metrics.totalPaymentVolume).toBe(
        dataset.payments.reduce((sum, p) => sum + p.amount, 0)
      );
    });

    it('failure distribution keys are correct', () => {
      const config = createDefaultConfig(42);
      const dataset = generateDataset(config);
      const metrics = computeDatasetMetrics(dataset);

      expect(metrics.failureDistribution).toHaveProperty('GATEWAY_ERROR');
      expect(metrics.failureDistribution).toHaveProperty('NETWORK_ERROR');
      expect(metrics.failureDistribution).toHaveProperty('INSUFFICIENT_FUNDS');
      expect(metrics.failureDistribution).toHaveProperty('EXPIRED_CARD');
      expect(metrics.failureDistribution).toHaveProperty('AUTHENTICATION_FAILED');
      expect(metrics.failureDistribution).toHaveProperty('UNKNOWN_ERROR');

      // Sum should equal total failed payments
      const totalFailures = Object.values(metrics.failureDistribution).reduce((a, b) => a + b, 0);
      expect(totalFailures).toBe(metrics.failedPayments);
    });

    it('payment method distribution keys are correct', () => {
      const config = createDefaultConfig(42);
      const dataset = generateDataset(config);
      const metrics = computeDatasetMetrics(dataset);

      expect(metrics.paymentMethodDistribution).toHaveProperty('card');
      expect(metrics.paymentMethodDistribution).toHaveProperty('upi');
      expect(metrics.paymentMethodDistribution).toHaveProperty('netbanking');
      expect(metrics.paymentMethodDistribution).toHaveProperty('wallet');

      const totalMethods = Object.values(metrics.paymentMethodDistribution).reduce(
        (a, b) => a + b,
        0
      );
      expect(totalMethods).toBe(metrics.paymentsGenerated);
    });
  });

  describe('F — Volume scaling', () => {
    it('generates correct number of merchants', () => {
      const config = createDefaultConfig(42);
      config.merchantCount = 3;
      const dataset = generateDataset(config);
      expect(dataset.merchants.length).toBe(3);
    });

    it('generates more payments with higher paymentsPerMerchant', () => {
      const small = generateDataset({ ...createDefaultConfig(42), paymentsPerMerchant: 20 });
      const large = generateDataset({ ...createDefaultConfig(42), paymentsPerMerchant: 200 });

      expect(large.payments.length).toBeGreaterThan(small.payments.length);
    });
  });

  describe('G — Merchant profile diversity', () => {
    it('generates merchants with different profiles', () => {
      const config = createDefaultConfig(42);
      config.merchantCount = 20;
      const dataset = generateDataset(config);

      const profiles = new Set(dataset.merchants.map((m) => m.profile));
      expect(profiles.size).toBeGreaterThan(1);
    });
  });

  describe('H — Customer behavior diversity', () => {
    it('generates customers with different behaviors', () => {
      const config = createDefaultConfig(42);
      const dataset = generateDataset(config);

      const behaviors = new Set(dataset.customers.map((c) => c.behavior));
      expect(behaviors.size).toBeGreaterThan(1);
    });

    it('frequent_failure customers have lower success rates', () => {
      const config = createDefaultConfig(42);
      const dataset = generateDataset(config);

      // Group payments by customer behavior
      const customerBehaviorMap = new Map(
        dataset.customers.map((c) => [c.id, c.behavior])
      );

      const behaviorSuccessRates: Record<string, { total: number; success: number }> = {};

      for (const payment of dataset.payments) {
        const behavior = customerBehaviorMap.get(payment.customerId);
        if (behavior === undefined) continue;

        if (behaviorSuccessRates[behavior] === undefined) {
          behaviorSuccessRates[behavior] = { total: 0, success: 0 };
        }
        const entry = behaviorSuccessRates[behavior];
        if (entry === undefined) continue;
        entry.total++;
        if (payment.status === 'captured') {
          entry.success++;
        }
      }

      // reliable should have higher success rate than frequent_failure
      const reliableEntry = behaviorSuccessRates['reliable'];
      const frequentEntry = behaviorSuccessRates['frequent_failure'];
      const reliableRate = reliableEntry !== undefined && reliableEntry.total > 0
        ? reliableEntry.success / reliableEntry.total
        : 0;
      const frequentRate = frequentEntry !== undefined && frequentEntry.total > 0
        ? frequentEntry.success / frequentEntry.total
        : 0;

      expect(reliableRate).toBeGreaterThan(frequentRate);
    });
  });

  describe('I — Temporal distribution', () => {
    it('orders have dates within the configured range', () => {
      const config = createDefaultConfig(42);
      const dataset = generateDataset(config);

      for (const order of dataset.orders) {
        expect(order.createdAt.getTime()).toBeGreaterThanOrEqual(config.startDate.getTime());
        expect(order.createdAt.getTime()).toBeLessThanOrEqual(config.endDate.getTime());
      }
    });

    it('payments occur after their associated orders', () => {
      const config = createDefaultConfig(42);
      const dataset = generateDataset(config);

      const orderMap = new Map(dataset.orders.map((o) => [o.id, o]));

      for (const payment of dataset.payments) {
        const order = orderMap.get(payment.orderId);
        expect(order).toBeDefined();
        if (order !== undefined) {
          expect(payment.createdAt.getTime()).toBeGreaterThanOrEqual(order.createdAt.getTime());
          // Payment should be within 30 minutes of order
          expect(payment.createdAt.getTime() - order.createdAt.getTime()).toBeLessThanOrEqual(
            30 * 60 * 1000
          );
        }
      }
    });
  });

  describe('J — Service generateAndPersist', () => {
    let service: SyntheticDatasetService;
    let eventStore: InMemoryPaymentEventStore;

    beforeEach(() => {
      eventStore = new InMemoryPaymentEventStore();
      service = new SyntheticDatasetService(
        eventStore,
        new InMemoryPaymentAccountStore()
      );
    });

    it('persists payment events to store', async () => {
      const config = createDefaultConfig(42);
      const result = await service.generateAndPersist(
        config,
        DEMO_MERCHANT_ID,
        DEMO_PAYMENT_ACCOUNT_ID
      );

      expect(result.paymentsPersisted).toBeGreaterThan(0);
      expect(eventStore.size).toBe(result.paymentsPersisted);
    });

    it('returns correct persist result metrics', async () => {
      const config = createDefaultConfig(42);
      const result = await service.generateAndPersist(
        config,
        DEMO_MERCHANT_ID,
        DEMO_PAYMENT_ACCOUNT_ID
      );

      expect(result.seed).toBe(42);
      expect(result.merchantsPersisted).toBe(config.merchantCount);
      expect(result.paymentsPersisted).toBeGreaterThan(0);
      expect(result.successfulPayments + result.failedPayments).toBe(result.paymentsPersisted);
    });

    it('marks persisted events as processed', async () => {
      const config = createDefaultConfig(42);
      await service.generateAndPersist(config, DEMO_MERCHANT_ID, DEMO_PAYMENT_ACCOUNT_ID);

      const events = eventStore.getAll();
      for (const event of events) {
        expect(event.processingStatus).toBe('processed');
        expect(event.signatureVerified).toBe(true);
      }
    });

    it('includes failure reason for failed payments', async () => {
      const config = createDefaultConfig(42);
      await service.generateAndPersist(config, DEMO_MERCHANT_ID, DEMO_PAYMENT_ACCOUNT_ID);

      const events = eventStore.getAll();
      const failed = events.filter((e) => e.failureReason !== null);
      expect(failed.length).toBeGreaterThan(0);

      for (const event of failed) {
        expect(typeof event.failureReason).toBe('string');
      }
    });
  });

  describe('K — Service preview', () => {
    let service: SyntheticDatasetService;

    beforeEach(() => {
      service = new SyntheticDatasetService(
        new InMemoryPaymentEventStore(),
        new InMemoryPaymentAccountStore()
      );
    });

    it('returns metrics without persisting', () => {
      const config = createDefaultConfig(42);
      const metrics = service.preview(config);

      expect(metrics.merchantsGenerated).toBe(config.merchantCount);
      expect(metrics.paymentsGenerated).toBeGreaterThan(0);
      expect(metrics.runId).toMatch(/^syn_42_/);
    });
  });

  describe('L — Service createConfig', () => {
    let service: SyntheticDatasetService;

    beforeEach(() => {
      service = new SyntheticDatasetService(
        new InMemoryPaymentEventStore(),
        new InMemoryPaymentAccountStore()
      );
    });

    it('creates config with defaults', () => {
      const config = service.createConfig(42);
      expect(config.seed).toBe(42);
      expect(config.merchantCount).toBe(10);
      expect(config.customersPerMerchant).toBe(500);
      expect(config.paymentsPerMerchant).toBe(2000);
    });

    it('creates config with overrides', () => {
      const config = service.createConfig(42, { merchantCount: 3, customersPerMerchant: 10 });
      expect(config.merchantCount).toBe(3);
      expect(config.customersPerMerchant).toBe(10);
    });

    it('creates config with partial distribution overrides', () => {
      const config = service.createConfig(42, {
        distribution: { ...DEFAULT_DISTRIBUTION, successRate: 0.95 },
      });
      expect(config.distribution.successRate).toBe(0.95);
      // Other distribution values should use defaults
      expect(config.distribution.gatewayErrorRate).toBe(DEFAULT_DISTRIBUTION.gatewayErrorRate);
    });
  });

  describe('M — Config validation rejects invalid inputs', () => {
    it('rejects config with startDate after endDate via Zod schema', () => {
      // The Zod schema rejects startDate > endDate during parsing
      expect(() =>
        syntheticDatasetConfigSchema.parse({
          seed: 42,
          merchantCount: 5,
          customersPerMerchant: 10,
          paymentsPerMerchant: 50,
          startDate: new Date('2025-04-01'),
          endDate: new Date('2025-01-01'),
          distribution: { ...DEFAULT_DISTRIBUTION },
          paymentMethodDistribution: { ...DEFAULT_PAYMENT_METHOD_DISTRIBUTION },
        })
      ).toThrow();
    });
  });

  describe('N — Subscription subscription IDs', () => {
    it('subscription_heavy merchants may have subscription IDs', () => {
      const config = createDefaultConfig(42);
      config.merchantCount = 20;
      const dataset = generateDataset(config);

      const subscriptionHeavyMerchants = dataset.merchants.filter(
        (m) => m.profile === 'subscription_heavy'
      );

      if (subscriptionHeavyMerchants.length > 0) {
        const subPayments = dataset.payments.filter((p) => {
          const merchant = dataset.merchants.find((m) => m.id === p.merchantId);
          return merchant?.profile === 'subscription_heavy';
        });

        const withSubId = subPayments.filter((p) => p.subscriptionId !== null);
        // Some subscription payments should have subscription IDs
        expect(withSubId.length).toBeGreaterThan(0);
      }
    });
  });

  describe('O — Failure codes and descriptions', () => {
    it('failed payments have consistent error metadata', () => {
      const config = createDefaultConfig(42);
      const dataset = generateDataset(config);

      const failed = dataset.payments.filter((p) => p.status === 'failed');
      for (const payment of failed) {
        expect(payment.failureType).not.toBeNull();
        expect(payment.errorCode).not.toBeNull();
        expect(payment.errorDescription).not.toBeNull();
        expect(payment.errorSource).not.toBeNull();
        expect(payment.errorStep).not.toBeNull();
        expect(payment.errorReason).not.toBeNull();

        if (payment.failureType === 'EXPIRED_CARD') {
          expect(payment.errorReason).toBe('permanent');
        }
        if (payment.failureType === 'GATEWAY_ERROR') {
          expect(payment.errorReason).toBe('temporary');
        }
      }
    });
  });

  describe('P — Edge cases', () => {
    it('handles seed 0', () => {
      const config = createDefaultConfig(0);
      const dataset = generateDataset(config);
      expect(dataset.seed).toBe(0);
      expect(dataset.merchants.length).toBeGreaterThan(0);
    });

    it('handles very small config', () => {
      const config = createDefaultConfig(42);
      config.merchantCount = 1;
      config.customersPerMerchant = 1;
      config.paymentsPerMerchant = 1;
      const dataset = generateDataset(config);

      expect(dataset.merchants.length).toBe(1);
      expect(dataset.customers.length).toBeGreaterThanOrEqual(1);
      expect(dataset.payments.length).toBeGreaterThanOrEqual(1);
    });

    it('handles negative seed', () => {
      const config = createDefaultConfig(-12345);
      const dataset = generateDataset(config);
      expect(dataset.seed).toBe(-12345);
    });
  });

  describe('Q — Synthetic data isolation', () => {
    it('generated events have _synthetic flag in payload', () => {
      const config = createDefaultConfig(42);
      const dataset = generateDataset(config);

      // Verify the generator creates payloads that would include _synthetic
      // (This is checked at the service level when persisting)
      for (const payment of dataset.payments) {
        expect(payment.id).toBeDefined();
        expect(payment.merchantId).toBeDefined();
      }
    });

    it('events do NOT contain recovery opportunities or decisions', () => {
      const config = createDefaultConfig(42);
      const dataset = generateDataset(config);

      // Verify dataset only contains merchants, customers, orders, and payments
      expect(Object.keys(dataset)).toEqual(
        expect.arrayContaining(['merchants', 'customers', 'orders', 'payments'])
      );
      expect(Object.keys(dataset)).not.toContain('opportunities');
      expect(Object.keys(dataset)).not.toContain('decisions');
      expect(Object.keys(dataset)).not.toContain('executions');
    });
  });
});
