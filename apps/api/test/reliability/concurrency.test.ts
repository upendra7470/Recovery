import { describe, it, expect } from 'vitest';
import {
  InMemoryRecoveryExecutionStore,
  InMemoryRecoveryOpportunityStore,
  InMemoryRecoveryDecisionStore,
  createMerchantStrategyMemoryStoreMock,
} from '../helpers.js';

function seedExecution(store: InMemoryRecoveryExecutionStore, overrides: { id?: string; status?: string; idempotencyKey?: string; opportunityId?: string } = {}) {
  return store.insert({
    merchantId: '11111111-1111-4111-8111-111111111111',
    opportunityId: overrides.opportunityId ?? 'opp_conc_1',
    decisionId: '00000000-0000-4000-8000-000000000001',
    action: 'RETRY',
    status: (overrides.status as 'PENDING' | 'AUTHORIZED' | 'EXECUTING' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'CANCELLED') ?? 'PENDING',
    origin: 'MANUAL',
    attempt: 1,
    nextAttemptAt: null,
    scheduledAt: null,
    idempotencyKey: overrides.idempotencyKey ?? `exec_key_${Math.random().toString(36).slice(2)}`,
    provider: null,
    providerPaymentId: 'pay_conc_1',
    requestedAt: new Date(),
    startedAt: null,
    completedAt: null,
    failureCode: null,
    failureReason: null,
  });
}

describe('concurrent operation safety', () => {
  it('only one of two concurrent PENDING→AUTHORIZED transitions succeeds', async () => {
    const store = new InMemoryRecoveryExecutionStore();
    const exec = await seedExecution(store, { status: 'PENDING' });

    const [result1, result2] = await Promise.all([
      store.transitionStatus({ id: exec.id, from: 'PENDING', to: 'AUTHORIZED' }),
      store.transitionStatus({ id: exec.id, from: 'PENDING', to: 'AUTHORIZED' }),
    ]);

    const succeeded = [result1, result2].filter((r) => r !== null);
    const failed = [result1, result2].filter((r) => r === null);

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(succeeded[0]?.status).toBe('AUTHORIZED');
  });

  it('second concurrent markRecovered is a no-op (status already RECOVERED)', async () => {
    const store = new InMemoryRecoveryOpportunityStore();
    const opp = await store.insert({
      merchantId: null,
      paymentAccountId: null,
      type: 'FAILED_PAYMENT',
      status: 'OPEN',
      sourceEventId: 'src_conc_mark',
      providerPaymentId: 'pay_1',
      providerOrderId: null,
      amountAtRisk: 100,
      currency: 'INR',
      reason: 'test',
      evidence: { sourceEventId: 'src_conc_mark', providerPaymentId: 'pay_1', providerOrderId: null, eventType: 'payment.failed', amount: 100, currency: 'INR', occurredAt: new Date().toISOString(), failureCode: null },
      recoveryEventId: null,
      detectedAt: new Date(),
      expiresAt: null,
      resolvedAt: null,
    });

    await store.markRecovered({ id: opp.id, recoveryEventId: 're_1', resolvedAt: new Date() });

    // The opportunity is now RECOVERED — a real DB updateMany with WHERE status=OPEN
    // would affect 0 rows. The in-memory store still tracks the call.
    await store.markRecovered({ id: opp.id, recoveryEventId: 're_2', resolvedAt: new Date() });

    expect(store.markRecoveredCalls).toHaveLength(2);
    const row = await store.findById(opp.id);
    expect(row?.status).toBe('RECOVERED');
  });

  it('concurrent memory upserts for the same key both succeed without error', async () => {
    const store = createMerchantStrategyMemoryStoreMock();
    const base = { merchantId: 'm1', strategy: 'RETRY' as const, failureType: 'GATEWAY_ERROR' };

    const [result1, result2] = await Promise.all([
      store.upsert(base),
      store.upsert(base),
    ]);

    expect(result1.id).toBeDefined();
    expect(result2.id).toBeDefined();
    // Both returned a row — the in-memory store deduplicates by key, so they
    // should be the same row object.
    expect(result1.id).toBe(result2.id);
  });

  it('concurrent decision evaluations for the same opportunity result in a single decision', async () => {
    const store = new InMemoryRecoveryDecisionStore();
    const base = {
      merchantId: null as string | null,
      opportunityId: 'opp_conc_dec',
      engineVersion: 'v1',
      score: 50,
      priority: 'MEDIUM' as const,
      confidence: 60,
      recommendedAction: 'RETRY' as const,
      reasons: ['r1'],
      factors: [],
      riskFlags: [],
      evaluatedAt: new Date(),
    };

    const [r1, r2] = await Promise.all([
      store.upsert({ ...base, score: 40 }),
      store.upsert({ ...base, score: 80 }),
    ]);

    // Both should refer to the same row (upsert semantics).
    expect(r1.id).toBe(r2.id);
    expect(store.rows.size).toBe(1);
    // The final score should be one of the two values (last-write-wins).
    const final = await store.findByOpportunityAndEngineVersion('opp_conc_dec', 'v1');
    expect([40, 80]).toContain(final?.score);
  });

  it('rapid retry limit enforcement tracks count correctly across concurrent inserts', async () => {
    const store = new InMemoryRecoveryExecutionStore();
    const opportunityId = 'opp_rapid_retry';
    const maxRetries = 3;

    const inserts = Array.from({ length: maxRetries + 2 }, (_, i) =>
      store.insert({
        merchantId: '11111111-1111-4111-8111-111111111111',
        opportunityId,
        decisionId: '00000000-0000-4000-8000-000000000001',
        action: 'RETRY',
        status: 'FAILED',
        origin: 'MANUAL',
        attempt: i + 1,
        nextAttemptAt: null,
        scheduledAt: null,
        idempotencyKey: `rapid_${opportunityId}_${i}`,
        provider: 'fake',
        providerPaymentId: 'pay_rapid',
        requestedAt: new Date(),
        startedAt: null,
        completedAt: new Date(),
        failureCode: 'payment_declined',
        failureReason: 'declined',
      }),
    );

    const results = await Promise.all(inserts);
    expect(results).toHaveLength(maxRetries + 2);

    const retryCount = await store.countRetryAttempts(opportunityId);
    expect(retryCount).toBe(maxRetries + 2);
    expect(retryCount).toBeGreaterThan(maxRetries);
  });
});
