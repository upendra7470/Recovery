import { z } from 'zod';

/**
 * Phase 13.1 — Synthetic Dataset Configuration.
 *
 * Controls volume, distributions, and temporal parameters for dataset generation.
 * All fields have sensible defaults; only `seed` is required.
 */

/** Default failure distribution. */
export const DEFAULT_DISTRIBUTION = {
  successRate: 0.85,
  gatewayErrorRate: 0.04,
  networkErrorRate: 0.03,
  insufficientFundsRate: 0.03,
  expiredCardRate: 0.02,
  authenticationFailedRate: 0.02,
  unknownErrorRate: 0.01,
} as const;

/** Default payment method distribution. */
export const DEFAULT_PAYMENT_METHOD_DISTRIBUTION = {
  card: 0.40,
  upi: 0.35,
  netbanking: 0.15,
  wallet: 0.10,
} as const;

export const distributionSchema = z
  .object({
    successRate: z.number().min(0).max(1).default(DEFAULT_DISTRIBUTION.successRate),
    gatewayErrorRate: z.number().min(0).max(1).default(DEFAULT_DISTRIBUTION.gatewayErrorRate),
    networkErrorRate: z.number().min(0).max(1).default(DEFAULT_DISTRIBUTION.networkErrorRate),
    insufficientFundsRate: z.number().min(0).max(1).default(DEFAULT_DISTRIBUTION.insufficientFundsRate),
    expiredCardRate: z.number().min(0).max(1).default(DEFAULT_DISTRIBUTION.expiredCardRate),
    authenticationFailedRate: z.number().min(0).max(1).default(DEFAULT_DISTRIBUTION.authenticationFailedRate),
    unknownErrorRate: z.number().min(0).max(1).default(DEFAULT_DISTRIBUTION.unknownErrorRate),
  })
  .strict();

export type DistributionConfig = z.infer<typeof distributionSchema>;

export const paymentMethodDistributionSchema = z
  .object({
    card: z.number().min(0).max(1).default(DEFAULT_PAYMENT_METHOD_DISTRIBUTION.card),
    upi: z.number().min(0).max(1).default(DEFAULT_PAYMENT_METHOD_DISTRIBUTION.upi),
    netbanking: z.number().min(0).max(1).default(DEFAULT_PAYMENT_METHOD_DISTRIBUTION.netbanking),
    wallet: z.number().min(0).max(1).default(DEFAULT_PAYMENT_METHOD_DISTRIBUTION.wallet),
  })
  .strict();

export type PaymentMethodDistribution = z.infer<typeof paymentMethodDistributionSchema>;

export const syntheticDatasetConfigSchema = z
  .object({
    seed: z.number().int(),
    merchantCount: z.number().int().min(1).max(100).default(10),
    customersPerMerchant: z.number().int().min(1).max(10000).default(500),
    paymentsPerMerchant: z.number().int().min(1).max(50000).default(2000),
    startDate: z.coerce.date().default(() => new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)),
    endDate: z.coerce.date().default(() => new Date()),
    distribution: distributionSchema.default({ ...DEFAULT_DISTRIBUTION }),
    paymentMethodDistribution: paymentMethodDistributionSchema.default({ ...DEFAULT_PAYMENT_METHOD_DISTRIBUTION }),
  })
  .strict()
  .refine((data) => data.endDate > data.startDate, {
    message: 'endDate must be after startDate',
  });

export type SyntheticDatasetConfig = z.infer<typeof syntheticDatasetConfigSchema>;

/** Validate that failure rates sum to <= 1.0 (successRate fills the remainder). */
export function validateDistribution(d: DistributionConfig): boolean {
  const failureSum =
    d.gatewayErrorRate +
    d.networkErrorRate +
    d.insufficientFundsRate +
    d.expiredCardRate +
    d.authenticationFailedRate +
    d.unknownErrorRate;
  return failureSum <= 1.0 && d.successRate >= 0 && d.successRate <= 1.0;
}

/** Validate that payment method rates sum to approximately 1.0. */
export function validatePaymentMethods(p: PaymentMethodDistribution): boolean {
  const sum = p.card + p.upi + p.netbanking + p.wallet;
  return Math.abs(sum - 1.0) < 0.01;
}
