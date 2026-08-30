import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createDbExecutorMock, makeTestEnv } from '../helpers.js';
import type { FastifyInstance } from 'fastify';

const TEST_MERCHANT_ID = '00000000-0000-4000-8000-000000000001';

describe('Merchant Memory routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      env: makeTestEnv(),
      db: createDbExecutorMock(async () => [{ id: TEST_MERCHANT_ID }]),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /merchant-memory', () => {
    it('returns merchant memory overview', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/merchant-memory',
      });

      expect(response.statusCode).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const body = response.json();
      expect(body).toHaveProperty('merchantId');
      expect(body).toHaveProperty('totalOutcomes');
      expect(body).toHaveProperty('strategies');
      expect(body).toHaveProperty('confidence');
    });
  });

  describe('GET /merchant-memory/evidence', () => {
    it('returns merchant memory evidence for AI', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/merchant-memory/evidence',
      });

      expect(response.statusCode).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const body = response.json();
      expect(body).toHaveProperty('merchantId');
      expect(body).toHaveProperty('strategyPerformance');
      expect(body).toHaveProperty('confidenceLevel');
    });
  });

  describe('POST /merchant-memory/clear', () => {
    it('clears merchant memory', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/merchant-memory/clear',
      });

      expect(response.statusCode).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const body = response.json();
      expect(body).toHaveProperty('cleared');
      expect(typeof (body as { cleared: unknown }).cleared).toBe('number');
    });
  });
});
