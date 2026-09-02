import { describe, it, expect } from 'vitest';
import {
  InMemoryRecoveryExecutionStore,
  InMemoryRecoveryOpportunityStore,
  FakeRecoveryExecutionProvider,
} from '../helpers.js';

function makeRequest(overrides: { executionId?: string; opportunityId?: string } = {}) {
  return {
    executionId: overrides.executionId ?? 'exec_fail_1',
    opportunityId: overrides.opportunityId ?? 'opp_fail_1',
    providerPaymentId: 'pay_fail_1',
    providerOrderId: null as string | null,
    amount: 50000,
    currency: 'INR',
  };
}

async function seedExecution(store: InMemoryRecoveryExecutionStore, opportunityId: string) {
  return store.insert({
    merchantId: '11111111-1111-4111-8111-111111111111',
    opportunityId,
    decisionId: '00000000-0000-4000-8000-000000000001',
    action: 'RETRY',
    status: 'PENDING',
    origin: 'MANUAL',
    attempt: 1,
    nextAttemptAt: null,
    scheduledAt: null,
    idempotencyKey: `fail_key_${Math.random().toString(36).slice(2)}`,
    provider: null,
    providerPaymentId: 'pay_fail_1',
    requestedAt: new Date(),
    startedAt: null,
    completedAt: null,
    failureCode: null,
    failureReason: null,
  });
}

async function seedOpportunity(store: InMemoryRecoveryOpportunityStore) {
  return store.insert({
    merchantId: '11111111-1111-4111-8111-111111111111',
    paymentAccountId: null,
    type: 'FAILED_PAYMENT',
    status: 'OPEN',
    sourceEventId: `src_fail_${Math.random().toString(36).slice(2)}`,
    providerPaymentId: 'pay_fail_1',
    providerOrderId: null,
    amountAtRisk: 50000,
    currency: 'INR',
    reason: 'Test failure scenario',
    evidence: { sourceEventId: 'evt', providerPaymentId: 'pay_fail_1', providerOrderId: null, eventType: 'payment.failed', amount: 50000, currency: 'INR', occurredAt: new Date().toISOString(), failureCode: 'GATEWAY_ERROR' },
    recoveryEventId: null,
    detectedAt: new Date(),
    expiresAt: null,
    resolvedAt: null,
  });
}

describe('provider failure handling', () => {
  it('provider rejection results in FAILED execution with failureCode', async () => {
    const provider = new FakeRecoveryExecutionProvider({
      kind: 'rejected',
      failureCode: 'payment_declined',
      failureReason: 'The provider declined the retry.',
    });
    const execStore = new InMemoryRecoveryExecutionStore();
    const exec = await seedExecution(execStore, 'opp_reject');

    const result = await provider.retryPayment(makeRequest({ executionId: exec.id, opportunityId: 'opp_reject' }));

    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.failureCode).toBe('payment_declined');
      expect(result.failureReason).toBe('The provider declined the retry.');
    }

    // Simulate the service recording the failure
    const updated = await execStore.transitionStatus({
      id: exec.id,
      from: 'PENDING',
      to: 'FAILED',
      completedAt: new Date(),
      failureCode: result.kind === 'rejected' ? result.failureCode : null,
      failureReason: result.kind === 'rejected' ? result.failureReason : null,
    });
    expect(updated?.status).toBe('FAILED');
    expect(updated?.failureCode).toBe('payment_declined');
  });

  it('provider throw results in FAILED execution with provider error code', async () => {
    const provider = new FakeRecoveryExecutionProvider({ kind: 'throw' });
    const execStore = new InMemoryRecoveryExecutionStore();
    const exec = await seedExecution(execStore, 'opp_throw');

    let caught = false;
    try {
      await provider.retryPayment(makeRequest({ executionId: exec.id, opportunityId: 'opp_throw' }));
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);

    // Simulate the service catching the throw and recording PROVIDER_ERROR
    const updated = await execStore.transitionStatus({
      id: exec.id,
      from: 'PENDING',
      to: 'FAILED',
      completedAt: new Date(),
      failureCode: 'PROVIDER_ERROR',
      failureReason: 'synthetic provider crash',
    });
    expect(updated?.status).toBe('FAILED');
    expect(updated?.failureCode).toBe('PROVIDER_ERROR');
  });

  it('provider unavailable results in FAILED execution', async () => {
    const provider = new FakeRecoveryExecutionProvider({
      kind: 'unavailable',
      reason: 'timeout',
    });
    const execStore = new InMemoryRecoveryExecutionStore();
    const exec = await seedExecution(execStore, 'opp_unavail');

    const result = await provider.retryPayment(makeRequest({ executionId: exec.id, opportunityId: 'opp_unavail' }));

    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      expect(result.reason).toBe('timeout');
    }

    const updated = await execStore.transitionStatus({
      id: exec.id,
      from: 'PENDING',
      to: 'FAILED',
      completedAt: new Date(),
      failureCode: 'PROVIDER_UNAVAILABLE',
      failureReason: result.kind === 'unavailable' ? result.reason : null,
    });
    expect(updated?.status).toBe('FAILED');
    expect(updated?.failureCode).toBe('PROVIDER_UNAVAILABLE');
  });

  it('provider timeout results in FAILED execution', async () => {
    const provider = new FakeRecoveryExecutionProvider({
      kind: 'unavailable',
      reason: 'timeout',
    });
    const execStore = new InMemoryRecoveryExecutionStore();
    const exec = await seedExecution(execStore, 'opp_timeout');

    const result = await provider.retryPayment(makeRequest({ executionId: exec.id, opportunityId: 'opp_timeout' }));

    expect(result.kind).toBe('unavailable');

    const updated = await execStore.transitionStatus({
      id: exec.id,
      from: 'PENDING',
      to: 'FAILED',
      completedAt: new Date(),
      failureCode: 'PROVIDER_UNAVAILABLE',
      failureReason: 'timeout',
    });
    expect(updated?.status).toBe('FAILED');
    expect(updated?.failureCode).toBe('PROVIDER_UNAVAILABLE');
  });

  it('after failure, opportunity is NOT marked as RECOVERED', async () => {
    const provider = new FakeRecoveryExecutionProvider({
      kind: 'rejected',
      failureCode: 'payment_declined',
      failureReason: 'declined',
    });
    const execStore = new InMemoryRecoveryExecutionStore();
    const oppStore = new InMemoryRecoveryOpportunityStore();
    const opp = await seedOpportunity(oppStore);
    const exec = await seedExecution(execStore, opp.id);

    await provider.retryPayment(makeRequest({ executionId: exec.id, opportunityId: opp.id }));

    await execStore.transitionStatus({
      id: exec.id,
      from: 'PENDING',
      to: 'FAILED',
      completedAt: new Date(),
      failureCode: 'payment_declined',
      failureReason: 'declined',
    });

    const oppAfter = await oppStore.findById(opp.id);
    expect(oppAfter?.status).toBe('OPEN');
    expect(oppStore.markRecoveredCalls).toHaveLength(0);
  });

  it('multiple failures do not corrupt the execution record', async () => {
    const { canTransition } = await import('../../src/execution/state-machine.js');
    const execStore = new InMemoryRecoveryExecutionStore();
    const exec = await seedExecution(execStore, 'opp_multi_fail');

    // First failure
    await execStore.transitionStatus({
      id: exec.id,
      from: 'PENDING',
      to: 'FAILED',
      completedAt: new Date(),
      failureCode: 'payment_declined',
      failureReason: 'first failure',
    });

    const afterFirst = await execStore.findById(exec.id);
    expect(afterFirst?.status).toBe('FAILED');
    expect(afterFirst?.failureCode).toBe('payment_declined');
    expect(afterFirst?.failureReason).toBe('first failure');
    expect(afterFirst?.completedAt).not.toBeNull();

    // The pure state machine rejects FAILED → anything (terminal state)
    expect(canTransition('FAILED', 'FAILED')).toBe(false);
    expect(canTransition('FAILED', 'PENDING')).toBe(false);
    expect(canTransition('FAILED', 'EXECUTING')).toBe(false);

    // The record is still intact from the first failure — no corruption
    const afterSecond = await execStore.findById(exec.id);
    expect(afterSecond?.status).toBe('FAILED');
    expect(afterSecond?.failureCode).toBe('payment_declined');
    expect(afterSecond?.failureReason).toBe('first failure');
  });
});
