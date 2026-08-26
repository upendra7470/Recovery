import type { FastifyPluginAsync } from 'fastify';
import { NotFoundError } from '../lib/errors.js';
import { parseWith } from '../validation/parse.js';
import { z } from 'zod';

const EXECUTION_STATUSES_FOR_QUERY = [
  'PENDING',
  'AUTHORIZED',
  'EXECUTING',
  'SUCCEEDED',
  'FAILED',
  'BLOCKED',
  'CANCELLED',
] as const;

const operationsListQuerySchema = z
  .object({
    status: z.enum(EXECUTION_STATUSES_FOR_QUERY).optional(),
    merchantId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

const operationsDetailParamsSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Recovery operations & automation API (Phase 7).
 *
 * Observational surface over the execution pipeline: overview counters, a
 * filterable recent-executions feed with reconciliation status (provider
 * acceptance vs webhook-confirmed recovery), and per-execution detail.
 * Nothing here can trigger or mutate executions — that remains exclusively
 * the safety-gated Phase 6 pipeline.
 */
export const operationsRoutes: FastifyPluginAsync = async (app) => {
  const operations = app.operationsService;

  app.get(
    '/operations/overview',
    async (_request, reply) => {
      return reply.send(await operations.overview());
    }
  );

  app.get<{ Querystring: Record<string, unknown> }>(
    '/operations/executions',
    async (request, reply) => {
      const query = parseWith(operationsListQuerySchema, request.query);
      const executions = await operations.listExecutions({
        status: query.status,
        merchantId: query.merchantId,
        limit: query.limit,
      });
      return reply.send({
        executions,
        total: executions.length,
      });
    }
  );

  app.get<{ Params: { id: string } }>(
    '/operations/executions/:id',
    async (request, reply) => {
      const { id } = parseWith(operationsDetailParamsSchema, request.params);
      const detail = await operations.getExecutionDetail(id);
      if (detail === null) {
        throw new NotFoundError('Execution');
      }
      return reply.send(detail);
    }
  );
};
