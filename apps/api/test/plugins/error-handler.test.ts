import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../../src/app.js';
import { NotFoundError } from '../../src/lib/errors.js';
import { createDbExecutorMock, makeTestEnv } from '../helpers.js';

async function buildTestApp(envOverrides?: Parameters<typeof makeTestEnv>[0]) {
  const app = await buildApp({
    env: makeTestEnv(envOverrides),
    db: createDbExecutorMock(),
  });

  app.post('/echo', async (request) => ({ received: request.body }));

  app.get('/boom', async () => {
    throw new Error('secret internal detail: connection string postgres://u:p@host');
  });

  app.get('/not-found', async () => {
    throw new NotFoundError('Merchant');
  });

  app.get('/zod', async () => {
    const result = z.object({ name: z.string() }).safeParse({ name: 42 });
    if (!result.success) {
      throw result.error;
    }
    return result.data;
  });

  return app;
}

describe('centralized error handling', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('maps unknown errors to a generic 500 envelope without internals', async () => {
    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    const body: { error: Record<string, unknown> } = response.json();
    expect(body.error['code']).toBe('INTERNAL_ERROR');
    expect(body.error['message']).toBe('An unexpected error occurred.');
    expect(typeof body.error['requestId']).toBe('string');
    expect(response.body).not.toContain('secret internal detail');
    expect(response.body).not.toContain('postgres://');
    expect(response.body).not.toContain('stack');
  });

  it('passes AppError status codes and messages through', async () => {
    const response = await app.inject({ method: 'GET', url: '/not-found' });

    expect(response.statusCode).toBe(404);
    const body: { error: Record<string, unknown> } = response.json();
    expect(body.error['code']).toBe('NOT_FOUND');
    expect(body.error['message']).toBe('Merchant not found.');
  });

  it('converts thrown ZodErrors into a structured validation envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/zod' });

    expect(response.statusCode).toBe(422);
    const body: {
      error: { code: string; details?: { issues: { path: string; message: string }[] } };
    } = response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.error.details?.issues)).toBe(true);
    expect(body.error.details?.issues[0]?.path).toBe('name');
  });

  it('wraps unknown routes with a consistent 404 envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/definitely/not/here' });

    expect(response.statusCode).toBe(404);
    const body: { error: Record<string, unknown> } = response.json();
    expect(body.error['code']).toBe('NOT_FOUND');
    expect(String(body.error['message'])).toContain('/definitely/not/here');
    expect(typeof body.error['requestId']).toBe('string');
  });

  it('rejects malformed JSON bodies with a client-error status, not a crash', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: '{ this is not json',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    const body: { error: Record<string, unknown> } = response.json();
    expect(body.error).toBeDefined();
    expect(typeof body.error['message']).toBe('string');
  });
});

describe('error handling hardening in production mode', () => {
  it('keeps unknown errors generic when NODE_ENV is production', async () => {
    const app = await buildTestApp({ NODE_ENV: 'production' });

    try {
      const response = await app.inject({ method: 'GET', url: '/boom' });

      expect(response.statusCode).toBe(500);
      const body: { error: Record<string, unknown> } = response.json();
      expect(body.error['message']).not.toContain('connection string');
      expect(body.error['code']).toBe('INTERNAL_ERROR');
    } finally {
      await app.close();
    }
  });

  it('still returns useful envelopes for operational errors in production', async () => {
    const app = await buildTestApp({ NODE_ENV: 'production' });

    try {
      const response = await app.inject({ method: 'GET', url: '/not-found' });

      expect(response.statusCode).toBe(404);
      const body: { error: Record<string, unknown> } = response.json();
      expect(body.error['code']).toBe('NOT_FOUND');
    } finally {
      await app.close();
    }
  });
});
