import type { AppEnv } from '../config/env.js';
import type { AppDatabase } from '../lib/database.js';
import type { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppEnv;
    db: AppDatabase;
  }

  interface FastifyRequest {
    /** Exact raw request bytes, captured before JSON parsing (webhook signatures). */
    rawBody?: Buffer;
  }
}
