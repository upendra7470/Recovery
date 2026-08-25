import { describe, expect, it } from 'vitest';
import {
  InMemoryRecoveryDecisionStore,
} from '../helpers.js';
import { RecoveryDecisionRepository } from '../../src/repositories/recovery-decision.repository.js';

const MERCHANT_A = '11111111-1111-4111-8111-111111111111';
const OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000001';

function result(overrides: Record<string, unknown> = {}) {
  return {
    score: 78,
    priority: 'HIGH' as const,
    confidence: 71,
    recommendedAction: 'RETRY' as const,
    reasons: ['High recoverable value', 'Failure appears transient'],
    factors: [
      {
        name: 'value',
        contribution: 21,
        value: 500_000,
        explanation: 'Recoverable amount contributes 21/25 points.',
      },
    ],
    riskFlags: [
      {
        flag: 'INSUFFICIENT_HISTORICAL_DATA' as const,
        explanation: 'Only 3 historical outcomes available.',
      },
    ],
    ...overrides,
  };
}

describe('RecoveryDecisionRepository', () => {
  it('persists an engine result with attribution copied from the opportunity', async () => {
    const store = new InMemoryRecoveryDecisionStore();
    const repo = new RecoveryDecisionRepository(store);

    const row = await repo.persistResult({
      opportunity: { id: OPPORTUNITY_ID, merchantId: MERCHANT_A },
      result: result(),
      engineVersion: 'v1',
      evaluatedAt: new Date(1_800_000_000_000),
    });

    expect(row.opportunityId).toBe(OPPORTUNITY_ID);
    // Attribution flows ONLY from the persisted opportunity.
    expect(row.merchantId).toBe(MERCHANT_A);
    expect(row.score).toBe(78);
    expect(row.priority).toBe('HIGH');
    expect(row.recommendedAction).toBe('RETRY');
    expect(row.reasons).toHaveLength(2);
    expect(row.factors[0]?.name).toBe('value');
    expect(row.riskFlags[0]?.flag).toBe('INSUFFICIENT_HISTORICAL_DATA');
    expect(row.engineVersion).toBe('v1');
  });

  it('upserts: re-evaluation updates the same row per (opportunity, version)', async () => {
    const store = new InMemoryRecoveryDecisionStore();
    const repo = new RecoveryDecisionRepository(store);

    await repo.persistResult({
      opportunity: { id: OPPORTUNITY_ID, merchantId: MERCHANT_A },
      result: result(),
      engineVersion: 'v1',
      evaluatedAt: new Date(1_800_000_000_000),
    });
    const second = await repo.persistResult({
      opportunity: { id: OPPORTUNITY_ID, merchantId: MERCHANT_A },
      result: result({ score: 30, priority: 'LOW' as const }),
      engineVersion: 'v1',
      evaluatedAt: new Date(1_800_010_000_000),
    });

    expect(store.rows.size).toBe(1);
    expect(second.score).toBe(30);
    expect(second.priority).toBe('LOW');
  });

  it('keeps separate rows per engine version', async () => {
    const store = new InMemoryRecoveryDecisionStore();
    const repo = new RecoveryDecisionRepository(store);

    await repo.persistResult({
      opportunity: { id: OPPORTUNITY_ID, merchantId: MERCHANT_A },
      result: result(),
      engineVersion: 'v1',
      evaluatedAt: new Date(),
    });
    await repo.persistResult({
      opportunity: { id: OPPORTUNITY_ID, merchantId: MERCHANT_A },
      result: result({ score: 55 }),
      engineVersion: 'v2',
      evaluatedAt: new Date(),
    });

    expect(store.rows.size).toBe(2);
  });

  it('aggregates overview metrics across priorities and actions', async () => {
    const store = new InMemoryRecoveryDecisionStore();
    const repo = new RecoveryDecisionRepository(store);

    await repo.persistResult({
      opportunity: { id: OPPORTUNITY_ID, merchantId: MERCHANT_A },
      result: result({ priority: 'CRITICAL' as const, confidence: 90 }),
      engineVersion: 'v1',
      evaluatedAt: new Date(),
    });
    await repo.persistResult({
      opportunity: { id: '00000000-0000-4000-8000-000000000002', merchantId: MERCHANT_A },
      result: result({ priority: 'HIGH' as const, recommendedAction: 'DO_NOT_RETRY' as const, confidence: 40 }),
      engineVersion: 'v1',
      evaluatedAt: new Date(),
    });

    const metrics = await repo.overviewMetrics();
    expect(metrics.criticalCount).toBe(1);
    expect(metrics.highCount).toBe(1);
    expect(metrics.recommendedRetries).toBe(1);
    expect(metrics.doNotRetry).toBe(1);
    expect(metrics.averageConfidence).toBe(65);

    const scoped = await repo.overviewMetrics(MERCHANT_A);
    expect(scoped.criticalCount).toBe(1);
    const other = await repo.overviewMetrics('22222222-2222-4222-8222-222222222222');
    expect(other.criticalCount).toBe(0);
    expect(other.averageConfidence).toBeNull();
  });
});
