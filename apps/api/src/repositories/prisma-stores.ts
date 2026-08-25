import type { PrismaClient } from '@prisma/client';
import type {
  AccountReference,
  PaymentAccountLookupStore,
  PaymentEventRow,
  PaymentEventStore,
  PaymentProviderName,
} from '../domain/payment-event.js';

/**
 * Prisma-backed implementations of the ingestion store boundaries. These are
 * the ONLY places where Prisma delegates are touched; the rest of the app
 * depends on the domain interfaces.
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
