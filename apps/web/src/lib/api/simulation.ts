const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export interface SimulationRun {
  id: string;
  seed: number;
  merchantCount: number;
  eventsPerMerchant: number;
  totalEvents: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string | null;
  completedAt: string | null;
  processingDurationMs: number | null;
  processedEvents: number;
  successfulPayments: number;
  failedPayments: number;
  opportunitiesDetected: number;
  executionsAttempted: number;
  executionsBlocked: number;
  humanReviews: number;
  recoveriesVerified: number;
  revenueAtRisk: number;
  recoverableRevenue: number;
  recoveredRevenue: number;
  createdAt: string;
  updatedAt: string;
}

export interface SimulationAnalytics {
  runId: string;
  status: string;
  seed: number;
  dataset: {
    events: number;
    merchants: number;
    eventsPerMerchant: number;
  };
  payments: {
    total: number;
    successful: number;
    failed: number;
  };
  revenue: {
    atRisk: number;
    recoverable: number;
    recovered: number;
    recoveryRate: number;
  };
  recovery: {
    opportunitiesDetected: number;
    executionsAttempted: number;
    blocked: number;
    humanReview: number;
    recoveriesVerified: number;
  };
  performance: {
    durationMs: number | null;
    eventsPerSecond: number | null;
    startedAt: string | null;
    completedAt: string | null;
  };
}

export interface SimulationStartResponse {
  runId: string;
  status: string;
  seed: number;
  totalEvents: number;
  merchantCount: number;
}

export class SimulationApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 500
  ) {
    super(message);
    this.name = 'SimulationApiError';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {};
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: {
      ...headers,
      ...(options?.headers as Record<string, string>),
    },
  });

  const body = await response.json();

  if (!response.ok) {
    const error = body as { error?: { code: string; message: string } };
    throw new SimulationApiError(
      error?.error?.code ?? 'UNKNOWN_ERROR',
      error?.error?.message ?? 'An unexpected error occurred',
      response.status
    );
  }

  return body as T;
}

export async function startSimulation(params: {
  seed: number;
  events: number;
  merchantCount?: number;
}): Promise<SimulationStartResponse> {
  return request<SimulationStartResponse>('/simulation/run', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function getSimulationRun(runId: string): Promise<SimulationRun> {
  return request<SimulationRun>(`/simulation/run/${runId}`);
}

export async function getSimulationAnalytics(runId: string): Promise<SimulationAnalytics> {
  return request<SimulationAnalytics>(`/simulation/run/${runId}/analytics`);
}

export async function listSimulationRuns(limit?: number): Promise<SimulationRun[]> {
  const query = limit ? `?limit=${limit}` : '';
  return request<SimulationRun[]>(`/simulation/runs${query}`);
}

export async function deleteSimulationRun(runId: string): Promise<{ success: boolean; message: string }> {
  return request<{ success: boolean; message: string }>(`/simulation/run/${runId}`, {
    method: 'DELETE',
  });
}

export async function previewDataset(params: {
  seed: number;
  merchantCount?: number;
  customersPerMerchant?: number;
  paymentsPerMerchant?: number;
}): Promise<{
  merchants: number;
  customers: number;
  orders: number;
  payments: number;
  successfulPayments: number;
  failedPayments: number;
  totalPaymentVolume: number;
  failedPaymentVolume: number;
}> {
  return request('/simulation/preview', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
