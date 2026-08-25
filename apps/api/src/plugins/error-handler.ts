import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { isAppError } from '../lib/errors.js';

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
}

function formatZodIssues(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

function send(
  reply: FastifyReply,
  statusCode: number,
  body: ErrorResponseBody
): FastifyReply {
  return reply.status(statusCode).send(body);
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;

    if (error instanceof ZodError) {
      return send(reply, 422, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed.',
          requestId,
          details: { issues: formatZodIssues(error) },
        },
      });
    }

    if (isAppError(error)) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error }, 'Operational server error');
      }
      return send(reply, error.statusCode, {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      });
    }

    const statusCode =
      typeof error.statusCode === 'number' && error.statusCode < 500 ? error.statusCode : 500;

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Unhandled request error');
      return send(reply, 500, {
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', requestId },
      });
    }

    request.log.warn({ err: error }, 'Rejected request');
    return send(reply, statusCode, {
      error: {
        code: error.code ?? 'REQUEST_ERROR',
        message: error.message,
        requestId,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    return send(reply, 404, {
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} was not found.`,
        requestId: request.id,
      },
    });
  });
}
