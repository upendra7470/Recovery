import type {
  RecoveryExecutionProvider,
  RetryPaymentRequest,
  RetryPaymentResult,
} from '../../domain/recovery-execution.js';

export interface RazorpayExecutionConfig {
  /** Razorpay Key ID (e.g. rzp_test_xxxxx). */
  keyId?: string;
  /** Razorpay Key Secret. NEVER logged or persisted. */
  keySecret?: string;
  /** Razorpay API base URL; defaults to https://api.razorpay.com. */
  baseUrl?: string;
  timeoutMs: number;
}

interface RazorpayOrderResponse {
  id?: unknown;
  entity?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
}

interface RazorpayErrorResponse {
  error?: {
    code?: unknown;
    description?: unknown;
    reason?: unknown;
  };
}

const DEFAULT_BASE_URL = 'https://api.razorpay.com';

/**
 * Real Razorpay integration for recovery execution.
 *
 * Uses the Razorpay Orders API (POST /v1/orders) to create a new order for
 * each retry attempt. The order ID is returned as the provider reference,
 * which the frontend can use to open Razorpay Checkout for the customer.
 *
 * Authentication: Basic Auth with key_id:key_secret (base64 encoded).
 *
 * Idempotency: The receipt field uses the execution ID, which Razorpay
 * treats as an idempotency key — duplicate requests with the same receipt
 * are rejected with a 400 (duplicate_request_error).
 *
 * Provider acceptance means an order was created, NOT that payment was
 * recovered. Only the captured-payment webhook flow confirms recovery.
 */
export class RazorpayRetryAdapter implements RecoveryExecutionProvider {
  readonly provider = 'razorpay';

  constructor(private readonly config: RazorpayExecutionConfig) {}

  async retryPayment(request: RetryPaymentRequest): Promise<RetryPaymentResult> {
    const { keyId, keySecret } = this.config;
    if (keyId === undefined || keySecret === undefined) {
      return {
        kind: 'unavailable',
        reason: 'not_configured: Razorpay API credentials are not configured',
      };
    }

    const baseUrl = (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    const authHeader = `Basic ${btoa(`${keyId}:${keySecret}`)}`;

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v1/orders`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: authHeader,
        },
        body: JSON.stringify({
          amount: request.amount,
          currency: request.currency,
          // receipt is used as idempotency key — Razorpay rejects duplicates
          receipt: request.executionId,
          notes: {
            opportunity_id: request.opportunityId,
            original_payment_id: request.providerPaymentId,
            ...(request.providerOrderId !== null
              ? { original_order_id: request.providerOrderId }
              : {}),
          },
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

    // Razorpay uses 400 for auth failures (BAD_REQUEST_ERROR with
    // code=BAD_REQUEST_ERROR, description="Authentication failed")
    if (response.status === 401) {
      return {
        kind: 'rejected',
        failureCode: 'AUTHENTICATION_FAILED',
        failureReason: 'Razorpay API credentials are invalid or expired.',
      };
    }

    if (!response.ok) {
      const body = await safeParseError(response);
      // Duplicate receipt — order already exists for this execution
      if (body?.error?.code === 'BAD_REQUEST_ERROR' &&
          typeof body.error.description === 'string' &&
          body.error.description.includes('Duplicate')) {
        return {
          kind: 'rejected',
          failureCode: 'DUPLICATE_EXECUTION',
          failureReason: 'An order for this execution already exists.',
        };
      }
      return {
        kind: 'rejected',
        failureCode: asString(body?.error?.code) ?? `provider_http_${response.status}`,
        failureReason:
          asString(body?.error?.description) ?? 'The provider rejected the order creation.',
      };
    }

    const body = await safeParseOrder(response);
    if (body === null || typeof body.id !== 'string') {
      return {
        kind: 'unavailable',
        reason: 'invalid_response: provider response missing order id',
      };
    }

    return { kind: 'accepted', providerReferenceId: body.id };
  }
}

async function safeParseError(response: Response): Promise<RazorpayErrorResponse | null> {
  try {
    return (await response.json()) as RazorpayErrorResponse;
  } catch {
    return null;
  }
}

async function safeParseOrder(response: Response): Promise<RazorpayOrderResponse | null> {
  try {
    return (await response.json()) as RazorpayOrderResponse;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
