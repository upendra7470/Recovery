import { describe, it, expect } from 'vitest';
import {
  FakeRecoveryExecutionProvider,
  FakeAIRecoveryAdvisor,
} from '../helpers.js';

describe('Secrets inspection — error responses do not leak secrets', () => {
  it('provider failure response should not contain raw API keys', async () => {
    const provider = new FakeRecoveryExecutionProvider({
      kind: 'rejected',
      failureCode: 'payment_declined',
      failureReason: 'The payment was declined by the issuer.',
    });

    const result = await provider.retryPayment({
      executionId: 'exec_1',
      opportunityId: 'opp_1',
      providerPaymentId: 'pay_1',
      providerOrderId: null,
      amount: 500_000,
      currency: 'INR',
    });

    expect(result.kind).toBe('rejected');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('sk_live');
    expect(serialized).not.toContain('sk_test');
    expect(serialized).not.toContain('key_');
    expect(serialized).not.toContain('API_KEY');
    expect(serialized).not.toContain('secret');
  });

  it('execution failure reasons should not contain internal IDs that reveal infrastructure', async () => {
    const provider = new FakeRecoveryExecutionProvider({
      kind: 'rejected',
      failureCode: 'payment_declined',
      failureReason: 'The payment was declined by the issuer.',
    });

    const result = await provider.retryPayment({
      executionId: 'exec_internal_123',
      opportunityId: 'opp_internal_456',
      providerPaymentId: 'pay_1',
      providerOrderId: null,
      amount: 500_000,
      currency: 'INR',
    });

    if (result.kind === 'rejected') {
      expect(result.failureReason).not.toContain('exec_internal_123');
      expect(result.failureReason).not.toContain('opp_internal_456');
      expect(result.failureReason).not.toContain('pg_');
      expect(result.failureReason).not.toContain('postgres://');
      expect(result.failureReason).not.toContain('redis://');
      expect(result.failureReason).not.toContain('internal');
    }
  });

  it('error messages from provider crash should not contain stack traces', async () => {
    const provider = new FakeRecoveryExecutionProvider({ kind: 'throw' });

    try {
      await provider.retryPayment({
        executionId: 'exec_1',
        opportunityId: 'opp_1',
        providerPaymentId: 'pay_1',
        providerOrderId: null,
        amount: 500_000,
        currency: 'INR',
      });
      expect.fail('Expected provider to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).not.toContain('at Object.');
      expect(message).not.toContain('at Function.');
      expect(message).not.toContain('node_modules/');
      expect(message).not.toContain('.ts:');
      expect(message).not.toContain('.js:');
      expect(message).not.toContain('stack');
    }
  });

  it('AI advisor unavailable reasons do not expose provider internals', async () => {
    const behaviors = [
      { kind: 'timeout' as const },
      { kind: 'rate_limited' as const },
      { kind: 'provider_error' as const },
      { kind: 'network_error' as const },
      { kind: 'invalid_response_malformed_json' as const },
      { kind: 'invalid_response_schema' as const },
    ];

    for (const behavior of behaviors) {
      const advisor = new FakeAIRecoveryAdvisor(behavior);
      const result = await advisor.advise({
        opportunityId: 'opp_1',
        opportunityType: 'FAILED_PAYMENT',
        currency: 'INR',
        amount: 500_000,
        failureCategory: 'TRANSIENT',
        failureCode: 'GATEWAY_ERROR',
        observedFailedRetries: 0,
        opportunityStatus: 'OPEN',
        score: 65,
        priority: 'HIGH',
        confidence: 70,
        recommendation: 'RETRY',
        reasons: [],
        riskFlags: [],
        historicalRecoveryRatePercent: null,
      });

      expect(result.status).toBe('unavailable');
      if (result.status === 'unavailable') {
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain('api_key');
        expect(serialized).not.toContain('sk_live');
        expect(serialized).not.toContain('Bearer');
        expect(serialized).not.toContain('token');
        expect(serialized).not.toContain('Authorization');
      }
    }
  });

  it('AI advisor crash message does not leak internal details', async () => {
    const advisor = new FakeAIRecoveryAdvisor({ kind: 'throw' });

    try {
      await advisor.advise({
        opportunityId: 'opp_1',
        opportunityType: 'FAILED_PAYMENT',
        currency: 'INR',
        amount: 500_000,
        failureCategory: 'TRANSIENT',
        failureCode: 'GATEWAY_ERROR',
        observedFailedRetries: 0,
        opportunityStatus: 'OPEN',
        score: 65,
        priority: 'HIGH',
        confidence: 70,
        recommendation: 'RETRY',
        reasons: [],
        riskFlags: [],
        historicalRecoveryRatePercent: null,
      });
      expect.fail('Expected advisor to throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain('sk_live');
      expect(message).not.toContain('api_key');
      expect(message).not.toContain('password');
      expect(message).not.toContain('database_url');
      expect(message).not.toContain('postgres://');
    }
  });
});
