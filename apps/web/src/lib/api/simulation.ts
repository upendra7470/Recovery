import { apiRequest, ApiError } from './client';

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

export class SimulationApiError extends ApiError {
  constructor(
    code: string,
    message: string,
    status: number = 500
  ) {
    super(code, message, status);
    this.name = 'SimulationApiError';
  }
}

export async function startSimulation(params: {
  seed: number;
  events: number;
  merchantCount?: number;
}): Promise<SimulationStartResponse> {
  return apiRequest<SimulationStartResponse>('/simulation/run', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function getSimulationRun(runId: string): Promise<SimulationRun> {
  return apiRequest<SimulationRun>(`/simulation/run/${runId}`);
}

export async function getSimulationAnalytics(runId: string): Promise<SimulationAnalytics> {
  return apiRequest<SimulationAnalytics>(`/simulation/run/${runId}/analytics`);
}

export async function listSimulationRuns(limit?: number): Promise<SimulationRun[]> {
  const query = limit ? `?limit=${limit}` : '';
  return apiRequest<SimulationRun[]>(`/simulation/runs${query}`);
}

export async function deleteSimulationRun(runId: string): Promise<{ success: boolean; message: string }> {
  return apiRequest<{ success: boolean; message: string }>(`/simulation/run/${runId}`, {
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
  return apiRequest('/simulation/preview', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
