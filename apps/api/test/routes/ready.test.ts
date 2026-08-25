import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createDbExecutorMock, makeTestEnv, type DbExecutorMock } from '../helpers.js';

describe('GET /ready', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: DbExecutorMock;

  beforeEach(async () => {
    db = createDbExecutorMock();
    app = await buildApp({ env: makeTestEnv(), db });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns ok when the database is reachable', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    const body: Record<string, unknown> = response.json();
    expect(body['status']).toBe('ok');
    expect(body['service']).toBe('recoveryos');
    expect(body['checks']).toEqual({ database: 'up' });
    expect(typeof body['timestamp']).toBe('string');

    const calls = vi.mocked(db.$queryRaw).mock.calls;
    expect(calls.length).toBe(1);
    expect(String(calls[0]?.[0])).toContain('SELECT 1');
  });

  it('returns 503 with an unavailable status when the database fails', async () => {
    db.$queryRaw.mockImplementation(async () => {
      throw new Error('password authentication failed for user "recoveryos"');
    });

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    const body: Record<string, unknown> = response.json();
    expect(body['status']).toBe('unavailable');
    expect(body['checks']).toEqual({ database: 'down' });
  });

  it('never leaks database failure details in the response body', async () => {
    db.$queryRaw.mockImplementation(async () => {
      throw new Error('postgresql://recoveryos:hunter2@db:5432 - FATAL: role missing');
    });

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    const payload = response.body;
    expect(payload).not.toContain('hunter2');
    expect(payload).not.toContain('FATAL');
    expect(payload).not.toContain('postgresql://');
  });

  it('reports unavailable when the database hangs', async () => {
    db.$queryRaw.mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          setTimeout(resolve, 10_000);
        })
    );

    const response = await app.inject({ method: 'GET', url: '/ready' });

    const body: Record<string, unknown> = response.json();
    expect(response.statusCode).toBe(503);
    expect(body['status']).toBe('unavailable');
  }, 10_000);
});
