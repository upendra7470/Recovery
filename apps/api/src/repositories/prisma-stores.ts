import type { PrismaClient } from '@prisma/client';
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
  };
}
