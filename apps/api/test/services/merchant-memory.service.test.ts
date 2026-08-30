import { describe, it, expect, beforeEach } from 'vitest';
import { MerchantMemoryService } from '../../src/services/merchant-memory.service.js';
import { createMerchantStrategyMemoryStoreMock } from '../helpers.js';
import type { MerchantStrategyMemoryStore } from '../../src/domain/merchant-memory.js';

describe('MerchantMemoryService', () => {
  let store: MerchantStrategyMemoryStore;
  let service: MerchantMemoryService;

  beforeEach(() => {
    store = createMerchantStrategyMemoryStoreMock();
    service = new MerchantMemoryService(store);
  });

  describe('recordOutcome', () => {
    it('records a successful outcome', async () => {
      await service.recordOutcome(
        'merchant-1',
        'RETRY',
        'GATEWAY_ERROR',
        'success',
        249900,
        249900
      );

      const overview = await service.getOverview('merchant-1');
      expect(overview.totalOutcomes).toBe(1);
      expect(overview.totalRecovered).toBe(1);
      expect(overview.totalAmountRecovered).toBe(249900);
      expect(overview.strategies).toHaveLength(1);
      expect(overview.strategies[0]!.successRate).toBe(1);
    });

    it('records a failed outcome', async () => {
      await service.recordOutcome(
        'merchant-1',
        'RETRY',
        'GATEWAY_ERROR',
        'failure',
        249900,
        0
      );

      const overview = await service.getOverview('merchant-1');
      expect(overview.totalOutcomes).toBe(1);
      expect(overview.totalRecovered).toBe(0);
      expect(overview.strategies[0]!.successRate).toBe(0);
    });

    it('accumulates multiple outcomes', async () => {
      await service.recordOutcome('merchant-1', 'RETRY', 'GATEWAY_ERROR', 'success', 100000, 100000);
      await service.recordOutcome('merchant-1', 'RETRY', 'GATEWAY_ERROR', 'failure', 100000, 0);
      await service.recordOutcome('merchant-1', 'RETRY', 'GATEWAY_ERROR', 'success', 100000, 100000);

      const overview = await service.getOverview('merchant-1');
      expect(overview.totalOutcomes).toBe(3);
      expect(overview.totalRecovered).toBe(2);
      expect(overview.strategies[0]!.successRate).toBeCloseTo(2 / 3);
    });

    it('calculates effectiveness score correctly', async () => {
      // Record 10 successful outcomes
      for (let i = 0; i < 10; i++) {
        await service.recordOutcome('merchant-1', 'RETRY', 'GATEWAY_ERROR', 'success', 100000, 100000);
      }

      const overview = await service.getOverview('merchant-1');
      expect(overview.strategies[0]!.effectivenessScore).toBeGreaterThan(50);
    });
  });

  describe('recordBlocked', () => {
    it('records a blocked execution', async () => {
      await service.recordBlocked('merchant-1', 'DO_NOT_RETRY', 'expired_card');

      const overview = await service.getOverview('merchant-1');
      expect(overview.strategies).toHaveLength(1);
      expect(overview.strategies[0]!.blocked).toBe(1);
    });

    it('increments blocked count on repeated calls', async () => {
      await service.recordBlocked('merchant-1', 'DO_NOT_RETRY', 'expired_card');
      await service.recordBlocked('merchant-1', 'DO_NOT_RETRY', 'expired_card');

      const overview = await service.getOverview('merchant-1');
      expect(overview.strategies[0]!.blocked).toBe(2);
    });
  });

  describe('recordHumanReview', () => {
    it('records a human review', async () => {
      await service.recordHumanReview('merchant-1', 'REVIEW', 'UNKNOWN_ERROR');

      const overview = await service.getOverview('merchant-1');
      expect(overview.strategies).toHaveLength(1);
      expect(overview.strategies[0]!.humanReviews).toBe(1);
    });
  });

  describe('getOverview', () => {
    it('returns empty overview when no data', async () => {
      const overview = await service.getOverview('merchant-1');
      expect(overview.totalOutcomes).toBe(0);
      expect(overview.confidence).toBe('NO_DATA');
      expect(overview.strategies).toHaveLength(0);
    });

    it('returns LOW confidence with fewer than 20 outcomes', async () => {
      for (let i = 0; i < 10; i++) {
        await service.recordOutcome('merchant-1', 'RETRY', 'GATEWAY_ERROR', 'success', 100000, 100000);
      }

      const overview = await service.getOverview('merchant-1');
      expect(overview.confidence).toBe('LOW');
    });

    it('returns SUFFICIENT confidence with 20+ outcomes', async () => {
      for (let i = 0; i < 20; i++) {
        await service.recordOutcome('merchant-1', 'RETRY', 'GATEWAY_ERROR', 'success', 100000, 100000);
      }

      const overview = await service.getOverview('merchant-1');
      expect(overview.confidence).toBe('SUFFICIENT');
    });

    it('identifies best strategy', async () => {
      // Record outcomes for RETRY strategy (high success)
      for (let i = 0; i < 5; i++) {
        await service.recordOutcome('merchant-1', 'RETRY', 'GATEWAY_ERROR', 'success', 100000, 100000);
      }

      // Record outcomes for WAIT strategy (low success)
      for (let i = 0; i < 5; i++) {
        await service.recordOutcome('merchant-1', 'WAIT', 'GATEWAY_ERROR', 'failure', 100000, 0);
      }

      const overview = await service.getOverview('merchant-1');
      expect(overview.bestStrategy).toBe('RETRY');
    });

    it('groups failure patterns correctly', async () => {
      await service.recordOutcome('merchant-1', 'RETRY', 'GATEWAY_ERROR', 'success', 100000, 100000);
      await service.recordOutcome('merchant-1', 'RETRY', 'INSUFFICIENT_FUNDS', 'failure', 100000, 0);

      const overview = await service.getOverview('merchant-1');
      expect(overview.failurePatterns).toHaveLength(2);
    });
  });

  describe('getEvidenceForAI', () => {
    it('returns empty evidence when no data', async () => {
      const evidence = await service.getEvidenceForAI('merchant-1');
      expect(evidence.totalOutcomes).toBe(0);
      expect(evidence.confidenceLevel).toBe('NO_DATA');
      expect(evidence.strategyPerformance).toHaveLength(0);
    });

    it('returns strategy performance data', async () => {
      await service.recordOutcome('merchant-1', 'RETRY', 'GATEWAY_ERROR', 'success', 100000, 100000);
      await service.recordOutcome('merchant-1', 'RETRY', 'GATEWAY_ERROR', 'success', 100000, 100000);

      const evidence = await service.getEvidenceForAI('merchant-1');
      expect(evidence.strategyPerformance).toHaveLength(1);
      expect(evidence.strategyPerformance[0]!.strategy).toBe('RETRY');
      expect(evidence.strategyPerformance[0]!.successRate).toBe(1);
    });
  });

  describe('calculateEffectivenessScore', () => {
    it('returns higher score for higher success rate', () => {
      const highScore = service.calculateEffectivenessScore(0.9, 0.8, 20);
      const lowScore = service.calculateEffectivenessScore(0.1, 0.1, 20);
      expect(highScore).toBeGreaterThan(lowScore);
    });

    it('returns higher score for more samples', () => {
      const fewSamples = service.calculateEffectivenessScore(0.5, 0.5, 5);
      const manySamples = service.calculateEffectivenessScore(0.5, 0.5, 50);
      expect(manySamples).toBeGreaterThan(fewSamples);
    });

    it('caps score at 100', () => {
      const score = service.calculateEffectivenessScore(1, 1, 100);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe('calculateConfidence', () => {
    it('returns 0 for 0 samples', () => {
      expect(service.calculateConfidence(0)).toBe(0);
    });

    it('returns higher confidence for more samples', () => {
      const low = service.calculateConfidence(5);
      const high = service.calculateConfidence(50);
      expect(high).toBeGreaterThan(low);
    });

    it('returns near 95 for 100+ samples', () => {
      const score = service.calculateConfidence(100);
      expect(score).toBeGreaterThanOrEqual(90);
    });
  });

  describe('clearAll', () => {
    it('clears all merchant memory', async () => {
      await service.recordOutcome('merchant-1', 'RETRY', 'GATEWAY_ERROR', 'success', 100000, 100000);
      await service.recordOutcome('merchant-1', 'WAIT', 'GATEWAY_ERROR', 'failure', 100000, 0);

      const cleared = await service.clearAll('merchant-1');
      expect(cleared).toBe(2);

      const overview = await service.getOverview('merchant-1');
      expect(overview.totalOutcomes).toBe(0);
    });
  });

  describe('merchant isolation', () => {
    it('isolates memory by merchant ID', async () => {
      await service.recordOutcome('merchant-1', 'RETRY', 'GATEWAY_ERROR', 'success', 100000, 100000);
      await service.recordOutcome('merchant-2', 'RETRY', 'GATEWAY_ERROR', 'failure', 100000, 0);

      const overview1 = await service.getOverview('merchant-1');
      const overview2 = await service.getOverview('merchant-2');

      expect(overview1.totalOutcomes).toBe(1);
      expect(overview1.totalRecovered).toBe(1);
      expect(overview2.totalOutcomes).toBe(1);
      expect(overview2.totalRecovered).toBe(0);
    });
  });
});
