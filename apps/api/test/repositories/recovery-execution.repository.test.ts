import { describe, expect, it } from 'vitest';
import {
  InMemoryRecoveryExecutionStore,
} from '../helpers.js';
import { RecoveryExecutionRepository } from '../../src/repositories/recovery-execution.repository.js';

const OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000001';
const DECISION_ID = '00000000-0000-4000-8000-0000000000d1';
const MERCHANT_A = '11111111-1111-4111-8111-111111111111';
const MERCHANT_B = '22222222-2222-4222-8222-222222222222';

function makeData(overrides: Record<string, unknown> = {}) {
  return {
    merchantId: MERCHANT_A,
    opportunityId: OPPORTUNITY_ID,
    decisionId: DECISION_ID,
    action: 'RETRY' as const,
    status: 'PENDING' as const,
    origin: 'MANUAL' as const,
    nextAttemptAt: null,
    scheduledAt: null,
    attempt: 1,
    idempotencyKey: `${OPPORTUNITY_ID}:${DECISION_ID}:RETRY:1`,
    provider: 'fake',
    providerPaymentId: 'pay_123',
    requestedAt: new Date(),
    startedAt: null,
    completedAt: null,
    failureCode: null,
    failureReason: null,
    ...overrides,
  };
}

describe('RecoveryExecutionRepository', () => {
  it('creates and looks up executions by idempotency key', async () => {
    const store = new InMemoryRecoveryExecutionStore();
    const repo = new RecoveryExecutionRepository(store);
    const created = await repo.create(makeData());

    expect(created.id).toBeDefined();
    const found = await repo.findByIdempotencyKey(created.idempotencyKey);
    expect(found?.id).toBe(created.id);
    expect(await repo.findByIdempotencyKey('missing')).toBeNull();
  });

  it('enforces the idempotency unique constraint', async () => {
    const store = new InMemoryRecoveryExecutionStore();
    const repo = new RecoveryExecutionRepository(store);

    await repo.create(makeData());
    await expect(repo.create(makeData())).rejects.toMatchObject({ code: 'P2002' });
  });

  it('updates status through the store with timestamps', async () => {
    const store = new InMemoryRecoveryExecutionStore();
    const repo = new RecoveryExecutionRepository(store);
    const created = await repo.create(makeData({ status: 'EXECUTING', startedAt: new Date() }));

    const completedAt = new Date();
    const updated = await repo.updateStatus({
      id: created.id,
      status: 'SUCCEEDED',
      completedAt,
    });
    expect(updated.status).toBe('SUCCEEDED');
    expect(updated.completedAt).toEqual(completedAt);
  });

  it('lists by opportunity newest-attempt first', async () => {
    const store = new InMemoryRecoveryExecutionStore();
    const repo = new RecoveryExecutionRepository(store);

    await repo.create(makeData());
    await repo.create(
      makeData({
        attempt: 2,
        status: 'FAILED',
        completedAt: new Date(),
        failureCode: 'declined',
        idempotencyKey: `${OPPORTUNITY_ID}:${DECISION_ID}:RETRY:2`,
      })
    );

    const rows = await repo.listByOpportunity(OPPORTUNITY_ID);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.attempt).toBe(2);
  });

  it('counts only non-blocked RETRY attempts (merchant isolation intact)', async () => {
    const store = new InMemoryRecoveryExecutionStore();
    const repo = new RecoveryExecutionRepository(store);

    await repo.create(makeData());
    await repo.create(
      // Audit-only record shape; action value is irrelevant to the count rule.
      makeData({ status: 'BLOCKED', idempotencyKey: 'k-blocked', failureCode: 'LOW_CONFIDENCE' })
    );
    // Another merchant's execution must not affect the count.
    await repo.create(
      makeData({ merchantId: MERCHANT_B, idempotencyKey: `k-${MERCHANT_B}`, opportunityId: '00000000-0000-4000-8000-000000000099' })
    );

    expect(await repo.countRetryAttempts(OPPORTUNITY_ID)).toBe(1);
    expect(await repo.countRetryAttempts('00000000-0000-4000-8000-000000000099')).toBe(1);
  });
});
