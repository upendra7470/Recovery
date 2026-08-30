import type { FastifyInstance } from 'fastify';

/**
 * Merchant Memory routes — Phase 11.
 *
 * GET /merchant-memory         — Full merchant memory overview
 * GET /merchant-memory/evidence — Evidence formatted for AI decision context
 * POST /merchant-memory/clear  — Clear all merchant memory (demo reset)
 */
export async function merchantMemoryRoutes(app: FastifyInstance): Promise<void> {
  // Helper: get merchantId from DB (single-merchant mode). Returns null if no merchant exists.
  async function getMerchantId(): Promise<string | null> {
    const result = await app.db.$queryRaw`SELECT id FROM merchants LIMIT 1` as { id: string }[];
    return result.length > 0 ? result[0]!.id : null;
  }

  const EMPTY_OVERVIEW = {
    merchantId: '',
    totalOutcomes: 0,
    totalRecovered: 0,
    totalAmountRecovered: 0,
    recoveryRate: 0,
    bestStrategy: null,
    bestStrategySuccessRate: 0,
    strategies: [],
    failurePatterns: [],
    confidence: 'NO_DATA',
    lastObservedAt: null,
  };

  app.get('/merchant-memory', async (_request, reply) => {
    const merchantId = await getMerchantId();
    if (!merchantId) {
      return reply.send({ ...EMPTY_OVERVIEW });
    }
    const overview = await app.merchantMemoryService.getOverview(merchantId);
    return reply.send(overview);
  });

  app.get('/merchant-memory/evidence', async (_request, reply) => {
    const merchantId = await getMerchantId();
    if (!merchantId) {
      return reply.send({ merchantId: '', strategies: [], failurePatterns: [], confidence: 'NO_DATA' });
    }
    const evidence = await app.merchantMemoryService.getEvidenceForAI(merchantId);
    return reply.send(evidence);
  });

  app.post('/merchant-memory/clear', async (_request, reply) => {
    const merchantId = await getMerchantId();
    if (!merchantId) {
      return reply.send({ cleared: 0 });
    }
    const count = await app.merchantMemoryService.clearAll(merchantId);
    return reply.send({ cleared: count });
  });
}
