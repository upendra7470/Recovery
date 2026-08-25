import type { FastifyPluginAsync } from 'fastify';
import type { AppEnv } from '../config/env.js';

export interface HealthResponse {
  status: 'ok';
  service: 'recoveryos';
  environment: AppEnv['NODE_ENV'];
  timestamp: string;
  uptimeSeconds: number;
}

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: HealthResponse }>('/health', () => {
    const body: HealthResponse = {
      status: 'ok',
      service: 'recoveryos',
      environment: app.config.NODE_ENV,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
    return body;
  });
};
