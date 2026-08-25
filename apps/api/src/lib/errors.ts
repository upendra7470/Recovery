export interface AppErrorOptions {
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(statusCode: number, code: string, message: string, options?: AppErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    if (options?.details !== undefined) {
      this.details = options.details;
    }
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed.', details?: Record<string, unknown>) {
    super(422, 'VALIDATION_ERROR', message, { details });
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(404, 'NOT_FOUND', `${resource} not found.`);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict.', details?: Record<string, unknown>) {
    super(409, 'CONFLICT', message, { details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required.') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
