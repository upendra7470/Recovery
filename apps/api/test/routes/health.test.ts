import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createDbExecutorMock, makeTestEnv } from '../helpers.js';

describe('GET /health', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ env: makeTestEnv(), db: createDbExecutorMock() });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with service identity for a live process', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);

    const body: Record<string, unknown> = response.json();
    expect(body['status']).toBe('ok');
    expect(body['service']).toBe('recoveryos');
    expect(body['environment']).toBe('test');
    expect(typeof body['timestamp']).toBe('string');
    expect(typeof body['uptimeSeconds']).toBe('number');
    expect(body['uptimeSeconds']).toBeGreaterThanOrEqual(0);
  });

  it('does not require the database to be reachable', async () => {
    const failingDb = createDbExecutorMock(async () => {
      throw new Error('database exploded');
    });
    const isolatedApp = await buildApp({
      env: makeTestEnv(),
      db: failingDb,
    });

    try {
      const response = await isolatedApp.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      const body: Record<string, unknown> = response.json();
      expect(body['status']).toBe('ok');
    } finally {
      await isolatedApp.close();
    }
  });

  it('includes a correlation id and basic security headers', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    const requestId = response.headers['x-request-id'];
    expect(typeof requestId).toBe('string');
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('honors an incoming x-request-id when provided', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'test-correlation-id-123' },
    });

    expect(response.headers['x-request-id']).toBe('test-correlation-id-123');
  });
});
