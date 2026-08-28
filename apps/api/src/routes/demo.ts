import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  DemoService,
  type DemoRunResult,
  type DemoScenarioResult,
  type DemoStageTrace,
  type DemoMetrics,
  type DemoStatusResult,
} from '../services/demo.service.js';

export type {
  DemoRunResult as DemoRunResponse,
  DemoScenarioResult as DemoScenarioResponse,
  DemoStageTrace,
  DemoMetrics,
  DemoStatusResult as DemoStatusResponse,
};

export interface DemoResetResponse {
  deleted: number;
}

export interface DemoErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

const runScenarioParamSchema = z.object({
  scenario: z.enum(['successful', 'unsafe', 'review', 'all']),
});

const runScenarioBodySchema = z
  .object({
    scenario: z.enum(['successful', 'unsafe', 'review', 'all']).optional(),
  })
  .optional();

/**
 * Demo Mode routes (Phase 11.2 — Live RecoveryOS Demo Command Center).
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

  app.get<{ Reply: DemoStatusResult | DemoErrorResponse }>(
    '/demo/status',
    async (_request, reply) => {
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

  app.post<{ Body: { scenario?: 'successful' | 'unsafe' | 'review' | 'all' }; Reply: DemoRunResult | DemoErrorResponse }>(
    '/demo/run',
    async (request, reply) => {
      if (!app.config.DEMO_MODE_ENABLED) {
        return reply.status(403).send({
          error: {
            code: 'DEMO_MODE_DISABLED',
            message: 'Demo mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.',
          },
        });
      }

      const bodyParsed = runScenarioBodySchema.safeParse(request.body);
      const scenario = bodyParsed.success ? bodyParsed.data?.scenario : undefined;

      const service = createDemoService();
      try {
        const result = await service.runDemo(scenario);
        return reply.status(201).send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to run demo';
        if (message.includes('already in progress')) {
          return reply.status(409).send({
            error: {
              code: 'DEMO_RUN_IN_PROGRESS',
              message,
            },
          });
        }
        return reply.status(500).send({
          error: {
            code: 'DEMO_RUN_FAILED',
            message,
          },
        });
      }
    }
  );

  app.post<{ Params: { scenario: 'successful' | 'unsafe' | 'review' | 'all' }; Reply: DemoRunResult | DemoErrorResponse }>(
    '/demo/run/:scenario',
    async (request, reply) => {
      if (!app.config.DEMO_MODE_ENABLED) {
        return reply.status(403).send({
          error: {
            code: 'DEMO_MODE_DISABLED',
            message: 'Demo mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.',
          },
        });
      }

      const paramsParsed = runScenarioParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_SCENARIO',
            message: 'Scenario must be one of: successful, unsafe, review, all',
          },
        });
      }

      const service = createDemoService();
      try {
        const result = await service.runDemo(paramsParsed.data.scenario);
        return reply.status(201).send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to run demo';
        if (message.includes('already in progress')) {
          return reply.status(409).send({
            error: {
              code: 'DEMO_RUN_IN_PROGRESS',
              message,
            },
          });
        }
        return reply.status(500).send({
          error: {
            code: 'DEMO_RUN_FAILED',
            message,
          },
        });
      }
    }
  );

  app.delete<{ Reply: DemoResetResponse | DemoErrorResponse }>(
    '/demo/reset',
    async (_request, reply) => {
      if (!app.config.DEMO_MODE_ENABLED) {
        return reply.status(403).send({
          error: {
            code: 'DEMO_MODE_DISABLED',
            message: 'Demo mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.',
          },
        });
      }

      const service = createDemoService();
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
