const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export const EXECUTION_STATUSES = [
  'PENDING',
  'AUTHORIZED',
  'EXECUTING',
  'SUCCEEDED',
  'FAILED',
  'BLOCKED',
  'CANCELLED',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export interface OperationsExecutionSummary {
  id: string;
  opportunityId: string;
  decisionId: string;
  action: string;
  status: ExecutionStatus;
  origin: 'MANUAL' | 'AUTOMATED';
  attempt: number;
  provider: string | null;
  nextAttemptAt: string | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failureCode: string | null;
  failureReason: string | null;
  reconciliation:
    | 'recovered'
    | 'awaiting_payment_outcome'
    | 'opportunity_closed'
    | 'failed'
    | 'not_applicable';
  opportunityStatus: string | null;
}

export interface OperationsOverview {
  automationEnabled: boolean;
  providerConfigured: boolean;
  countsByStatus: Partial<Record<ExecutionStatus, number>>;
  dueCount: number;
}

export interface OperationsExecutionDetail {
  execution: OperationsExecutionSummary;
  opportunity: {
    id: string;
    status: string;
    amountAtRisk: number;
    currency: string;
    providerPaymentId: string | null;
    providerOrderId: string | null;
  } | null;
  decision: {
    id: string;
    engineVersion: string;
    score: number;
    priority: string;
    confidence: number;
    recommendedAction: string;
  } | null;
}

/**
 * Pure, testable presentation helper mirroring the API's reconciliation
 * semantics: a provider ACCEPTING a retry is never payment recovery.
 */
export function describeReconciliationLabel(
  reconciliation: OperationsExecutionSummary['reconciliation']
): { label: string; tone: 'positive' | 'neutral' | 'warn' | 'risk' } {
  switch (reconciliation) {
    case 'recovered':
      return { label: 'Recovered (webhook-confirmed)', tone: 'positive' };
    case 'awaiting_payment_outcome':
      return { label: 'Awaiting payment outcome', tone: 'neutral' };
    case 'opportunity_closed':
      return { label: 'Opportunity closed', tone: 'warn' };
    case 'failed':
      return { label: 'Attempt failed', tone: 'risk' };
    default:
      return { label: 'Not applicable', tone: 'neutral' };
  }
}

export async function getOperationsOverview(): Promise<OperationsOverview | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/operations/overview`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return null;
    return (await response.json()) as OperationsOverview;
  } catch {
    return null;
  }
}

export async function getOperationsExecutions(filters: {
  status?: ExecutionStatus;
  limit?: number;
} = {}): Promise<{ executions: OperationsExecutionSummary[]; total: number } | null> {
  const params = new URLSearchParams();
  if (filters.status !== undefined) params.set('status', filters.status);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  const query = params.size > 0 ? `?${params.toString()}` : '';
  try {
    const response = await fetch(`${API_BASE_URL}/operations/executions${query}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return null;
    return (await response.json()) as { executions: OperationsExecutionSummary[]; total: number };
  } catch {
    return null;
  }
}

export async function getOperationsExecution(
  id: string
): Promise<OperationsExecutionDetail | null> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/operations/executions/${encodeURIComponent(id)}`,
      {
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!response.ok) return null;
    return (await response.json()) as OperationsExecutionDetail;
  } catch {
    return null;
  }
}
