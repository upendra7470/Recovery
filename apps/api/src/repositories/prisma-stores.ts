import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  AccountReference,
  PaymentAccountLookupStore,
  PaymentEventRow,
  PaymentEventStore,
  PaymentProviderName,
} from '../domain/payment-event.js';
import type {
  NewRecoveryOpportunityData,
  OpportunityFilters,
  RecoveryOpportunityRow,
  RecoveryOpportunityStore,
} from '../domain/recovery-opportunity.js';
import type {
  DecisionFactor,
  DecisionRiskFlagDetail,
  NewRecoveryDecisionData,
  RecoveryDecisionRow,
  RecoveryDecisionStore,
} from '../domain/recovery-decision.js';

/**
 * Prisma-backed implementations of the ingestion/detection store boundaries.
 * These are the ONLY places where Prisma delegates are touched; the rest of
 * the app depends on the domain interfaces.
 */

function toAccountReference(row: { id: string; merchantId: string }): AccountReference {
  return { id: row.id, merchantId: row.merchantId };
}

export function createPrismaPaymentEventStore(client: PrismaClient): PaymentEventStore {
  return {
    async insert(data) {
      const row: PaymentEventRow = await client.paymentEvent.create({ data });
      return row;
    },
    async findByProviderEventId(provider: PaymentProviderName, providerEventId: string) {
      const row = await client.paymentEvent.findFirst({
        where: { provider, providerEventId },
      });
      return row ?? null;
    },
    async findById(id: string) {
      const row = await client.paymentEvent.findUnique({ where: { id } });
      return row ?? null;
    },
    async findRelatedByOrderOrPayment({ providerPaymentId, providerOrderId, occurredAfter, occurredBefore }) {
      const identities: { providerPaymentId?: string; providerOrderId?: string }[] = [];
      if (providerPaymentId !== null) {
        identities.push({ providerPaymentId });
      }
      if (providerOrderId !== null) {
        identities.push({ providerOrderId });
      }
      if (identities.length === 0) {
        return [];
      }
      const rows = await client.paymentEvent.findMany({
        where: {
          OR: identities,
          eventCreatedAt: { gte: occurredAfter, lte: occurredBefore },
        },
        orderBy: { eventCreatedAt: 'asc' },
      });
      return rows;
    },
  };
}

export function createPrismaPaymentAccountLookupStore(
  client: PrismaClient
): PaymentAccountLookupStore {
  return {
    async findActiveByExternalId(provider: PaymentProviderName, externalAccountId: string) {
      const row = await client.paymentAccount.findFirst({
        where: { provider, externalAccountId, status: 'active' },
        select: { id: true, merchantId: true },
      });
      return row ? toAccountReference(row) : null;
    },
    async findById(id: string) {
      const row = await client.paymentAccount.findUnique({
        where: { id },
        select: { id: true, merchantId: true },
      });
      return row ? toAccountReference(row) : null;
    },
  };
}

function toOpportunityWhere(filters: OpportunityFilters) {
  return {
    ...(filters.merchantId !== undefined ? { merchantId: filters.merchantId } : {}),
    ...(filters.status !== undefined ? { status: filters.status } : {}),
    ...(filters.type !== undefined ? { type: filters.type } : {}),
    ...(filters.detectedFrom !== undefined || filters.detectedTo !== undefined
      ? {
          detectedAt: {
            ...(filters.detectedFrom !== undefined ? { gte: filters.detectedFrom } : {}),
            ...(filters.detectedTo !== undefined ? { lte: filters.detectedTo } : {}),
          },
        }
      : {}),
  };
}

export function createPrismaRecoveryOpportunityStore(
  client: PrismaClient
): RecoveryOpportunityStore {
  return {
    async insert(data: NewRecoveryOpportunityData) {
      const row: RecoveryOpportunityRow = await client.recoveryOpportunity.create({ data });
      return row;
    },
    async findBySourceEventAndType(sourceEventId, type) {
      const row = await client.recoveryOpportunity.findFirst({
        where: { sourceEventId, type },
      });
      return row ?? null;
    },
    async findOpenByPaymentCorrelation({ providerPaymentId, providerOrderId }) {
      const identities: { providerPaymentId?: string; providerOrderId?: string }[] = [];
      if (providerPaymentId !== null) {
        identities.push({ providerPaymentId });
      }
      if (providerOrderId !== null) {
        identities.push({ providerOrderId });
      }
      if (identities.length === 0) {
        return [];
      }
      const rows = await client.recoveryOpportunity.findMany({
        where: { status: 'OPEN', OR: identities },
        orderBy: { detectedAt: 'asc' },
      });
      return rows;
    },
    async findById(id) {
      const row = await client.recoveryOpportunity.findUnique({ where: { id } });
      return row ?? null;
    },
    async list(filters) {
      const rows = await client.recoveryOpportunity.findMany({
        where: toOpportunityWhere(filters),
        orderBy: { detectedAt: 'desc' },
        take: 100,
      });
      return rows;
    },
    async count(filters) {
      return client.recoveryOpportunity.count({ where: toOpportunityWhere(filters) });
    },
    async markRecovered({ id, recoveryEventId, resolvedAt }) {
      const row = await client.recoveryOpportunity.update({
        where: { id },
        data: { status: 'RECOVERED', recoveryEventId, resolvedAt },
      });
      return row;
    },
    async summarizeByStatusAndCurrency(merchantId?: string) {
      const grouped = await client.recoveryOpportunity.groupBy({
        by: ['status', 'currency'],
        ...(merchantId !== undefined ? { where: { merchantId } } : {}),
        _count: { _all: true },
        _sum: { amountAtRisk: true },
      });
      return grouped.map((group) => ({
        status: group.status,
        currency: group.currency,
        count: group._count._all,
        totalAmountAtRisk: group._sum.amountAtRisk ?? 0,
      }));
    },
    async countByType(type, merchantId?: string) {
      return client.recoveryOpportunity.count({
        where: { type, ...(merchantId !== undefined ? { merchantId } : {}) },
      });
    },
    async outcomeStatsByType(type) {
      const grouped = await client.recoveryOpportunity.groupBy({
        by: ['status'],
        where: { type },
        _count: { _all: true },
      });
      let total = 0;
      let recovered = 0;
      for (const group of grouped) {
        total += group._count._all;
        if (group.status === 'RECOVERED') {
          recovered += group._count._all;
        }
      }
      return { total, recovered };
    },
  };
}

/**
 * Serialization boundary for the decision JSON columns: Prisma returns
 * JsonValue while the domain works with typed arrays. Everything stored under
 * these keys was written by this store from the same typed shapes, so the
 * assertions below are safe by construction.
 */
function toDecisionRow(row: {
  id: string;
  merchantId: string | null;
  opportunityId: string;
  engineVersion: string;
  score: number;
  priority: RecoveryDecisionRow['priority'];
  confidence: number;
  recommendedAction: RecoveryDecisionRow['recommendedAction'];
  reasons: unknown;
  factors: unknown;
  riskFlags: unknown;
  evaluatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): RecoveryDecisionRow {
  return {
    ...row,
    reasons: row.reasons as string[],
    factors: row.factors as DecisionFactor[],
    riskFlags: row.riskFlags as DecisionRiskFlagDetail[],
  };
}

function toDecisionJsonInput(data: NewRecoveryDecisionData): {
  reasons: Prisma.InputJsonValue;
  factors: Prisma.InputJsonValue;
  riskFlags: Prisma.InputJsonValue;
} {
  return {
    reasons: data.reasons,
    factors: data.factors as unknown as Prisma.InputJsonValue,
    riskFlags: data.riskFlags as unknown as Prisma.InputJsonValue,
  };
}

export function createPrismaRecoveryDecisionStore(client: PrismaClient): RecoveryDecisionStore {
  return {
    async upsert(data) {
      const json = toDecisionJsonInput(data);
      const row = await client.recoveryDecision.upsert({
        where: {
          opportunityId_engineVersion: {
            opportunityId: data.opportunityId,
            engineVersion: data.engineVersion,
          },
        },
        create: { ...data, ...json },
        update: {
          score: data.score,
          priority: data.priority,
          confidence: data.confidence,
          recommendedAction: data.recommendedAction,
          reasons: json.reasons,
          factors: json.factors,
          riskFlags: json.riskFlags,
          evaluatedAt: data.evaluatedAt,
          merchantId: data.merchantId,
        },
      });
      return toDecisionRow(row);
    },
    async findByOpportunityAndEngineVersion(opportunityId, engineVersion) {
      const row = await client.recoveryDecision.findUnique({
        where: { opportunityId_engineVersion: { opportunityId, engineVersion } },
      });
      return row ? toDecisionRow(row) : null;
    },
    async findLatestByOpportunityIds(opportunityIds) {
      if (opportunityIds.length === 0) {
        return [];
      }
      const rows = await client.recoveryDecision.findMany({
        where: { opportunityId: { in: [...opportunityIds] } },
        orderBy: { evaluatedAt: 'desc' },
      });
      return rows.map(toDecisionRow);
    },
    async countByPriority(priority, merchantId?: string) {
      return client.recoveryDecision.count({
        where: { priority, ...(merchantId !== undefined ? { merchantId } : {}) },
      });
    },
    async countByRecommendedAction(recommendedAction, merchantId?: string) {
      return client.recoveryDecision.count({
        where: { recommendedAction, ...(merchantId !== undefined ? { merchantId } : {}) },
      });
    },
    async averageConfidence(merchantId?: string) {
      const aggregated = await client.recoveryDecision.aggregate({
        _avg: { confidence: true },
        ...(merchantId !== undefined ? { where: { merchantId } } : {}),
      });
      return aggregated._avg.confidence ?? null;
    },
  };
}
