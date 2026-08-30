import { Prisma, PrismaClient } from '@prisma/client';
import type { AppDatabase } from './database.js';
import type { Logger } from 'pino';
import {
  createPrismaPaymentAccountLookupStore,
  createPrismaPaymentEventStore,
  createPrismaRecoveryAIAdviceStore,
  createPrismaRecoveryDecisionStore,
  createPrismaRecoveryExecutionStore,
  createPrismaRecoveryOpportunityStore,
  createPrismaAuthenticationStore,
  createPrismaMerchantStrategyMemoryStore,
} from '../repositories/prisma-stores.js';

export type { PrismaClient };

export function createPrismaClient(databaseUrl: string, logger?: Logger): PrismaClient {
  const client = new PrismaClient({
    datasourceUrl: databaseUrl,
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  if (logger) {
    client.$on('warn', (event: Prisma.LogEvent) => {
      logger.warn({ target: event.target, message: event.message }, 'Prisma warning');
    });
    client.$on('error', (event: Prisma.LogEvent) => {
      logger.error({ target: event.target, message: event.message }, 'Prisma error');
    });
  }

  return client;
}

/**
 * Builds the full AppDatabase contract from a real Prisma client: raw SQL
 * access plus the domain store boundaries used by feature code.
 */
export function createAppDatabase(client: PrismaClient): AppDatabase {
  return {
    $queryRaw: (strings, ...values) => client.$queryRaw(strings, ...values),
    $disconnect: () => client.$disconnect(),
    paymentEvent: createPrismaPaymentEventStore(client),
    paymentAccount: createPrismaPaymentAccountLookupStore(client),
    recoveryOpportunity: createPrismaRecoveryOpportunityStore(client),
    recoveryDecision: createPrismaRecoveryDecisionStore(client),
    recoveryAIAdvice: createPrismaRecoveryAIAdviceStore(client),
    recoveryExecution: createPrismaRecoveryExecutionStore(client),
    auth: createPrismaAuthenticationStore(client),
    merchantStrategyMemory: createPrismaMerchantStrategyMemoryStore(client),
  };
}
