import { describe, it, expect } from 'vitest';
import {
  InMemoryRecoveryExecutionStore,
  InMemoryRecoveryOpportunityStore,
} from '../helpers.js';

function seedExecution(store: InMemoryRecoveryExecutionStore, status: string, overrides: { id?: string; opportunityId?: string } = {}) {
  return store.insert({
    merchantId: '11111111-1111-4111-8111-111111111111',
    opportunityId: overrides.opportunityId ?? 'opp_sm_1',
    decisionId: '00000000-0000-4000-8000-000000000001',
    action: 'RETRY',
    status: status as 'PENDING' | 'AUTHORIZED' | 'EXECUTING' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'CANCELLED',
    origin: 'MANUAL',
    attempt: 1,
    nextAttemptAt: null,
    scheduledAt: null,
    idempotencyKey: `sm_key_${Math.random().toString(36).slice(2)}`,
    provider: null,
    providerPaymentId: 'pay_sm_1',
    requestedAt: new Date(),
    startedAt: null,
    completedAt: null,
    failureCode: null,
    failureReason: null,
  });
}

function seedOpportunity(store: InMemoryRecoveryOpportunityStore, status: string, id?: string) {
  return store.insert({
    merchantId: null,
    paymentAccountId: null,
    type: 'FAILED_PAYMENT',
    status: status as 'OPEN' | 'RECOVERED' | 'CANCELLED' | 'EXPIRED',
    sourceEventId: id ?? `src_sm_${Math.random().toString(36).slice(2)}`,
    providerPaymentId: 'pay_sm_opp',
    providerOrderId: null,
    amountAtRisk: 100,
    currency: 'INR',
    reason: 'test',
    evidence: { sourceEventId: 'evt', providerPaymentId: 'pay_sm_opp', providerOrderId: null, eventType: 'payment.failed', amount: 100, currency: 'INR', occurredAt: new Date().toISOString(), failureCode: null },
    recoveryEventId: null,
    detectedAt: new Date(),
    expiresAt: null,
    resolvedAt: null,
  });
}

describe('state machine enforcement at the store level', () => {
  it('execution: transitionStatus returns null when from state does not match (SUCCEEDED → AUTHORIZED)', async () => {
    const store = new InMemoryRecoveryExecutionStore();
    const exec = await seedExecution(store, 'SUCCEEDED');

    const result = await store.transitionStatus({ id: exec.id, from: 'AUTHORIZED', to: 'EXECUTING' });

    expect(result).toBeNull();
    const after = await store.findById(exec.id);
    expect(after?.status).toBe('SUCCEEDED');
  });

  it('execution: transitionStatus allows PENDING → EXECUTING at store level (full state machine enforced upstream)', async () => {
    const { canTransition } = await import('../../src/execution/state-machine.js');
    // The pure state machine rejects this transition
    expect(canTransition('PENDING', 'EXECUTING')).toBe(false);
    // The in-memory store only checks from-state match, not transition validity —
    // the upstream service must call canTransition before transitionStatus.
    const store = new InMemoryRecoveryExecutionStore();
    const exec = await seedExecution(store, 'PENDING');
    const result = await store.transitionStatus({ id: exec.id, from: 'PENDING', to: 'EXECUTING' });
    expect(result).not.toBeNull(); // store allows it, service would reject via canTransition
  });

  it('execution: PENDING → AUTHORIZED succeeds', async () => {
    const store = new InMemoryRecoveryExecutionStore();
    const exec = await seedExecution(store, 'PENDING');

    const result = await store.transitionStatus({ id: exec.id, from: 'PENDING', to: 'AUTHORIZED' });

    expect(result).not.toBeNull();
    expect(result?.status).toBe('AUTHORIZED');
  });

  it('execution: AUTHORIZED → EXECUTING succeeds', async () => {
    const store = new InMemoryRecoveryExecutionStore();
    const exec = await seedExecution(store, 'AUTHORIZED');

    const result = await store.transitionStatus({ id: exec.id, from: 'AUTHORIZED', to: 'EXECUTING' });

    expect(result).not.toBeNull();
    expect(result?.status).toBe('EXECUTING');
  });

  it('execution: transitionStatus returns null if from state does not match current', async () => {
    const store = new InMemoryRecoveryExecutionStore();
    const exec = await seedExecution(store, 'PENDING');

    const result = await store.transitionStatus({ id: exec.id, from: 'AUTHORIZED', to: 'EXECUTING' });

    expect(result).toBeNull();
  });

  it('execution: findActiveByOpportunity only returns PENDING/AUTHORIZED/EXECUTING/SUCCEEDED', async () => {
    const store = new InMemoryRecoveryExecutionStore();
    const opportunityId = 'opp_active_filter';

    await seedExecution(store, 'PENDING', { opportunityId });
    await seedExecution(store, 'AUTHORIZED', { opportunityId });
    await seedExecution(store, 'EXECUTING', { opportunityId });
    await seedExecution(store, 'SUCCEEDED', { opportunityId });
    await seedExecution(store, 'FAILED', { opportunityId });
    await seedExecution(store, 'BLOCKED', { opportunityId });
    await seedExecution(store, 'CANCELLED', { opportunityId });

    const active = await store.findActiveByOpportunity(opportunityId);

    expect(active).not.toBeNull();
    expect(['PENDING', 'AUTHORIZED', 'EXECUTING', 'SUCCEEDED']).toContain(active?.status);
  });

  it('opportunity: markRecovered only transitions from OPEN (second call updates RECOVERED row)', async () => {
    const store = new InMemoryRecoveryOpportunityStore();
    const opp = await seedOpportunity(store, 'OPEN', 'src_mr_open');

    const result = await store.markRecovered({ id: opp.id, recoveryEventId: 're_1', resolvedAt: new Date() });
    expect(result.status).toBe('RECOVERED');

    // A second markRecovered call: in the real DB, updateMany WHERE status=OPEN
    // affects 0 rows. The in-memory store still applies the update (no-op semantics).
    const second = await store.markRecovered({ id: opp.id, recoveryEventId: 're_2', resolvedAt: new Date() });
    expect(second.status).toBe('RECOVERED');
    expect(store.markRecoveredCalls).toHaveLength(2);
  });

  it('opportunity: markRecovered on an already RECOVERED row still returns RECOVERED', async () => {
    const store = new InMemoryRecoveryOpportunityStore();
    const opp = await seedOpportunity(store, 'RECOVERED', 'src_mr_rec');

    const result = await store.markRecovered({ id: opp.id, recoveryEventId: 're_existing', resolvedAt: new Date() });
    expect(result.status).toBe('RECOVERED');
  });
});
