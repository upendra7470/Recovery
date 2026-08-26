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
  it('reports deterministic not_configured without any network call', async () => {
    const fetchSpy = vi.fn(
      async (_url: unknown, _init?: { body?: unknown }): Promise<Response> => {
        void _url;
        void _init;
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

  it('normalizes an accepted response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (): Promise<Response> =>
          new Response(JSON.stringify({ reference_id: 'ref-42' }), { status: 200 })
      )
    );

    const adapter = new RazorpayRetryAdapter({
      baseUrl: 'https://gateway.test',
      apiKey: 'key_x',
      timeoutMs: 250,
    });
    const result = await adapter.retryPayment(request);

    expect(result).toEqual({ kind: 'accepted', providerReferenceId: 'ref-42' });
  });

  it('normalizes provider rejections into failure codes without internals', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (): Promise<Response> =>
          new Response(
            JSON.stringify({ error_code: 'payment_declined', error_description: 'declined' }),
            { status: 402 }
          )
      )
    );

    const adapter = new RazorpayRetryAdapter({
      baseUrl: 'https://gateway.test',
      apiKey: 'key_x',
      timeoutMs: 250,
    });
    const result = await adapter.retryPayment(request);

    expect(result).toEqual({ kind: 'rejected', failureCode: 'payment_declined', failureReason: 'declined' });
  });

  it('maps unexpected HTTP errors to a stable synthetic failure code', async () => {
    for (const status of [400, 404, 500, 503]) {
      vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => new Response('', { status })));
      const adapter = new RazorpayRetryAdapter({
        baseUrl: 'https://gateway.test',
        apiKey: 'key_x',
        timeoutMs: 250,
      });
      const result = await adapter.retryPayment(request);
      expect(result.kind).toBe('rejected');
      if (result.kind === 'rejected') {
        expect(result.failureCode).toBe(`provider_http_${status}`);
      }
    }
  });

  it('maps timeouts and network failures to unavailable', async () => {
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
    let adapter = new RazorpayRetryAdapter({
      baseUrl: 'https://gateway.test',
      apiKey: 'k',
      timeoutMs: 250,
    });
    expect(await adapter.retryPayment(request)).toEqual({ kind: 'unavailable', reason: 'timeout' });

    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => {
      throw new Error('ECONNREFUSED');
    }));
    adapter = new RazorpayRetryAdapter({
      baseUrl: 'https://gateway.test',
      apiKey: 'k',
      timeoutMs: 250,
    });
    expect(await adapter.retryPayment(request)).toEqual({ kind: 'unavailable', reason: 'network_error' });
  });

  it('treats malformed success responses as invalid, never as accepted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (): Promise<Response> => new Response('not json', { status: 200 }))
    );
    const adapter = new RazorpayRetryAdapter({
      baseUrl: 'https://gateway.test',
      apiKey: 'k',
      timeoutMs: 250,
    });
    const result = await adapter.retryPayment(request);
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      expect(result.reason).toContain('invalid_response');
    }
  });
});
