import type { FastifyPluginAsync } from 'fastify';
import { DemoService } from '../services/demo.service.js';

export interface DemoStatusResponse {
  enabled: boolean;
  hasDemoData: boolean;
  counts: {
    merchants: number;
    paymentEvents: number;
    opportunities: number;
    decisions: number;
    executions: number;
  };
}

export interface DemoScenarioResponse {
  scenario: string;
  opportunityId: string;
  decisionAction: string;
  executionOutcome: string;
  description: string;
}

export interface DemoRunResponse {
  demoRunId: string;
  scenarios: DemoScenarioResponse[];
  summary: {
    totalScenarios: number;
    successfulRecovery: number;
    unsafeRecovery: number;
    reviewCase: number;
  };
}

export interface DemoResetResponse {
  deleted: number;
}

export interface DemoErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

/**
 * Demo Mode routes (Phase 11).
 *
 * Provides deterministic synthetic scenarios for demonstration purposes.
 * All data is clearly marked as synthetic/demo data. No real customer PII,
 * no real payment credentials, no real production payments are used.
 *
 * Protected by the DEMO_MODE_ENABLED environment variable (default: false).
 */
export const demoRoutes: FastifyPluginAsync = async (app) => {
  const createDemoService = (): DemoService => {
    return new DemoService(
      app.db,
      app.leakageService,
      app.decisionService,
      app.aiAdvisorService,
      app.executionService,
      app.config.DEMO_MODE_ENABLED
    );
  };

  app.get<{ Reply: DemoStatusResponse | DemoErrorResponse }>(
    '/demo/status',
    async (request, reply) => {
      const service = createDemoService();
      const status = await service.getStatus();

      if (!status.enabled) {
        return reply.status(403).send({
          error: {
            code: 'DEMO_MODE_DISABLED',
            message: 'Demo mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.',
          },
        });
      }

      return reply.send(status);
    }
  );

  app.post<{ Reply: DemoRunResponse | DemoErrorResponse }>(
    '/demo/run',
    async (request, reply) => {
      const service = createDemoService();

      if (!app.config.DEMO_MODE_ENABLED) {
        return reply.status(403).send({
          error: {
            code: 'DEMO_MODE_DISABLED',
            message: 'Demo mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.',
          },
        });
      }

      try {
        const result = await service.runDemo();
        return reply.status(201).send(result);
      } catch (error) {
        return reply.status(500).send({
          error: {
            code: 'DEMO_RUN_FAILED',
            message: error instanceof Error ? error.message : 'Failed to run demo',
          },
        });
      }
    }
  );

  app.delete<{ Reply: DemoResetResponse | DemoErrorResponse }>(
    '/demo/reset',
    async (request, reply) => {
      const service = createDemoService();

      if (!app.config.DEMO_MODE_ENABLED) {
        return reply.status(403).send({
          error: {
            code: 'DEMO_MODE_DISABLED',
            message: 'Demo mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.',
          },
        });
      }

      try {
        const result = await service.reset();
        return reply.send(result);
      } catch (error) {
        return reply.status(500).send({
          error: {
            code: 'DEMO_RESET_FAILED',
            message: error instanceof Error ? error.message : 'Failed to reset demo data',
          },
        });
      }
    }
  );
};
