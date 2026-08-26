import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RazorpayRetryAdapter,
} from '../../src/execution/providers/razorpay-retry.adapter.js';
import type { RetryPaymentRequest } from '../../src/domain/recovery-execution.js';

const request: RetryPaymentRequest = {
  executionId: 'exec-1',
  opportunityId: '00000000-0000-4000-8000-000000000001',
  providerPaymentId: 'pay_123',
  providerOrderId: 'order_123',
  amount: 250000,
  currency: 'INR',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RazorpayRetryAdapter', () => {
  describe('not_configured', () => {
    it('reports deterministic not_configured without any network call when keyId is missing', async () => {
      const fetchSpy = vi.fn(
        async (): Promise<Response> => {
          throw new Error('network must not be called');
        }
      );
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new RazorpayRetryAdapter({ timeoutMs: 250 });
      const result = await adapter.retryPayment(request);

      expect(result.kind).toBe('unavailable');
      if (result.kind === 'unavailable') {
        expect(result.reason.startsWith('not_configured')).toBe(true);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('reports not_configured when keySecret is missing', async () => {
      const fetchSpy = vi.fn(
        async (): Promise<Response> => {
          throw new Error('network must not be called');
        }
      );
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new RazorpayRetryAdapter({ keyId: 'rzp_test_xxx', timeoutMs: 250 });
      const result = await adapter.retryPayment(request);

      expect(result.kind).toBe('unavailable');
      if (result.kind === 'unavailable') {
        expect(result.reason.startsWith('not_configured')).toBe(true);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('authentication', () => {
    it('sends Basic Auth with key_id:key_secret', async () => {
      let capturedInit: RequestInit | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: unknown, init?: RequestInit): Promise<Response> => {
          capturedInit = init;
          return new Response(JSON.stringify({ id: 'order_abc', entity: 'order', amount: 5000, currency: 'INR', status: 'created' }), { status: 200 });
        })
      );

      const adapter = new RazorpayRetryAdapter({
        keyId: 'rzp_test_abc',
        keySecret: 'secret_xyz',
        timeoutMs: 250,
      });
      await adapter.retryPayment(request);

      expect(capturedInit).toBeDefined();
      const auth = capturedInit!.headers as Record<string, string>;
      expect(auth.authorization).toBe(`Basic ${btoa('rzp_test_abc:secret_xyz')}`);
    });

    it('rejects with AUTHENTICATION_FAILED on 401', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> =>
          new Response(JSON.stringify({ error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' } }), { status: 401 })
        )
      );

      const adapter = new RazorpayRetryAdapter({
        keyId: 'rzp_test_bad',
        keySecret: 'wrong',
        timeoutMs: 250,
      });
      const result = await adapter.retryPayment(request);

      expect(result).toEqual({
        kind: 'rejected',
        failureCode: 'AUTHENTICATION_FAILED',
        failureReason: 'Razorpay API credentials are invalid or expired.',
      });
    });
  });

  describe('success', () => {
    it('normalizes an accepted order creation response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> =>
          new Response(
            JSON.stringify({
              id: 'order_RB58MiP5SPFYyM',
              entity: 'order',
              amount: 250000,
              currency: 'INR',
              status: 'created',
              amount_due: 250000,
              amount_paid: 0,
              attempts: 0,
              created_at: 1756455561,
            }),
            { status: 200 }
          )
        )
      );

      const adapter = new RazorpayRetryAdapter({
        keyId: 'rzp_test_abc',
        keySecret: 'secret_xyz',
        timeoutMs: 250,
      });
      const result = await adapter.retryPayment(request);

      expect(result).toEqual({
        kind: 'accepted',
        providerReferenceId: 'order_RB58MiP5SPFYyM',
      });
    });

    it('uses executionId as receipt for idempotency', async () => {
      let capturedBody: unknown;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: unknown, init?: RequestInit): Promise<Response> => {
          capturedBody = init?.body;
          return new Response(
            JSON.stringify({ id: 'order_123', entity: 'order', amount: 5000, currency: 'INR', status: 'created' }),
            { status: 200 }
          );
        })
      );

      const adapter = new RazorpayRetryAdapter({
        keyId: 'rzp_test_abc',
        keySecret: 'secret_xyz',
        timeoutMs: 250,
      });
      await adapter.retryPayment(request);

      const body = JSON.parse(capturedBody as string) as Record<string, unknown>;
      expect(body.receipt).toBe('exec-1');
    });

    it('includes opportunity and payment metadata in notes', async () => {
      let capturedBody: unknown;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: unknown, init?: RequestInit): Promise<Response> => {
          capturedBody = init?.body;
          return new Response(
            JSON.stringify({ id: 'order_123', entity: 'order', amount: 5000, currency: 'INR', status: 'created' }),
            { status: 200 }
          );
        })
      );

      const adapter = new RazorpayRetryAdapter({
        keyId: 'rzp_test_abc',
        keySecret: 'secret_xyz',
        timeoutMs: 250,
      });
      await adapter.retryPayment(request);

      const body = JSON.parse(capturedBody as string) as Record<string, unknown>;
      expect(body.notes).toEqual({
        opportunity_id: '00000000-0000-4000-8000-000000000001',
        original_payment_id: 'pay_123',
        original_order_id: 'order_123',
      });
    });

    it('omits original_order_id from notes when null', async () => {
      let capturedBody: unknown;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: unknown, init?: RequestInit): Promise<Response> => {
          capturedBody = init?.body;
          return new Response(
            JSON.stringify({ id: 'order_123', entity: 'order', amount: 5000, currency: 'INR', status: 'created' }),
            { status: 200 }
          );
        })
      );

      const adapter = new RazorpayRetryAdapter({
        keyId: 'rzp_test_abc',
        keySecret: 'secret_xyz',
        timeoutMs: 250,
      });
      await adapter.retryPayment({
        ...request,
        providerOrderId: null,
      });

      const body = JSON.parse(capturedBody as string) as Record<string, unknown>;
      expect(body.notes).not.toHaveProperty('original_order_id');
    });
  });

  describe('rejected', () => {
    it('normalizes provider rejections into failure codes without internals', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> =>
          new Response(
            JSON.stringify({
              error: {
                code: 'BAD_REQUEST_ERROR',
                description: 'The amount is less than the minimum amount.',
              },
            }),
            { status: 400 }
          )
        )
      );

      const adapter = new RazorpayRetryAdapter({
        keyId: 'rzp_test_abc',
        keySecret: 'secret_xyz',
        timeoutMs: 250,
      });
      const result = await adapter.retryPayment(request);

      expect(result).toEqual({
        kind: 'rejected',
        failureCode: 'BAD_REQUEST_ERROR',
        failureReason: 'The amount is less than the minimum amount.',
      });
    });

    it('detects duplicate execution via receipt idempotency', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> =>
          new Response(
            JSON.stringify({
              error: {
                code: 'BAD_REQUEST_ERROR',
                description: 'Duplicate request. receipt is already used.',
              },
            }),
            { status: 400 }
          )
        )
      );

      const adapter = new RazorpayRetryAdapter({
        keyId: 'rzp_test_abc',
        keySecret: 'secret_xyz',
        timeoutMs: 250,
      });
      const result = await adapter.retryPayment(request);

      expect(result).toEqual({
        kind: 'rejected',
        failureCode: 'DUPLICATE_EXECUTION',
        failureReason: 'An order for this execution already exists.',
      });
    });

    it('maps unexpected HTTP errors to a stable synthetic failure code', async () => {
      for (const status of [400, 404, 500, 503]) {
        vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => new Response('', { status })));
        const adapter = new RazorpayRetryAdapter({
          keyId: 'rzp_test_abc',
          keySecret: 'secret_xyz',
          timeoutMs: 250,
        });
        const result = await adapter.retryPayment(request);
        expect(result.kind).toBe('rejected');
        if (result.kind === 'rejected') {
          expect(result.failureCode).toBe(`provider_http_${status}`);
        }
      }
    });
  });

  describe('unavailable', () => {
    it('maps timeouts to unavailable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          () =>
            new Promise<Response>((_, reject) => {
              const error = new Error('aborted');
              error.name = 'TimeoutError';
              reject(error);
            })
        )
      );

      const adapter = new RazorpayRetryAdapter({
        keyId: 'rzp_test_abc',
        keySecret: 'secret_xyz',
        timeoutMs: 250,
      });
      expect(await adapter.retryPayment(request)).toEqual({ kind: 'unavailable', reason: 'timeout' });
    });

    it('maps network failures to unavailable', async () => {
      vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => {
        throw new Error('ECONNREFUSED');
      }));

      const adapter = new RazorpayRetryAdapter({
        keyId: 'rzp_test_abc',
        keySecret: 'secret_xyz',
        timeoutMs: 250,
      });
      expect(await adapter.retryPayment(request)).toEqual({ kind: 'unavailable', reason: 'network_error' });
    });

    it('maps rate limiting (429) to unavailable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> => new Response('Too Many Requests', { status: 429 }))
      );

      const adapter = new RazorpayRetryAdapter({
        keyId: 'rzp_test_abc',
        keySecret: 'secret_xyz',
        timeoutMs: 250,
      });
      const result = await adapter.retryPayment(request);
      expect(result).toEqual({ kind: 'unavailable', reason: 'rate_limited' });
    });

    it('treats malformed success responses as invalid', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> => new Response('not json', { status: 200 }))
      );

      const adapter = new RazorpayRetryAdapter({
        keyId: 'rzp_test_abc',
        keySecret: 'secret_xyz',
        timeoutMs: 250,
      });
      const result = await adapter.retryPayment(request);
      expect(result.kind).toBe('unavailable');
      if (result.kind === 'unavailable') {
        expect(result.reason).toContain('invalid_response');
      }
    });

    it('treats responses missing order id as invalid', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> =>
          new Response(JSON.stringify({ entity: 'order', amount: 5000 }), { status: 200 })
        )
      );

      const adapter = new RazorpayRetryAdapter({
        keyId: 'rzp_test_abc',
        keySecret: 'secret_xyz',
        timeoutMs: 250,
      });
      const result = await adapter.retryPayment(request);
      expect(result.kind).toBe('unavailable');
      if (result.kind === 'unavailable') {
        expect(result.reason).toContain('invalid_response');
      }
    });
  });

  describe('safety', () => {
    it('never sends API key secret in request body', async () => {
      let capturedInit: RequestInit | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: unknown, init?: RequestInit): Promise<Response> => {
          capturedInit = init;
          return new Response(
            JSON.stringify({ id: 'order_123', entity: 'order', amount: 5000, currency: 'INR', status: 'created' }),
            { status: 200 }
          );
        })
      );

      const adapter = new RazorpayRetryAdapter({
        keyId: 'rzp_test_abc',
        keySecret: 'super_secret_key',
        timeoutMs: 250,
      });
      await adapter.retryPayment(request);

      const body = capturedInit!.body as string;
      expect(body).not.toContain('super_secret_key');
      // Only auth header should contain the secret
      const auth = (capturedInit!.headers as Record<string, string>).authorization;
      expect(auth).toContain(btoa('rzp_test_abc:super_secret_key'));
    });

    it('does not log or expose raw provider responses', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> =>
          new Response(
            JSON.stringify({
              id: 'order_abc',
              entity: 'order',
              amount: 5000,
              currency: 'INR',
              status: 'created',
              // Simulated internal fields that should not leak
              internal_trace_id: 'trace_123',
              merchant_id: 'merchant_abc',
            }),
            { status: 200 }
          )
        )
      );

      const adapter = new RazorpayRetryAdapter({
        keyId: 'rzp_test_abc',
        keySecret: 'secret_xyz',
        timeoutMs: 250,
      });
      const result = await adapter.retryPayment(request);

      // Only the order ID is returned, no internal fields
      expect(result).toEqual({
        kind: 'accepted',
        providerReferenceId: 'order_abc',
      });
      expect(result).not.toHaveProperty('internal_trace_id');
      expect(result).not.toHaveProperty('merchant_id');
    });
  });
});
