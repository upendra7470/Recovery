import type { FastifyPluginAsync } from 'fastify';
import { checkDatabase } from '../lib/database.js';

export interface ReadyChecks {
  database: 'up' | 'down';
}

export interface ReadyOkResponse {
  status: 'ok';
  service: 'recoveryos';
  checks: ReadyChecks;
  timestamp: string;
}

export interface ReadyUnavailableResponse {
  status: 'unavailable';
  service: 'recoveryos';
  checks: ReadyChecks;
  timestamp: string;
}

export type ReadyResponse = ReadyOkResponse | ReadyUnavailableResponse;

export const readyRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: ReadyResponse }>('/ready', async (_request, reply) => {
    const result = await checkDatabase(app.db);

    const timestamp = new Date().toISOString();

    if (result.status === 'up') {
      const body: ReadyOkResponse = {
        status: 'ok',
        service: 'recoveryos',
        checks: { database: 'up' },
        timestamp,
      };
      return reply.status(200).send(body);
    }

    app.log.warn(
      { reason: result.reason },
      'Readiness check failed: database unavailable'
    );
    const body: ReadyUnavailableResponse = {
      status: 'unavailable',
      service: 'recoveryos',
      checks: { database: 'down' },
      timestamp,
    };
    return reply.status(503).send(body);
  });
};
