import { randomUUID } from 'node:crypto';
import { ValidationError } from '../lib/errors.js';
import { SeededRandom } from './seeded-random.js';
import type {
  SyntheticCustomer,
  SyntheticDataset,
  SyntheticDatasetMetrics,
  SyntheticFailureType,
  SyntheticMerchant,
  SyntheticOrder,
  SyntheticPaymentAttempt,
  CustomerBehavior,
  MerchantProfile,
  SyntheticPaymentMethod,
} from './synthetic-data.types.js';
import type { SyntheticDatasetConfig } from './synthetic-data.config.js';
import { validateDistribution, validatePaymentMethods } from './synthetic-data.config.js';

/**
 * Phase 13.1 — Deterministic Synthetic Data Generator.
 *
 * Creates realistic merchants, customers, orders, and payment attempts
 * using a seeded PRNG. The same seed + config always produces the same dataset.
 *
 * This generator is a DATA/EVENT SOURCE only. It does NOT create:
 * - recovery opportunities
 * - recovery decisions
 * - recovery executions
 * - merchant memory entries
 *
 * Those are created by the existing RecoveryOS pipeline when events are processed.
 */

const MERCHANT_PROFILES: MerchantProfile[] = [
  'high_volume_upi',
  'high_card_usage',
  'mixed_methods',
  'subscription_heavy',
  'b2b_high_value',
];

const CUSTOMER_BEHAVIORS: CustomerBehavior[] = [
  'reliable',
  'occasional_failure',
  'frequent_failure',
  'high_value',
  'new_customer',
  'returning',
];

const FAILURE_ERROR_CODES: Record<SyntheticFailureType, string> = {
  GATEWAY_ERROR: 'GATEWAY_ERROR',
  NETWORK_ERROR: 'NETWORK_TIMEOUT',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  EXPIRED_CARD: 'expired_card',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
};

const FAILURE_DESCRIPTIONS: Record<SyntheticFailureType, string> = {
  GATEWAY_ERROR: 'The bank declined the transaction. Please try again.',
  NETWORK_ERROR: 'Network timeout while contacting the bank.',
  INSUFFICIENT_FUNDS: 'Insufficient funds in the account.',
  EXPIRED_CARD: 'The card has expired. Please use a different card.',
  AUTHENTICATION_FAILED: 'Authentication failed. Please verify your details.',
  UNKNOWN_ERROR: 'An unknown error occurred. Please try again.',
};

const FAILURE_SOURCES: Record<SyntheticFailureType, string> = {
  GATEWAY_ERROR: 'bank',
  NETWORK_ERROR: 'network',
  INSUFFICIENT_FUNDS: 'bank',
  EXPIRED_CARD: 'card',
  AUTHENTICATION_FAILED: 'gateway',
  UNKNOWN_ERROR: 'gateway',
};

const FAILURE_STEPS: Record<SyntheticFailureType, string> = {
  GATEWAY_ERROR: 'payment_authorization',
  NETWORK_ERROR: 'payment_processing',
  INSUFFICIENT_FUNDS: 'payment_authorization',
  EXPIRED_CARD: 'payment_authentication',
  AUTHENTICATION_FAILED: 'payment_authentication',
  UNKNOWN_ERROR: 'payment_authorization',
};

const FAILURE_REASONS: Record<SyntheticFailureType, string> = {
  GATEWAY_ERROR: 'temporary',
  NETWORK_ERROR: 'temporary',
  INSUFFICIENT_FUNDS: 'temporary',
  EXPIRED_CARD: 'permanent',
  AUTHENTICATION_FAILED: 'permanent',
  UNKNOWN_ERROR: 'unknown',
};

const MERCHANT_NAMES = [
  'Acme Corp', 'TechFlow Solutions', 'GreenLeaf Retail', 'QuickServe Foods',
  'UrbanStyle Fashion', 'CloudNine SaaS', 'Precision Manufacturing', 'BrightPath Education',
  'Summit Healthcare', 'Riverside Hospitality', 'Atlas Logistics', 'Pinnacle Finance',
  'Evergreen Agriculture', 'NexGen Electronics', 'Horizon Media', 'Sterling Pharmaceuticals',
  'Vanguard Automotive', 'Cobalt Software', 'GoldenGate Ventures', 'Silverline Telecom',
];

const CUSTOMER_FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Arjun', 'Sai', 'Rohan', 'Vihaan', 'Krishna',
  'Diya', 'Ananya', 'Ishita', 'Priya', 'Neha', 'Kavya', 'Aisha', 'Riya',
];

const CUSTOMER_LAST_NAMES = [
  'Patel', 'Sharma', 'Gupta', 'Kumar', 'Singh', 'Reddy', 'Nair', 'Iyer',
  'Joshi', 'Desai', 'Mehta', 'Chauhan', 'Rao', 'Mishra', 'Verma', 'Tiwari',
];

/**
 * Generate a deterministic synthetic dataset.
 *
 * Same seed + config = identical output, always.
 */
export function generateDataset(config: SyntheticDatasetConfig): SyntheticDataset {
  if (!validateDistribution(config.distribution)) {
    throw new ValidationError('Invalid failure distribution: rates must sum to <= 1.0');
  }
  if (!validatePaymentMethods(config.paymentMethodDistribution)) {
    throw new ValidationError('Invalid payment method distribution: rates must sum to ~1.0');
  }

  const rng = new SeededRandom(config.seed);
  const runId = `syn_${config.seed}_${Date.now().toString(36)}`;
  const createdAt = new Date();

  const merchants = generateMerchants(rng, config, createdAt);
  const customers = generateCustomers(rng, merchants, config, createdAt);
  const orders = generateOrders(rng, customers, config);
  const payments = generatePayments(rng, customers, orders, merchants, config);

  return {
    runId,
    seed: config.seed,
    merchants,
    customers,
    orders,
    payments,
    createdAt,
  };
}

/**
 * Compute aggregate metrics from a generated dataset.
 */
export function computeDatasetMetrics(dataset: SyntheticDataset): SyntheticDatasetMetrics {
  const successfulPayments = dataset.payments.filter((p) => p.status === 'captured').length;
  const failedPayments = dataset.payments.filter((p) => p.status === 'failed').length;
  const totalPaymentVolume = dataset.payments.reduce((sum, p) => sum + p.amount, 0);
  const failedPaymentVolume = dataset.payments
    .filter((p) => p.status === 'failed')
    .reduce((sum, p) => sum + p.amount, 0);

  const failureDistribution: Record<SyntheticFailureType, number> = {
    GATEWAY_ERROR: 0,
    NETWORK_ERROR: 0,
    INSUFFICIENT_FUNDS: 0,
    EXPIRED_CARD: 0,
    AUTHENTICATION_FAILED: 0,
    UNKNOWN_ERROR: 0,
  };
  for (const p of dataset.payments) {
    if (p.failureType !== null) {
      failureDistribution[p.failureType]++;
    }
  }

  const paymentMethodDistribution: Record<SyntheticPaymentMethod, number> = {
    card: 0,
    upi: 0,
    netbanking: 0,
    wallet: 0,
  };
  for (const p of dataset.payments) {
    paymentMethodDistribution[p.method]++;
  }

  return {
    runId: dataset.runId,
    seed: dataset.seed,
    createdAt: dataset.createdAt,
    merchantsGenerated: dataset.merchants.length,
    customersGenerated: dataset.customers.length,
    ordersGenerated: dataset.orders.length,
    paymentsGenerated: dataset.payments.length,
    successfulPayments,
    failedPayments,
    totalPaymentVolume,
    failedPaymentVolume,
    failureDistribution,
    paymentMethodDistribution,
  };
}

// ---------------------------------------------------------------------------
// Private generators
// ---------------------------------------------------------------------------

function generateMerchants(
  rng: SeededRandom,
  config: SyntheticDatasetConfig,
  createdAt: Date
): SyntheticMerchant[] {
  const merchants: SyntheticMerchant[] = [];
  const usedNames = new Set<string>();

  for (let i = 0; i < config.merchantCount; i++) {
    let name: string;
    do {
      name = rng.pick(MERCHANT_NAMES);
    } while (usedNames.has(name) && usedNames.size < MERCHANT_NAMES.length);
    usedNames.add(name);

    // If we run out of unique names, append a suffix
    if (usedNames.size >= MERCHANT_NAMES.length && merchants.length >= MERCHANT_NAMES.length) {
      name = `${name} ${merchants.length - MERCHANT_NAMES.length + 2}`;
    }

    merchants.push({
      id: randomUUID(),
      name,
      profile: rng.pick(MERCHANT_PROFILES),
      currency: 'INR',
      createdAt,
    });
  }

  return merchants;
}

function generateCustomers(
  rng: SeededRandom,
  merchants: SyntheticMerchant[],
  config: SyntheticDatasetConfig,
  createdAt: Date
): SyntheticCustomer[] {
  const customers: SyntheticCustomer[] = [];

  for (const merchant of merchants) {
    const count = Math.ceil(config.customersPerMerchant * (0.8 + rng.next() * 0.4));
    for (let i = 0; i < count; i++) {
      const firstName = rng.pick(CUSTOMER_FIRST_NAMES);
      const lastName = rng.pick(CUSTOMER_LAST_NAMES);
      const behavior = assignBehavior(rng);

      customers.push({
        id: randomUUID(),
        merchantId: merchant.id,
        displayId: `${firstName.toLowerCase()}_${lastName.toLowerCase()}_${i}`,
        behavior,
        createdAt,
      });
    }
  }

  return customers;
}

function generateOrders(
  rng: SeededRandom,
  customers: SyntheticCustomer[],
  config: SyntheticDatasetConfig,
): SyntheticOrder[] {
  const orders: SyntheticOrder[] = [];
  const timeRange = config.endDate.getTime() - config.startDate.getTime();

  for (const customer of customers) {
    // Each customer gets a variable number of orders based on behavior
    const orderCount = getOrderCountForBehavior(rng, customer.behavior);

    for (let i = 0; i < orderCount; i++) {
      const amount = getOrderAmount(rng, customer.behavior);
      const orderTime = new Date(
        config.startDate.getTime() + rng.next() * timeRange
      );

      orders.push({
        id: randomUUID(),
        merchantId: customer.merchantId,
        customerId: customer.id,
        amount,
        currency: 'INR',
        createdAt: orderTime,
      });
    }
  }

  return orders;
}

function generatePayments(
  rng: SeededRandom,
  customers: SyntheticCustomer[],
  orders: SyntheticOrder[],
  merchants: SyntheticMerchant[],
  config: SyntheticDatasetConfig,
): SyntheticPaymentAttempt[] {
  const payments: SyntheticPaymentAttempt[] = [];
  const merchantMap = new Map(merchants.map((m) => [m.id, m]));
  const customerMap = new Map(customers.map((c) => [c.id, c]));

  // Flatten the desired payment count per merchant
  const merchantPaymentCounts = new Map<string, number>();
  for (const merchant of merchants) {
    merchantPaymentCounts.set(merchant.id, 0);
  }

  // Generate payments by iterating through orders
  for (const order of orders) {
    const merchant = merchantMap.get(order.merchantId);
    const customer = customerMap.get(order.customerId);
    if (merchant === undefined || customer === undefined) continue;

    const currentCount = merchantPaymentCounts.get(order.merchantId) ?? 0;
    if (currentCount >= config.paymentsPerMerchant) continue;

    // Determine payment method based on merchant profile and config
    const method = selectPaymentMethod(rng, merchant.profile, config.paymentMethodDistribution);

    // Determine outcome based on customer behavior and failure distribution
    const outcome = determineOutcome(rng, customer.behavior, config.distribution);

    // Temporal: payment occurs slightly after order (0–30 minutes)
    const paymentTime = new Date(order.createdAt.getTime() + rng.nextInt(0, 30) * 60 * 1000);

    let failureType: SyntheticFailureType | null = null;
    let errorCode: string | null = null;
    let errorDescription: string | null = null;
    let errorSource: string | null = null;
    let errorStep: string | null = null;
    let errorReason: string | null = null;

    if (outcome !== 'success') {
      failureType = outcome;
      errorCode = FAILURE_ERROR_CODES[failureType];
      errorDescription = FAILURE_DESCRIPTIONS[failureType];
      errorSource = FAILURE_SOURCES[failureType];
      errorStep = FAILURE_STEPS[failureType];
      errorReason = FAILURE_REASONS[failureType];
    }

    const subscriptionId =
      merchant.profile === 'subscription_heavy' && rng.next() < 0.6
        ? `sub_${customer.displayId}_${rng.nextInt(1, 999)}`
        : null;

    payments.push({
      id: randomUUID(),
      merchantId: order.merchantId,
      customerId: order.customerId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      method,
      status: outcome === 'success' ? 'captured' : 'failed',
      failureType,
      errorCode,
      errorDescription,
      errorSource,
      errorStep,
      errorReason,
      subscriptionId,
      createdAt: paymentTime,
    });

    merchantPaymentCounts.set(order.merchantId, currentCount + 1);
  }

  return payments;
}

// ---------------------------------------------------------------------------
// Behavioral helpers
// ---------------------------------------------------------------------------

function assignBehavior(rng: SeededRandom): CustomerBehavior {
  // Distribution: 50% reliable, 20% occasional, 10% frequent, 10% high_value, 5% new, 5% returning
  return rng.pickWeighted(CUSTOMER_BEHAVIORS, [0.50, 0.20, 0.10, 0.10, 0.05, 0.05]);
}

function getOrderCountForBehavior(rng: SeededRandom, behavior: CustomerBehavior): number {
  switch (behavior) {
    case 'reliable':
      return rng.nextInt(3, 8);
    case 'occasional_failure':
      return rng.nextInt(2, 6);
    case 'frequent_failure':
      return rng.nextInt(1, 4);
    case 'high_value':
      return rng.nextInt(1, 3);
    case 'new_customer':
      return rng.nextInt(1, 2);
    case 'returning':
      return rng.nextInt(4, 10);
  }
}

function getOrderAmount(rng: SeededRandom, behavior: CustomerBehavior): number {
  // Amounts in paise (INR)
  switch (behavior) {
    case 'high_value':
      return rng.nextInt(500000, 5000000); // ₹5,000 – ₹50,000
    case 'reliable':
      return rng.nextInt(10000, 500000); // ₹100 – ₹5,000
    case 'returning':
      return rng.nextInt(15000, 300000); // ₹150 – ₹3,000
    case 'new_customer':
      return rng.nextInt(5000, 200000); // ₹50 – ₹2,000
    case 'occasional_failure':
      return rng.nextInt(10000, 400000); // ₹100 – ₹4,000
    case 'frequent_failure':
      return rng.nextInt(8000, 250000); // ₹80 – ₹2,500
  }
}

function determineOutcome(
  rng: SeededRandom,
  behavior: CustomerBehavior,
  distribution: SyntheticDatasetConfig['distribution']
): 'success' | SyntheticFailureType {
  // Adjust failure probability based on behavior
  const behaviorMultiplier = getBehaviorFailureMultiplier(behavior);

  // Create adjusted distribution
  const adjustedSuccessRate = Math.min(1, distribution.successRate * behaviorMultiplier);
  const failureBudget = 1 - adjustedSuccessRate;
  const originalFailureTotal =
    distribution.gatewayErrorRate +
    distribution.networkErrorRate +
    distribution.insufficientFundsRate +
    distribution.expiredCardRate +
    distribution.authenticationFailedRate +
    distribution.unknownErrorRate;

  // Scale failure rates proportionally
  const scale = originalFailureTotal > 0 ? failureBudget / originalFailureTotal : 0;

  const items: Array<'success' | SyntheticFailureType> = [
    'success',
    'GATEWAY_ERROR',
    'NETWORK_ERROR',
    'INSUFFICIENT_FUNDS',
    'EXPIRED_CARD',
    'AUTHENTICATION_FAILED',
    'UNKNOWN_ERROR',
  ];

  const weights = [
    adjustedSuccessRate,
    distribution.gatewayErrorRate * scale,
    distribution.networkErrorRate * scale,
    distribution.insufficientFundsRate * scale,
    distribution.expiredCardRate * scale,
    distribution.authenticationFailedRate * scale,
    distribution.unknownErrorRate * scale,
  ];

  return rng.pickWeighted(items, weights);
}

function getBehaviorFailureMultiplier(behavior: CustomerBehavior): number {
  switch (behavior) {
    case 'reliable':
      return 1.2; // Even more reliable than baseline
    case 'occasional_failure':
      return 0.8; // Slightly more failures
    case 'frequent_failure':
      return 0.4; // Much more failures
    case 'high_value':
      return 1.1; // Slightly more reliable
    case 'new_customer':
      return 0.9; // Slightly more failures
    case 'returning':
      return 1.15; // More reliable than baseline
  }
}

function selectPaymentMethod(
  rng: SeededRandom,
  profile: MerchantProfile,
  baseDistribution: SyntheticDatasetConfig['paymentMethodDistribution']
): SyntheticPaymentMethod {
  // Adjust distribution based on merchant profile
  const dist = { ...baseDistribution };

  switch (profile) {
    case 'high_volume_upi':
      dist.upi *= 2;
      dist.card *= 0.5;
      break;
    case 'high_card_usage':
      dist.card *= 2;
      dist.upi *= 0.5;
      break;
    case 'subscription_heavy':
      dist.card *= 1.5;
      dist.netbanking *= 0.7;
      break;
    case 'b2b_high_value':
      dist.netbanking *= 2;
      dist.wallet *= 0.5;
      break;
    case 'mixed_methods':
      // No adjustment
      break;
  }

  // Normalize weights
  const total = dist.card + dist.upi + dist.netbanking + dist.wallet;
  const normalized = {
    card: dist.card / total,
    upi: dist.upi / total,
    netbanking: dist.netbanking / total,
    wallet: dist.wallet / total,
  };

  return rng.pickWeighted(
    ['card', 'upi', 'netbanking', 'wallet'],
    [normalized.card, normalized.upi, normalized.netbanking, normalized.wallet]
  );
}
