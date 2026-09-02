import { apiRequest, ApiError } from './client';

export interface JudgeScenario {
  id: string;
  name: string;
  description: string;
  defaultSeed: number;
  defaultEvents: number;
  defaultMerchantCount: number;
}

export interface JudgeStartResponse {
  runId: string;
  scenario: string;
  status: string;
  seed: number;
  totalEvents: number;
  merchantCount: number;
}

export interface JudgeStatusResponse {
  runId: string;
  scenario: string;
  status: string;
  progress: number;
  totalEvents: number;
  processedEvents: number;
  failedEvents: number;
  revenueAtRisk: number;
  recoverableRevenue: number;
  recoveredRevenue: number;
  recoveryRate: number;
  opportunitiesDetected: number;
  executionsAttempted: number;
  executionsBlocked: number;
  humanReviews: number;
  recoveriesVerified: number;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  recentEvents: unknown[];
}

export interface JudgeAnalytics {
  runId: string;
  status: string;
  seed: number;
  dataset: { events: number; merchants: number; eventsPerMerchant: number };
  payments: { total: number; successful: number; failed: number };
  revenue: { atRisk: number; recoverable: number; recovered: number; recoveryRate: number };
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

export class JudgeApiError extends ApiError {
  constructor(
    code: string,
    message: string,
    status: number = 500
  ) {
    super(code, message, status);
    this.name = 'JudgeApiError';
  }
}

export async function getJudgeScenarios(): Promise<{ scenarios: JudgeScenario[] }> {
  return apiRequest('/judge/scenarios');
}

export async function startJudgeScenario(params: {
  scenario: string;
  seed?: number;
  events?: number;
  merchantCount?: number;
}): Promise<JudgeStartResponse> {
  return apiRequest<JudgeStartResponse>('/judge/start', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function getJudgeRunStatus(runId: string): Promise<JudgeStatusResponse> {
  return apiRequest<JudgeStatusResponse>(`/judge/run/${runId}`);
}

export async function getJudgeRunAnalytics(runId: string): Promise<JudgeAnalytics> {
  return apiRequest<JudgeAnalytics>(`/judge/run/${runId}/analytics`);
}

export async function listJudgeRuns(limit?: number): Promise<{ runs: Array<{ id: string; status: string; createdAt: string }> }> {
  const query = limit ? `?limit=${limit}` : '';
  return apiRequest(`/judge/runs${query}`);
}

export async function deleteJudgeRun(runId: string): Promise<{ success: boolean; message: string }> {
  return apiRequest(`/judge/run/${runId}`, { method: 'DELETE' });
}
