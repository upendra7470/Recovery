import type { FastifyPluginAsync } from 'fastify';
import { NotFoundError } from '../lib/errors.js';
import { parseWith } from '../validation/parse.js';
import {
  executionParamsSchema,
  type ExecutionStatus,
  type RecoveryExecutionRow,
} from '../domain/recovery-execution.js';
import type { ExecutionEligibility } from '../services/recovery-execution.service.js';

export interface ExecutionSummaryResponse {
  id: string;
  action: RecoveryExecutionRow['action'];
  status: ExecutionStatus;
  attempt: number;
  provider: string | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failureCode: string | null;
  failureReason: string | null;
}

export interface ExecutionsListResponse {
  opportunityId: string;
  eligibility: ExecutionEligibility;
  executions: ExecutionSummaryResponse[];
}

export interface ExecutionResultResponse {
  opportunityId: string;
  outcome:
    | 'created'
    | 'replayed'
    | 'provider-rejected'
    | 'provider-unavailable'
    | 'blocked';
  execution: ExecutionSummaryResponse;
}

function toSummary(row: RecoveryExecutionRow): ExecutionSummaryResponse {
  return {
    id: row.id,
    action: row.action,
    status: row.status,
    attempt: row.attempt,
    provider: row.provider,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    failureCode: row.failureCode,
    failureReason: row.failureReason,
  };
}

/**
 * Controlled recovery execution API (Phase 6).
 *
 * The caller selects NOTHING except the opportunity: the action always comes
 * from the fresh deterministic decision, the safety gate always runs, and a
 * provider ACCEPTING a retry is reported as "submitted — awaiting payment
 * outcome", never as recovery. Provider internals are never exposed.
 */
export const executionRoutes: FastifyPluginAsync = async (app) => {
  const service = app.executionService;

  app.post<{ Params: { id: string } }>(
    '/opportunities/:id/execute',
    async (request, reply) => {
      const { id } = parseWith(executionParamsSchema, request.params);
      const result = await service.requestExecution(id);

      switch (result.outcome) {
        case 'not-found':
          throw new NotFoundError('Recovery opportunity');
        case 'disabled':
          return reply.status(503).send({
            error: {
              code: 'EXECUTION_DISABLED',
              message:
                'Recovery execution is disabled. Safety evaluation remains available.',
              requestId: request.id,
              details: { reason: result.assessment.eligibility.reason },
            },
          });
        case 'blocked':
          return reply.status(409).send({
            error: {
              code: 'EXECUTION_BLOCKED',
              message: 'The deterministic safety gate blocked this execution.',
              requestId: request.id,
              details: { reason: result.reason, detail: result.detail },
            },
          });
        case 'provider-unavailable':
          return reply.status(503).send({
            error: {
              code: 'EXECUTION_UNAVAILABLE',
              message:
                'The recovery provider is unavailable; no retry was submitted.',
              requestId: request.id,
              details: {
                reason: result.reason,
                executionStatus: result.execution.status,
                executionId: result.execution.id,
              },
            },
          });
        default: {
          const status = result.outcome === 'replayed' ? 200 : result.outcome === 'created' ? 201 : 200;
          const body: ExecutionResultResponse = {
            opportunityId: id,
            // 'created' here means the request was accepted/submitted — it is
            // NOT payment recovery, which only payment events can confirm.
            outcome: result.outcome,
            execution: toSummary(result.execution),
          };
          return reply.status(status).send(body);
        }
      }
    }
  );

  app.get<{ Params: { id: string }; Reply: ExecutionsListResponse }>(
    '/opportunities/:id/executions',
    async (request, reply) => {
      const { id } = parseWith(executionParamsSchema, request.params);
      const assessment = await service.assess(id);
      if (assessment === null) {
        throw new NotFoundError('Recovery opportunity');
      }

      const executions = await service.listExecutions(id);
      const body: ExecutionsListResponse = {
        opportunityId: id,
        eligibility: assessment.eligibility,
        executions: executions.map(toSummary),
      };
      return reply.send(body);
    }
  );
};
