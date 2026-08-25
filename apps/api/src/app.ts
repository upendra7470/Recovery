import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { loadEnv, type AppEnv } from './config/env.js';
import type { DbExecutor } from './lib/database.js';
import { createLoggerOptions } from './lib/logger.js';
import { createPrismaClient } from './lib/prisma.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerSecurityHeaders } from './plugins/security-headers.js';
import { healthRoutes } from './routes/health.js';
import { readyRoutes } from './routes/ready.js';

export interface BuildAppOptions {
  env?: AppEnv;
  db?: DbExecutor;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? loadEnv();
  const db = options.db ?? createPrismaClient(env.DATABASE_URL);

  const app = Fastify({
    logger: createLoggerOptions(env),
    genReqId: () => randomUUID(),
    requestIdHeader: 'x-request-id',
    trustProxy: false,
  });

  app.decorate('config', env);
  app.decorate('db', db);

  app.addHook('onRequest', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });

  registerSecurityHeaders(app);
  registerErrorHandler(app);
  await app.register(healthRoutes);
  await app.register(readyRoutes);

  app.addHook('onClose', async () => {
    if (typeof db.$disconnect === 'function') {
      await db.$disconnect();
    }
  });

  return app;
}
