import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  DemoService,
  type DemoRunResult,
  type DemoScenarioResult,
  type DemoStageTrace,
  type DemoMetrics,
  type DemoStatusResult,
  type ModuleScenarioType,
  type ModuleScenarioResult,
} from '../services/demo.service.js';
import { RecoveryModuleExecutionService } from '../services/recovery-module-execution.service.js';
import { RecoveryExecutionRepository } from '../repositories/recovery-execution.repository.js';

export type {
  DemoRunResult as DemoRunResponse,
  DemoScenarioResult as DemoScenarioResponse,
  DemoStageTrace,
  DemoMetrics,
  DemoStatusResult as DemoStatusResponse,
  ModuleScenarioResult as ModuleScenarioResponse,
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

const MODULE_SCENARIOS = [
  'subscription_success', 'subscription_unsafe',
  'mandate_success', 'mandate_unsafe',
  'b2b_success', 'b2b_promise_broken',
  'checkout_recovery', 'checkout_recent',
  'degradation_incident',
] as const;

const moduleScenarioParamSchema = z.object({
  moduleScenario: z.enum(MODULE_SCENARIOS as unknown as [string, ...string[]]),
});

/**
 * Demo Mode routes (Phase 11.2 + Phase 12).
 *
 * Provides deterministic synthetic scenarios for demonstration purposes.
 * All data is clearly marked as synthetic/demo data. No real customer PII,
 * no real payment credentials, no real production payments are used.
 *
 * Protected by the DEMO_MODE_ENABLED environment variable (default: false).
 */
export const demoRoutes: FastifyPluginAsync = async (app) => {
  const createDemoService = (): DemoService => {
    const executionRepository = new RecoveryExecutionRepository(app.db.recoveryExecution);
    const moduleExecutionService = new RecoveryModuleExecutionService(
      app.opportunities,
      app.decisionService,
      executionRepository,
      app.db.paymentEvent,
      app.leakageService,
      app.merchantMemoryService,
      {
        minConfidence: app.config.RECOVERY_EXECUTION_MIN_CONFIDENCE,
        maxRetries: app.config.RECOVERY_EXECUTION_MAX_RETRIES,
      }
    );

    return new DemoService(
      app.db,
      app.leakageService,
      app.decisionService,
      app.aiAdvisorService,
      app.executionService,
      app.merchantMemoryService,
      app.config.DEMO_MODE_ENABLED,
      moduleExecutionService
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

  app.post<{ Params: { moduleScenario: string }; Reply: ModuleScenarioResult | DemoErrorResponse }>(
    '/demo/run/module/:moduleScenario',
    async (request, reply) => {
      if (!app.config.DEMO_MODE_ENABLED) {
        return reply.status(403).send({
          error: {
            code: 'DEMO_MODE_DISABLED',
            message: 'Demo mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.',
          },
        });
      }

      const paramsParsed = moduleScenarioParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_MODULE_SCENARIO',
            message: `Module scenario must be one of: ${MODULE_SCENARIOS.join(', ')}`,
          },
        });
      }

      const service = createDemoService();
      try {
        const result = await service.runModuleScenario(paramsParsed.data.moduleScenario as ModuleScenarioType);
        return reply.status(201).send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to run module scenario';
        return reply.status(500).send({
          error: {
            code: 'MODULE_SCENARIO_FAILED',
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
