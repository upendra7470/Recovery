import type { Prisma } from '@prisma/client';
import { z } from 'zod';

/**
 * Categories of revenue leakage identified by the deterministic detection
 * engine. Mirrors the RecoveryOpportunityType enum in prisma/schema.prisma.
 */
export const RECOVERY_OPPORTUNITY_TYPES = [
  'FAILED_PAYMENT',
  'SUBSCRIPTION_PAYMENT_FAILED',
  'CHECKOUT_DROPOFF',
] as const;
export type RecoveryOpportunityType = (typeof RECOVERY_OPPORTUNITY_TYPES)[number];

/**
 * Lifecycle of a recovery opportunity. Mirrors the RecoveryOpportunityStatus
 * enum in prisma/schema.prisma.
 *
 * Phase 3 only transitions OPEN → RECOVERED (backed by an actual captured
 * payment event). EXPIRED/DISMISSED exist as lifecycle states; transitions to
 * them arrive with the policy/orchestration phases.
 */
export const RECOVERY_OPPORTUNITY_STATUSES = [
  'OPEN',
  'RECOVERED',
  'EXPIRED',
  'DISMISSED',
] as const;
export type RecoveryOpportunityStatus = (typeof RECOVERY_OPPORTUNITY_STATUSES)[number];

/** Persisted shape of a recovery_opportunities row. */
export interface RecoveryOpportunityRow {
  id: string;
  merchantId: string | null;
  paymentAccountId: string | null;
  type: RecoveryOpportunityType;
  status: RecoveryOpportunityStatus;
  sourceEventId: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  /** Amount in the provider's smallest currency unit (paise for INR). */
  amountAtRisk: number;
  currency: string;
  reason: string;
  evidence: unknown;
  recoveryEventId: string | null;
  detectedAt: Date;
  expiresAt: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Data required to persist a new recovery opportunity. */
export interface NewRecoveryOpportunityData {
  merchantId: string | null;
  paymentAccountId: string | null;
  type: RecoveryOpportunityType;
  status: RecoveryOpportunityStatus;
  sourceEventId: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  amountAtRisk: number;
  currency: string;
  reason: string;
  /** JSON-safe detection evidence (see OpportunityEvidence). */
  evidence: Prisma.InputJsonValue;
  recoveryEventId: string | null;
  detectedAt: Date;
  expiresAt: Date | null;
  resolvedAt: Date | null;
}

/**
 * Structured, mandatory explanation attached to every opportunity. All values
 * originate from stored payment events — never estimated or invented.
 */
export interface OpportunityEvidence {
  [key: string]: string | number | boolean | null;
  sourceEventId: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  eventType: string;
  amount: number;
  currency: string;
  occurredAt: string;
  failureCode: string | null;
}

/** Filters accepted by opportunity list/count queries. Merchant id is always
 * honored so queries never cross tenant boundaries. */
export interface OpportunityFilters {
  merchantId?: string;
  status?: RecoveryOpportunityStatus;
  type?: RecoveryOpportunityType;
  detectedFrom?: Date;
  detectedTo?: Date;
}

export const listOpportunitiesQuerySchema = z
  .object({
    merchantId: z.string().uuid().optional(),
    status: z.enum(RECOVERY_OPPORTUNITY_STATUSES).optional(),
    type: z.enum(RECOVERY_OPPORTUNITY_TYPES).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export type ListOpportunitiesQuery = z.infer<typeof listOpportunitiesQuerySchema>;

/** Per-status aggregate used by the overview endpoint. Amounts are summed per
 * currency — currencies are never mixed into a single number. */
export interface OpportunityStatusSummary {
  status: RecoveryOpportunityStatus;
  currency: string;
  count: number;
  totalAmountAtRisk: number;
}

/**
 * Persistence boundary for recovery opportunities. Implemented by the Prisma
 * adapter in repositories/prisma-stores.ts.
 */
export interface RecoveryOpportunityStore {
  insert(data: NewRecoveryOpportunityData): Promise<RecoveryOpportunityRow>;
  findBySourceEventAndType(
    sourceEventId: string,
    type: RecoveryOpportunityType
  ): Promise<RecoveryOpportunityRow | null>;
  /** Open opportunities correlated to a captured payment by payment id or order id. */
  findOpenByPaymentCorrelation(args: {
    providerPaymentId: string | null;
    providerOrderId: string | null;
  }): Promise<RecoveryOpportunityRow[]>;
  findById(id: string): Promise<RecoveryOpportunityRow | null>;
  list(filters: OpportunityFilters): Promise<RecoveryOpportunityRow[]>;
  count(filters: OpportunityFilters): Promise<number>;
  markRecovered(args: {
    id: string;
    recoveryEventId: string;
    resolvedAt: Date;
  }): Promise<RecoveryOpportunityRow>;
  summarizeByStatusAndCurrency(merchantId?: string): Promise<OpportunityStatusSummary[]>;
  countByType(type: RecoveryOpportunityType, merchantId?: string): Promise<number>;
  /**
   * Historical outcome statistics for an opportunity type across ALL merchants
   * (detection history is shared operational knowledge; decisions remain
   * tenant-scoped). Used by the decision engine as historical context.
   */
  outcomeStatsByType(type: RecoveryOpportunityType): Promise<{
    total: number;
    recovered: number;
  }>;
}
