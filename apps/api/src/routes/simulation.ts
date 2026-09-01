import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SyntheticDatasetService } from '../simulation/synthetic-data.service.js';
import { SyntheticEventReplayService } from '../simulation/synthetic-event-replay.service.js';
import { SimulationRunService, MAX_EVENTS } from '../simulation/simulation-run.service.js';
import { SimulationAnalyticsService } from '../services/simulation-analytics.service.js';
import type {
  SyntheticDatasetMetrics,
  SyntheticDatasetPersistResult,
} from '../simulation/synthetic-data.types.js';
import type {
  StartReplayResponse,
  GetReplayResponse,
  ReplaySpeed,
} from '../simulation/synthetic-event-replay.types.js';
import type { SimulationRunRow } from '../domain/simulation-run.js';
import type { SimulationAnalytics } from '../services/simulation-analytics.service.js';

/**
 * Phase 13.1 + 13.2 + 13.3 — Simulation API Routes.
 *
 * Phase 13.1:
 *   POST /simulation/dataset         — Generate + persist a synthetic dataset
 *   POST /simulation/preview         — Preview dataset metrics without persisting
 *   GET  /simulation/status/:runId   — Get status of a generated dataset
 *
 * Phase 13.2:
 *   POST /simulation/replay          — Start replaying a synthetic dataset
 *   GET  /simulation/replay/:replayId — Get replay status
 *   POST /simulation/replay/:replayId/cancel — Cancel a running replay
 *   GET  /simulation/replays         — List all replay runs
 *
 * Phase 13.3:
 *   POST /simulation/run             — Start a simulation run
 *   GET  /simulation/run/:runId      — Get run status
 *   GET  /simulation/run/:runId/analytics — Get detailed analytics
 *   GET  /simulation/runs            — List recent simulation runs
 *   DELETE /simulation/run/:runId    — Delete a simulation run
 *
 * All data is synthetic/demo. No real payment network calls.
 * Protected by DEMO_MODE_ENABLED environment variable.
 */

interface SimulationErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

type SimulationAnalyticsResponse = SimulationAnalytics;

type SimulationPreviewResponse = SyntheticDatasetMetrics;

interface SimulationGenerateRequest {
  seed?: number;
  merchantCount?: number;
  customersPerMerchant?: number;
  paymentsPerMerchant?: number;
  startDate?: string;
  endDate?: string;
}

type SimulationGenerateResponse = SyntheticDatasetPersistResult;

const generateBodySchema = z
  .object({
    seed: z.number().int().optional(),
    merchantCount: z.number().int().min(1).max(100).optional(),
    customersPerMerchant: z.number().int().min(1).max(10000).optional(),
    paymentsPerMerchant: z.number().int().min(1).max(50000).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    merchantId: z.string().uuid().optional(),
    paymentAccountId: z.string().uuid().optional(),
  })
  .strict();

const previewBodySchema = z
  .object({
    seed: z.number().int().optional(),
    merchantCount: z.number().int().min(1).max(100).optional(),
    customersPerMerchant: z.number().int().min(1).max(10000).optional(),
    paymentsPerMerchant: z.number().int().min(1).max(50000).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
  })
  .strict();

const statusParamsSchema = z.object({
  runId: z.string(),
});

const replayBodySchema = z
  .object({
    datasetRunId: z.string().min(1),
    speed: z.enum(['instant', 'fast', 'realtime']).optional(),
    batchSize: z.number().int().min(1).max(1000).optional(),
    merchantId: z.string().uuid().optional(),
  })
  .strict();

const replayParamsSchema = z.object({
  replayId: z.string(),
});

// Phase 13.3 schemas

const runBodySchema = z
  .object({
    seed: z.number().int(),
    events: z.number().int().min(1).max(MAX_EVENTS),
    merchantCount: z.number().int().min(1).max(100).optional(),
  })
  .strict();

const runParamsSchema = z.object({
  runId: z.string().uuid(),
});

const runsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const DEMO_MERCHANT_ID = '00000000-0000-4000-8000-000000000099';
const DEMO_PAYMENT_ACCOUNT_ID = '00000000-0000-4000-8000-000000000098';

export const simulationRoutes: FastifyPluginAsync = async (app) => {
  const createDatasetService = (): SyntheticDatasetService => {
    return new SyntheticDatasetService(app.db.paymentEvent, app.db.paymentAccount);
  };

  const createReplayService = (): SyntheticEventReplayService => {
    return new SyntheticEventReplayService(
      app.db,
      app.leakageService,
      app.decisionService,
      app.executionService,
      app.aiAdvisorService,
      app.merchantMemoryService,
      app.config.DEMO_MODE_ENABLED,
    );
  };

  const createRunService = (): SimulationRunService => {
    return new SimulationRunService(
      app.db,
      createDatasetService(),
      createReplayService(),
    );
  };

  const createAnalyticsService = (): SimulationAnalyticsService => {
    return new SimulationAnalyticsService(app.db);
  };

  // -------------------------------------------------------------------------
  // Phase 13.1 — Dataset Generation
  // -------------------------------------------------------------------------

  /**
   * POST /simulation/dataset
   */
  app.post<{
    Body: SimulationGenerateRequest;
    Reply: SimulationGenerateResponse | SimulationErrorResponse;
  }>(
    '/simulation/dataset',
    async (request, reply) => {
      if (!app.config.DEMO_MODE_ENABLED) {
        return reply.status(403).send({
          error: {
            code: 'SIMULATION_DISABLED',
            message: 'Simulation mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.',
          },
        });
      }

      const bodyParsed = generateBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_REQUEST',
            message: bodyParsed.error.issues.map((i) => i.message).join('; '),
          },
        });
      }

      const body = bodyParsed.data;
      const merchantId = body.merchantId ?? DEMO_MERCHANT_ID;
      const paymentAccountId = body.paymentAccountId ?? DEMO_PAYMENT_ACCOUNT_ID;
      const seed = body.seed ?? Math.floor(Math.random() * 1000000);

      const configOverrides: Record<string, unknown> = {};
      if (body.merchantCount !== undefined) configOverrides.merchantCount = body.merchantCount;
      if (body.customersPerMerchant !== undefined)
        configOverrides.customersPerMerchant = body.customersPerMerchant;
      if (body.paymentsPerMerchant !== undefined)
        configOverrides.paymentsPerMerchant = body.paymentsPerMerchant;
      if (body.startDate !== undefined) configOverrides.startDate = new Date(body.startDate);
      if (body.endDate !== undefined) configOverrides.endDate = new Date(body.endDate);

      const service = createDatasetService();
      const config = service.createConfig(seed, configOverrides);

      try {
        const result = await service.generateAndPersist(config, merchantId, paymentAccountId);
        return reply.status(201).send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to generate dataset';
        return reply.status(500).send({
          error: { code: 'DATASET_GENERATION_FAILED', message },
        });
      }
    }
  );

  /**
   * POST /simulation/preview
   */
  app.post<{
    Body: SimulationPreviewResponse;
    Reply: SimulationPreviewResponse | SimulationErrorResponse;
  }>(
    '/simulation/preview',
    async (request, reply) => {
      if (!app.config.DEMO_MODE_ENABLED) {
        return reply.status(403).send({
          error: {
            code: 'SIMULATION_DISABLED',
            message: 'Simulation mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.',
          },
        });
      }

      const bodyParsed = previewBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_REQUEST',
            message: bodyParsed.error.issues.map((i) => i.message).join('; '),
          },
        });
      }

      const body = bodyParsed.data;
      const seed = body.seed ?? Math.floor(Math.random() * 1000000);

      const configOverrides: Record<string, unknown> = {};
      if (body.merchantCount !== undefined) configOverrides.merchantCount = body.merchantCount;
      if (body.customersPerMerchant !== undefined)
        configOverrides.customersPerMerchant = body.customersPerMerchant;
      if (body.paymentsPerMerchant !== undefined)
        configOverrides.paymentsPerMerchant = body.paymentsPerMerchant;
      if (body.startDate !== undefined) configOverrides.startDate = new Date(body.startDate);
      if (body.endDate !== undefined) configOverrides.endDate = new Date(body.endDate);

      const service = createDatasetService();
      const config = service.createConfig(seed, configOverrides);

      try {
        const result = service.preview(config);
        return reply.send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to preview dataset';
        return reply.status(500).send({
          error: { code: 'DATASET_PREVIEW_FAILED', message },
        });
      }
    }
  );

  /**
   * GET /simulation/status/:runId
   */
  app.get<{
    Params: { runId: string };
    Reply: { runId: string; status: string } | SimulationErrorResponse;
  }>(
    '/simulation/status/:runId',
    async (request, reply) => {
      if (!app.config.DEMO_MODE_ENABLED) {
        return reply.status(403).send({
          error: {
            code: 'SIMULATION_DISABLED',
            message: 'Simulation mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.',
          },
        });
      }

      const paramsParsed = statusParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_RUN_ID', message: 'Invalid run ID format.' },
        });
      }

      return reply.send({
        runId: paramsParsed.data.runId,
        status: 'completed',
      });
    }
  );

  // -------------------------------------------------------------------------
  // Phase 13.2 — Event Replay
  // -------------------------------------------------------------------------

  /**
   * POST /simulation/replay
   */
  app.post<{
    Body: { datasetRunId: string; speed?: ReplaySpeed; batchSize?: number; merchantId?: string };
    Reply: StartReplayResponse | SimulationErrorResponse;
  }>(
    '/simulation/replay',
    async (request, reply) => {
      if (!app.config.DEMO_MODE_ENABLED) {
        return reply.status(403).send({
          error: {
            code: 'SIMULATION_DISABLED',
            message: 'Simulation mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.',
          },
        });
      }

      const bodyParsed = replayBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_REQUEST',
            message: bodyParsed.error.issues.map((i) => i.message).join('; '),
          },
        });
      }

      const body = bodyParsed.data;
      const service = createReplayService();

      try {
        const result = await service.startReplay({
          datasetRunId: body.datasetRunId,
          speed: body.speed,
          batchSize: body.batchSize,
          merchantId: body.merchantId,
        });
        return reply.status(201).send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start replay';
        if (message.includes('already in progress')) {
          return reply.status(409).send({
            error: { code: 'REPLAY_IN_PROGRESS', message },
          });
        }
        return reply.status(500).send({
          error: { code: 'REPLAY_FAILED', message },
        });
      }
    }
  );

  /**
   * GET /simulation/replay/:replayId
   */
  app.get<{
    Params: { replayId: string };
    Reply: GetReplayResponse | SimulationErrorResponse;
  }>(
    '/simulation/replay/:replayId',
    async (request, reply) => {
      if (!app.config.DEMO_MODE_ENABLED) {
        return reply.status(403).send({
          error: {
            code: 'SIMULATION_DISABLED',
            message: 'Simulation mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.',
          },
        });
      }

      const paramsParsed = replayParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_REPLAY_ID', message: 'Invalid replay ID format.' },
        });
      }

      const service = createReplayService();
      const result = service.getReplayStatus(paramsParsed.data.replayId);

      if (!result) {
        return reply.status(404).send({
          error: { code: 'REPLAY_NOT_FOUND', message: `Replay not found: ${paramsParsed.data.replayId}` },
        });
      }

      return reply.send(result);
    }
  );

  /**
   * POST /simulation/replay/:replayId/cancel
   */
  app.post<{
    Params: { replayId: string };
    Reply: { success: boolean; message: string } | SimulationErrorResponse;
  }>(
    '/simulation/replay/:replayId/cancel',
    async (request, reply) => {
      if (!app.config.DEMO_MODE_ENABLED) {
        return reply.status(403).send({
          error: {
            code: 'SIMULATION_DISABLED',
            message: 'Simulation mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.',
          },
        });
      }

      const paramsParsed = replayParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_REPLAY_ID', message: 'Invalid replay ID format.' },
        });
      }

      const service = createReplayService();
      const success = service.cancelReplay(paramsParsed.data.replayId);

      if (!success) {
        return reply.status(404).send({
          error: { code: 'REPLAY_NOT_FOUND_OR_NOT_RUNNING', message: 'Replay not found or not in RUNNING state.' },
        });
      }

      return reply.send({ success: true, message: 'Replay cancelled successfully.' });
    }
  );

  /**
   * GET /simulation/replays
   */
  app.get<{
    Reply: Array<{ replayId: string; datasetRunId: string; status: string; createdAt: string }> | SimulationErrorResponse;
  }>(
    '/simulation/replays',
    async (request, reply) => {
      if (!app.config.DEMO_MODE_ENABLED) {
        return reply.status(403).send({
          error: {
            code: 'SIMULATION_DISABLED',
            message: 'Simulation mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.',
          },
        });
      }

      const service = createReplayService();
      const replays = service.listReplays();

      return reply.send(
        replays.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        }))
      );
    }
  );

  // -------------------------------------------------------------------------
  // Phase 13.3 — Simulation Run + Analytics
  // -------------------------------------------------------------------------

  /**
   * POST /simulation/run
   *
   * Start a full simulation run: generate dataset → replay → persist results.
   */
  app.post<{
    Body: { seed: number; events: number; merchantCount?: number };
    Reply: { runId: string; status: string; seed: number; totalEvents: number; merchantCount: number } | SimulationErrorResponse;
  }>(
    '/simulation/run',
    async (request, reply) => {
      if (!app.config.DEMO_MODE_ENABLED) {
        return reply.status(403).send({
          error: {
            code: 'SIMULATION_DISABLED',
            message: 'Simulation mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.',
          },
        });
      }

      const bodyParsed = runBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_REQUEST',
            message: bodyParsed.error.issues.map((i) => i.message).join('; '),
          },
        });
      }

      const body = bodyParsed.data;
      const service = createRunService();

      try {
        const result = await service.startRun({
          seed: body.seed,
          events: body.events,
          merchantCount: body.merchantCount,
        });
        return reply.status(201).send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start simulation';
        if (message.includes('already in progress')) {
          return reply.status(409).send({
            error: { code: 'SIMULATION_IN_PROGRESS', message },
          });
        }
        if (message.includes('exceeds maximum') || message.includes('must be at least')) {
          return reply.status(400).send({
            error: { code: 'INVALID_EVENT_COUNT', message },
          });
        }
        return reply.status(500).send({
          error: { code: 'SIMULATION_FAILED', message },
        });
      }
    }
  );

  /**
   * GET /simulation/run/:runId
   *
   * Get simulation run status and current metrics.
   */
  app.get<{
    Params: { runId: string };
    Reply: SimulationRunRow | SimulationErrorResponse;
  }>(
    '/simulation/run/:runId',
    async (request, reply) => {
      if (!app.config.DEMO_MODE_ENABLED) {
        return reply.status(403).send({
          error: {
            code: 'SIMULATION_DISABLED',
            message: 'Simulation mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.',
          },
        });
      }

      const paramsParsed = runParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_RUN_ID', message: 'Invalid run ID format.' },
        });
      }

      const service = createRunService();
      const run = await service.getRunStatus(paramsParsed.data.runId);

      if (!run) {
        return reply.status(404).send({
          error: { code: 'RUN_NOT_FOUND', message: `Simulation run not found: ${paramsParsed.data.runId}` },
        });
      }

      return reply.send(run);
    }
  );

  /**
   * GET /simulation/run/:runId/analytics
   *
   * Get detailed analytics for a simulation run.
   */
  app.get<{
    Params: { runId: string };
    Reply: SimulationAnalyticsResponse | SimulationErrorResponse;
  }>(
    '/simulation/run/:runId/analytics',
    async (request, reply) => {
      if (!app.config.DEMO_MODE_ENABLED) {
        return reply.status(403).send({
          error: {
            code: 'SIMULATION_DISABLED',
            message: 'Simulation mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.',
          },
        });
      }

      const paramsParsed = runParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_RUN_ID', message: 'Invalid run ID format.' },
        });
      }

      const analyticsService = createAnalyticsService();
      const analytics = await analyticsService.getAnalytics(paramsParsed.data.runId);

      if (!analytics) {
        return reply.status(404).send({
          error: { code: 'RUN_NOT_FOUND', message: `Simulation run not found: ${paramsParsed.data.runId}` },
        });
      }

      return reply.send(analytics);
    }
  );

  /**
   * GET /simulation/runs
   *
   * List recent simulation runs.
   */
  app.get<{
    Querystring: { limit?: number };
    Reply: SimulationRunRow[] | SimulationErrorResponse;
  }>(
    '/simulation/runs',
    async (request, reply) => {
      if (!app.config.DEMO_MODE_ENABLED) {
        return reply.status(403).send({
          error: {
            code: 'SIMULATION_DISABLED',
            message: 'Simulation mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.',
          },
        });
      }

      const queryParsed = runsQuerySchema.safeParse(request.query);
      const limit = queryParsed.success ? queryParsed.data.limit : 20;

      const service = createRunService();
      const runs = await service.listRuns(limit ?? 20);

      return reply.send(runs);
    }
  );

  /**
   * DELETE /simulation/run/:runId
   *
   * Delete a simulation run.
   */
  app.delete<{
    Params: { runId: string };
    Reply: { success: boolean; message: string } | SimulationErrorResponse;
  }>(
    '/simulation/run/:runId',
    async (request, reply) => {
      if (!app.config.DEMO_MODE_ENABLED) {
        return reply.status(403).send({
          error: {
            code: 'SIMULATION_DISABLED',
            message: 'Simulation mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.',
          },
        });
      }

      const paramsParsed = runParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_RUN_ID', message: 'Invalid run ID format.' },
        });
      }

      const service = createRunService();
      const deleted = await service.deleteRun(paramsParsed.data.runId);

      if (!deleted) {
        return reply.status(404).send({
          error: { code: 'RUN_NOT_FOUND', message: `Simulation run not found: ${paramsParsed.data.runId}` },
        });
      }

      return reply.send({ success: true, message: 'Simulation run deleted successfully.' });
    }
  );
};
