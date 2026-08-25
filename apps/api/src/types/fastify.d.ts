import type { AppEnv } from '../config/env.js';
import type { DbExecutor } from '../lib/database.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppEnv;
    db: DbExecutor;
  }
}
