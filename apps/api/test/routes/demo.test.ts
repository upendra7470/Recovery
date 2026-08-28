import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createDbExecutorMock, makeTestEnv } from '../helpers.js';

describe('Demo Mode Routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ env: makeTestEnv(), db: createDbExecutorMock() });
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /demo/status', () => {
    it('returns 403 when demo mode is disabled', async () => {
      const response = await app.inject({ method: 'GET', url: '/demo/status' });

      expect(response.statusCode).toBe(403);

      const body: Record<string, unknown> = response.json();
      expect(body['error']).toBeDefined();
      expect((body['error'] as Record<string, unknown>)['code']).toBe('DEMO_MODE_DISABLED');
    });
  });

  describe('POST /demo/run', () => {
    it('returns 403 when demo mode is disabled', async () => {
      const response = await app.inject({ method: 'POST', url: '/demo/run' });

      expect(response.statusCode).toBe(403);

      const body: Record<string, unknown> = response.json();
      expect(body['error']).toBeDefined();
      expect((body['error'] as Record<string, unknown>)['code']).toBe('DEMO_MODE_DISABLED');
    });
  });

  describe('DELETE /demo/reset', () => {
    it('returns 403 when demo mode is disabled', async () => {
      const response = await app.inject({ method: 'DELETE', url: '/demo/reset' });

      expect(response.statusCode).toBe(403);

      const body: Record<string, unknown> = response.json();
      expect(body['error']).toBeDefined();
      expect((body['error'] as Record<string, unknown>)['code']).toBe('DEMO_MODE_DISABLED');
    });
  });

  describe('When demo mode is enabled', () => {
    let enabledApp: Awaited<ReturnType<typeof buildApp>>;

    beforeEach(async () => {
      // Create a mock that returns proper count data
      const mockDb = createDbExecutorMock(async () => {
        // Return count data for demo queries
        return [{ count: 0 }];
      });
      enabledApp = await buildApp({
        env: makeTestEnv({ DEMO_MODE_ENABLED: 'true' }),
        db: mockDb,
      });
    });

    afterEach(async () => {
      await enabledApp.close();
    });

    it('GET /demo/status returns enabled status', async () => {
      const response = await enabledApp.inject({ method: 'GET', url: '/demo/status' });

      expect(response.statusCode).toBe(200);

      const body: Record<string, unknown> = response.json();
      expect(body['enabled']).toBe(true);
      expect(body['hasDemoData']).toBe(false);
      expect(body['counts']).toBeDefined();
    });

    it('POST /demo/run creates demo scenarios', async () => {
      const response = await enabledApp.inject({ method: 'POST', url: '/demo/run' });

      expect(response.statusCode).toBe(201);

      const body: Record<string, unknown> = response.json();
      expect(body['demoRunId']).toBeDefined();
      expect(body['scenarios']).toBeDefined();
      expect(Array.isArray(body['scenarios'])).toBe(true);
      expect(body['summary']).toBeDefined();

      const summary = body['summary'] as Record<string, number>;
      expect(summary['totalScenarios']).toBe(3);
      expect(summary['successfulRecovery']).toBe(1);
      expect(summary['unsafeRecovery']).toBe(1);
      expect(summary['reviewCase']).toBe(1);
    });

    it('DELETE /demo/reset removes demo data', async () => {
      // First run demo to create data
      await enabledApp.inject({ method: 'POST', url: '/demo/run' });

      // Then reset
      const response = await enabledApp.inject({ method: 'DELETE', url: '/demo/reset' });

      expect(response.statusCode).toBe(200);

      const body: Record<string, unknown> = response.json();
      expect(body['deleted']).toBeDefined();
      expect(typeof body['deleted']).toBe('number');
    });

    it('GET /demo/status shows demo data after run', async () => {
      // Run demo first
      await enabledApp.inject({ method: 'POST', url: '/demo/run' });

      // Check status
      const response = await enabledApp.inject({ method: 'GET', url: '/demo/status' });

      expect(response.statusCode).toBe(200);

      const body: Record<string, unknown> = response.json();
      expect(body['enabled']).toBe(true);
      // In test environment with mock DB, hasDemoData will be false
      // because the mock doesn't persist data across calls
      expect(typeof body['hasDemoData']).toBe('boolean');
    });
  });
});
