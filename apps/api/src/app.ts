import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { loadEnv, type AppEnv } from './config/env.js';
import type { AppDatabase } from './lib/database.js';
import { createLoggerOptions } from './lib/logger.js';
import { createAppDatabase, createPrismaClient, type PrismaClient } from './lib/prisma.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerSecurityHeaders } from './plugins/security-headers.js';
import { opportunityRoutes } from './routes/opportunities.js';
import { decisionRoutes } from './routes/decisions.js';
import { healthRoutes } from './routes/health.js';
import { readyRoutes } from './routes/ready.js';
import { webhookRoutes } from './routes/webhooks.js';
import { RecoveryOpportunityRepository } from './repositories/recovery-opportunity.repository.js';
import { RecoveryDecisionRepository } from './repositories/recovery-decision.repository.js';
import { RecoveryDecisionService } from './services/recovery-decision.service.js';

export interface BuildAppOptions {
  env?: AppEnv;
  /** Inject a database implementation (tests); defaults to a real Prisma client. */
  db?: AppDatabase;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? loadEnv();

  let db: AppDatabase;
  let closeDatabase: () => Promise<void>;
  if (options.db) {
    db = options.db;
    closeDatabase = async () => {};
  } else {
    const client: PrismaClient = createPrismaClient(env.DATABASE_URL);
    db = createAppDatabase(client);
    closeDatabase = async () => {
      await client.$disconnect();
    };
  }

  const app = Fastify({
    logger: createLoggerOptions(env),
    genReqId: () => randomUUID(),
    requestIdHeader: 'x-request-id',
    trustProxy: false,
  });

  app.decorate('config', env);
  app.decorate('db', db);
  app.decorate('opportunities', new RecoveryOpportunityRepository(db.recoveryOpportunity));
  const decisionRepository = new RecoveryDecisionRepository(db.recoveryDecision);
  app.decorate('decisions', decisionRepository);
  app.decorate(
    'decisionService',
    new RecoveryDecisionService(
      app.opportunities,
      decisionRepository,
      db.paymentEvent,
      { windowMs: env.DETECTION_WINDOW_HOURS * 60 * 60 * 1000 }
    )
  );

  app.addHook('onRequest', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });

  registerSecurityHeaders(app);
  registerErrorHandler(app);
  await app.register(healthRoutes);
  await app.register(readyRoutes);
  await app.register(webhookRoutes);
  await app.register(opportunityRoutes);
  await app.register(decisionRoutes);

  app.addHook('onClose', async () => {
    await closeDatabase();
  });

  return app;
}
