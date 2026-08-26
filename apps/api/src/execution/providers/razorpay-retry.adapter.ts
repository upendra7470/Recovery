import type {
  RecoveryExecutionProvider,
  RetryPaymentRequest,
  RetryPaymentResult,
} from '../../domain/recovery-execution.js';

export interface RazorpayExecutionConfig {
  /** Gateway endpoint that accepts retry submissions; unset ⇒ not_configured. */
  baseUrl?: string;
  apiKey?: string;
  timeoutMs: number;
}

interface ProviderRetryResponse {
  status?: unknown;
  reference_id?: unknown;
  error_code?: unknown;
  error_description?: unknown;
}

/**
 * HTTP adapter for the RETRY capability against a configurable gateway
 * endpoint (Razorpay's public API does not expose a direct merchant-initiated
 * payment-retry operation, so the target is an explicitly configured gateway
 * URL; without configuration this adapter deterministically reports
 * `unavailable/not_configured` instead of pretending success).
 *
 * Responses are normalized to accepted/rejected/unavailable — raw provider
 * payloads never cross this boundary, and no credentials are ever logged or
 * persisted.
 */
export class RazorpayRetryAdapter implements RecoveryExecutionProvider {
  readonly provider = 'razorpay';

  constructor(private readonly config: RazorpayExecutionConfig) {}

  async retryPayment(request: RetryPaymentRequest): Promise<RetryPaymentResult> {
    const { baseUrl, apiKey } = this.config;
    if (baseUrl === undefined || apiKey === undefined) {
      return {
        kind: 'unavailable',
        reason: 'not_configured: no recovery execution gateway is configured',
      };
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/+$/, '')}/retries`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${btoa(`${apiKey}:`)}`,
        },
        body: JSON.stringify({
          reference_id: request.executionId,
          payment_id: request.providerPaymentId,
          order_id: request.providerOrderId,
          amount: request.amount,
          currency: request.currency,
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        return { kind: 'unavailable', reason: 'timeout' };
      }
      return { kind: 'unavailable', reason: 'network_error' };
    }

    if (response.status === 429) {
      return { kind: 'unavailable', reason: 'rate_limited' };
    }
    if (!response.ok) {
      // Normalize provider rejections without surfacing internals.
      const body = await safeBody(response);
      return {
        kind: 'rejected',
        failureCode: asString(body?.error_code) ?? `provider_http_${response.status}`,
        failureReason:
          asString(body?.error_description) ?? 'The provider rejected the retry request.',
      };
    }

    const body = await safeBody(response);
    if (body === null || typeof asString(body.reference_id) !== 'string') {
      return {
        kind: 'unavailable',
        reason: 'invalid_response: provider response missing reference id',
      };
    }
    return { kind: 'accepted', providerReferenceId: asString(body.reference_id)! };
  }
}

async function safeBody(response: Response): Promise<ProviderRetryResponse | null> {
  try {
    return (await response.json()) as ProviderRetryResponse;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
