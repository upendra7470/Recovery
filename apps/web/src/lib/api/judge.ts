const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

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

export class JudgeApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 500
  ) {
    super(message);
    this.name = 'JudgeApiError';
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
    throw new JudgeApiError(
      error?.error?.code ?? 'UNKNOWN_ERROR',
      error?.error?.message ?? 'An unexpected error occurred',
      response.status
    );
  }

  return body as T;
}

export async function getJudgeScenarios(): Promise<{ scenarios: JudgeScenario[] }> {
  return request('/judge/scenarios');
}

export async function startJudgeScenario(params: {
  scenario: string;
  seed?: number;
  events?: number;
  merchantCount?: number;
}): Promise<JudgeStartResponse> {
  return request<JudgeStartResponse>('/judge/start', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function getJudgeRunStatus(runId: string): Promise<JudgeStatusResponse> {
  return request<JudgeStatusResponse>(`/judge/run/${runId}`);
}

export async function getJudgeRunAnalytics(runId: string): Promise<JudgeAnalytics> {
  return request<JudgeAnalytics>(`/judge/run/${runId}/analytics`);
}

export async function listJudgeRuns(limit?: number): Promise<{ runs: Array<{ id: string; status: string; createdAt: string }> }> {
  const query = limit ? `?limit=${limit}` : '';
  return request(`/judge/runs${query}`);
}

export async function deleteJudgeRun(runId: string): Promise<{ success: boolean; message: string }> {
  return request(`/judge/run/${runId}`, { method: 'DELETE' });
}
