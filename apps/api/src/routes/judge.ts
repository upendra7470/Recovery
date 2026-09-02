import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { JudgeModeError } from '../services/judge-mode.service.js';

const judgeStartBodySchema = z
  .object({
    scenario: z.string(),
    seed: z.number().int().optional(),
    events: z.number().int().min(1).max(10_000).optional(),
    merchantCount: z.number().int().min(1).max(100).optional(),
  })
  .strict();

const judgeParamsSchema = z
  .object({
    runId: z.string().uuid(),
  })
  .strict();

const judgeRunsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const judgeRoutes: FastifyPluginAsync = async (app) => {
  const service = app.judgeModeService;

  /**
   * GET /judge/scenarios — List available judge scenarios.
   */
  app.get('/judge/scenarios', async (_request, reply) => {
    const { JUDGE_SCENARIOS } = await import('../simulation/judge-scenarios.js');
    return reply.send({ scenarios: JUDGE_SCENARIOS });
  });

  /**
   * POST /judge/start — Start a judge scenario.
   */
  app.post<{ Body: Record<string, unknown> }>(
    '/judge/start',
    async (request, reply) => {
      const body = judgeStartBodySchema.parse(request.body);
      const result = await service.startScenario(body);
      return reply.status(201).send(result);
    },
  );

  /**
   * GET /judge/run/:runId — Get judge run status with live metrics.
   */
  app.get<{ Params: { runId: string } }>(
    '/judge/run/:runId',
    async (request, reply) => {
      const { runId } = judgeParamsSchema.parse(request.params);
      const status = await service.getRunStatus(runId);
      if (status === null) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Judge run not found.' },
        });
      }
      return reply.send(status);
    },
  );

  /**
   * GET /judge/run/:runId/analytics — Get detailed analytics for a completed run.
   */
  app.get<{ Params: { runId: string } }>(
    '/judge/run/:runId/analytics',
    async (request, reply) => {
      const { runId } = judgeParamsSchema.parse(request.params);
      const analytics = await service.getAnalytics(runId);
      if (analytics === null) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Analytics not available for this run.' },
        });
      }
      return reply.send(analytics);
    },
  );

  /**
   * GET /judge/runs — List recent judge runs.
   */
  app.get<{ Querystring: Record<string, unknown> }>(
    '/judge/runs',
    async (request, reply) => {
      const query = judgeRunsQuerySchema.parse(request.query);
      const runs = await service.listRuns(query.limit);
      return reply.send({ runs });
    },
  );

  /**
   * DELETE /judge/run/:runId — Delete a judge run.
   */
  app.delete<{ Params: { runId: string } }>(
    '/judge/run/:runId',
    async (request, reply) => {
      const { runId } = judgeParamsSchema.parse(request.params);
      const deleted = await service.deleteRun(runId);
      if (!deleted) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Judge run not found.' },
        });
      }
      return reply.send({ success: true, message: 'Judge run deleted.' });
    },
  );

  // Error handler for JudgeModeError
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof JudgeModeError) {
      return reply.status(400).send({
        error: { code: 'JUDGE_MODE_ERROR', message: error.message },
      });
    }
    throw error;
  });
};
