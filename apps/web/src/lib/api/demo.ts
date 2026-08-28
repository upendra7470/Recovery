const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface DemoStatusResponse {
  enabled: boolean;
  hasDemoData: boolean;
  counts: {
    merchants: number;
    paymentEvents: number;
    opportunities: number;
    decisions: number;
    executions: number;
  };
}

export interface DemoScenarioResponse {
  scenario: string;
  opportunityId: string;
  decisionAction: string;
  executionOutcome: string;
  description: string;
}

export interface DemoRunResponse {
  demoRunId: string;
  scenarios: DemoScenarioResponse[];
  summary: {
    totalScenarios: number;
    successfulRecovery: number;
    unsafeRecovery: number;
    reviewCase: number;
  };
}

export interface DemoResetResponse {
  deleted: number;
}

export class DemoApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 500
  ) {
    super(message);
    this.name = 'DemoApiError';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {};
  // Only set Content-Type when there's a body to send
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options?.headers as Record<string, string>,
    },
  });

  const body = await response.json();

  if (!response.ok) {
    const error = body as { error?: { code: string; message: string } };
    throw new DemoApiError(
      error?.error?.code ?? 'UNKNOWN_ERROR',
      error?.error?.message ?? 'An unexpected error occurred',
      response.status
    );
  }

  return body as T;
}

export async function getDemoStatus(): Promise<DemoStatusResponse> {
  return request<DemoStatusResponse>('/demo/status');
}

export async function runDemo(): Promise<DemoRunResponse> {
  return request<DemoRunResponse>('/demo/run', { method: 'POST' });
}

export async function resetDemo(): Promise<DemoResetResponse> {
  return request<DemoResetResponse>('/demo/reset', { method: 'DELETE' });
}
