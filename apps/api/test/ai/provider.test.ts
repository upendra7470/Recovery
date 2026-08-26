import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenAICompatibleAdvisor,
  extractJsonBlock,
} from '../../src/ai/providers/openai-compatible.js';
import type { RecoveryAIAdviceRequest } from '../../src/domain/recovery-ai-advice.js';

const advisor = new OpenAICompatibleAdvisor({
  provider: 'test-provider',
  model: 'test-model',
  apiKey: 'test-key',
  baseUrl: 'https://ai.test/api',
  timeoutMs: 250,
});

const request: RecoveryAIAdviceRequest = {
  opportunityId: '00000000-0000-4000-8000-000000000001',
  opportunityType: 'FAILED_PAYMENT',
  currency: 'INR',
  amount: 500_000,
  failureCategory: 'TRANSIENT',
  failureCode: 'GATEWAY_ERROR',
  observedFailedRetries: 0,
  opportunityStatus: 'OPEN',
  score: 78,
  priority: 'HIGH',
  confidence: 71,
  recommendation: 'RETRY',
  reasons: ['High recoverable value'],
  riskFlags: [],
  historicalRecoveryRatePercent: null,
};

function validAdviceJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    summary: 'Transient gateway failure shortly after checkout.',
    explanation:
      'The gateway timed out during processing; the deterministic retry decision fits this pattern.',
    nextStep: 'Schedule one retry within the standard window.',
    customerMessage: null,
    operatorMessage: null,
    confidence: 70,
    warnings: [],
    ...overrides,
  });
}

function mockFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAICompatibleAdvisor', () => {
  it('returns validated advice on success and never sends secrets beyond the auth header', async () => {
    let sentBody: unknown;
    const fetchMock = vi.fn(async (_url: unknown, init?: { body?: unknown }): Promise<Response> => {
      sentBody = JSON.parse(String(init?.body));
      void _url;
      return new Response(JSON.stringify({ choices: [{ message: { content: validAdviceJson() } }] }), {
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await advisor.advise(request);

    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.content.summary).toContain('gateway');
      expect(result.content.confidence).toBe(70);
    }
    // Data minimization: only the constructed request body is sent.
    const body = sentBody as { model: string; messages: { content: string }[] };
    expect(body.model).toBe('test-model');
    expect(body.messages[1]?.content).toContain('authoritativeDeterministicDecision');
    expect(JSON.stringify(body)).not.toContain('customer@example.com');
  });

  it('parses fenced JSON output from models that wrap responses in markdown', async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '```json\n' + validAdviceJson() + '\n```' } }],
        }),
        { status: 200 }
      )
    );

    const result = await advisor.advise(request);
    expect(result.status).toBe('available');
  });

  it('maps timeout to an unavailable state', async () => {
    mockFetch(
      () =>
        new Promise<Response>((_, reject) => {
          const error = new Error('The operation was aborted due to timeout');
          error.name = 'TimeoutError';
          reject(error);
        })
    );

    const result = await advisor.advise(request);
    expect(result).toEqual({ status: 'unavailable', reason: 'timeout' });
  });

  it('maps 429 to rate_limited without retrying', async () => {
    const fetchMock = vi.fn(async () => new Response('too many requests', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await advisor.advise(request);
    expect(result).toEqual({ status: 'unavailable', reason: 'rate_limited' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps other non-200 statuses to provider_error', async () => {
    for (const status of [400, 401, 500, 503]) {
      mockFetch(async () => new Response('boom', { status }));
      const result = await advisor.advise(request);
      expect(result).toEqual({ status: 'unavailable', reason: 'provider_error' });
    }
  });

  it('maps network failures to network_error', async () => {
    mockFetch(async () => {
      throw new Error('ECONNREFUSED');
    });

    const result = await advisor.advise(request);
    expect(result).toEqual({ status: 'unavailable', reason: 'network_error' });
  });

  it('rejects malformed JSON bodies as invalid_response', async () => {
    mockFetch(async () => new Response('not json at all', { status: 200 }));

    const result = await advisor.advise(request);
    expect(result).toEqual({ status: 'unavailable', reason: 'invalid_response' });
  });

  it('rejects model text with no parseable JSON object as invalid_response', async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'sorry, no idea' } }] }), {
          status: 200,
        })
    );

    const result = await advisor.advise(request);
    expect(result).toEqual({ status: 'unavailable', reason: 'invalid_response' });
  });

  it('rejects missing required fields as invalid_response', async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ summary: 'Too short to stand alone' }),
                },
              },
            ],
          }),
          { status: 200 }
        )
    );

    const result = await advisor.advise(request);
    expect(result).toEqual({ status: 'unavailable', reason: 'invalid_response' });
  });

  it.each([
    [-5],
    [101],
    ['not-a-number'],
  ])('rejects invalid confidence value %s as invalid_response', async (confidence) => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: validAdviceJson({ confidence }) } }],
          }),
          { status: 200 }
        )
    );

    const result = await advisor.advise(request);
    expect(result).toEqual({ status: 'unavailable', reason: 'invalid_response' });
  });

  it('rejects NaN confidence (serialized as null by JSON) instead of coercing to 0', async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: validAdviceJson({ confidence: Number.NaN }) } }],
          }),
          { status: 200 }
        )
    );

    const result = await advisor.advise(request);
    expect(result).toEqual({ status: 'unavailable', reason: 'invalid_response' });
  });

  describe('extractJsonBlock', () => {
    it('extracts the outermost object from prose-wrapped output', () => {
      const text = 'Here you go:\n{"a":1,"b":{"c":2}}\nThanks!';
      expect(extractJsonBlock(text)).toBe('{"a":1,"b":{"c":2}}');
    });

    it('throws when no object is present', () => {
      expect(() => extractJsonBlock('no json')).toThrow();
    });
  });
});
