import { Prisma, PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';

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
