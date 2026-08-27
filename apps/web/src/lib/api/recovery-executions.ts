const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export interface ExecutionSummary {
  id: string;
  action: string;
  status:
    | 'PENDING'
    | 'AUTHORIZED'
    | 'EXECUTING'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'BLOCKED'
    | 'CANCELLED';
  attempt: number;
  provider: string | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failureCode: string | null;
  failureReason: string | null;
}

export interface ExecutionEligibility {
  eligible: boolean;
  action: string;
  reason: string | null;
  detail: string | null;
}

export interface ExecutionsListResponse {
  opportunityId: string;
  eligibility: ExecutionEligibility;
  executions: ExecutionSummary[];
}

export interface CheckoutData {
  orderId: string;
  keyId: string;
}

export interface ExecutionResultResponse {
  opportunityId: string;
  outcome: 'created' | 'replayed' | 'provider-rejected' | 'provider-unavailable' | 'blocked';
  execution: ExecutionSummary;
  checkout?: CheckoutData;
}

export interface ExecutionErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/** Live eligibility snapshot; null when the API is unreachable or case unknown. */
export async function getExecutions(
  opportunityId: string
): Promise<ExecutionsListResponse | null> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/opportunities/${encodeURIComponent(opportunityId)}/executions`,
      {
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as ExecutionsListResponse;
  } catch {
    return null;
  }
}

/**
 * Requests controlled execution for one opportunity. The deterministic safety
 * gate always runs server-side; the result distinguishes submitted requests
 * ('created') from payment recovery, which only payment events can confirm.
 */
export async function requestExecution(
  opportunityId: string
): Promise<
  | { kind: 'ok'; body: ExecutionResultResponse }
  | { kind: 'blocked'; reason: string; detail: string }
  | { kind: 'disabled'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; status: number; message: string }
> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/opportunities/${encodeURIComponent(opportunityId)}/execute`,
      {
        method: 'POST',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      }
    );

    const payload: unknown = await response.json().catch(() => null);

    if (response.ok) {
      return { kind: 'ok', body: payload as ExecutionResultResponse };
    }

    const error = (payload as ExecutionErrorBody | null)?.error;
    if (response.status === 409) {
      const detail = error?.details as { reason?: string; detail?: string } | undefined;
      return {
        kind: 'blocked',
        reason: detail?.reason ?? 'BLOCKED',
        detail: detail?.detail ?? error?.message ?? 'Blocked by the safety policy.',
      };
    }
    if (response.status === 503 && error?.code === 'EXECUTION_DISABLED') {
      return {
        kind: 'disabled',
        message: error.message,
      };
    }
    if (response.status === 503) {
      return {
        kind: 'unavailable',
        message: error?.message ?? 'The recovery provider is unavailable.',
      };
    }
    return {
      kind: 'error',
      status: response.status,
      message: error?.message ?? `Request failed with status ${response.status}.`,
    };
  } catch {
    return {
      kind: 'error',
      status: 0,
      message: 'Could not reach the API. The deterministic decision remains valid.',
    };
  }
}
