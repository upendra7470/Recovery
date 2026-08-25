import type { ZodType } from 'zod';
import { ValidationError } from '../lib/errors.js';

export interface ValidationIssue {
  path: string;
  message: string;
}

export function parseWith<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }));
    throw new ValidationError('Request validation failed.', { issues });
  }
  return result.data;
}
