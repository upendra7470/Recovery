const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export type DemoScenarioType = 'SUCCESSFUL_RECOVERY' | 'UNSAFE_RECOVERY' | 'REVIEW_CASE';

export interface DemoStageTrace {
  id: string;
  stepNumber: number;
  key: string;
  name: string;
  title: string;
  subtitle: string;
  timeOffsetMs: number;
  status: 'completed' | 'blocked' | 'review' | 'skipped';
  details: Record<string, unknown>;
  badge?: string;
  badgeTone?: 'risk' | 'positive' | 'warn' | 'neutral' | 'indigo';
}

export interface DemoPolicyCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface DemoScenarioResponse {
  scenario: DemoScenarioType;
  scenarioName: string;
  opportunityId: string;
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  decisionAction: string;
  decisionScore: number;
  decisionConfidence: number;
  decisionPriority: string;
  decisionExplanation: string[];
  policyChecks: DemoPolicyCheck[];
  aiAdvice: {
    summary: string;
    explanation: string;
    nextStep: string;
    confidence: number;
    operatorMessage?: string | null;
    customerMessage?: string | null;
    warnings: string[];
  } | null;
  executionOutcome: string;
  executionStatus: string;
  providerReferenceId?: string;
  recovered: boolean;
  recoveredAmount: number;
  description: string;
  stages: DemoStageTrace[];
}

export interface DemoMetrics {
  revenueAtRisk: number;
  recoverableRevenue: number;
  recoveredRevenue: number;
  recoveryRate: number;
  openOpportunities: number;
  successfulRecoveries: number;
  blockedActions: number;
  humanReviews: number;
}

export interface DemoRunResponse {
  demoRunId: string;
  scenarios: DemoScenarioResponse[];
  summary: {
    totalScenarios: number;
    successfulRecovery: number;
    unsafeRecovery: number;
    reviewCase: number;
    recoveredAmount: number;
  };
  metrics: DemoMetrics;
}

export interface DemoStatusResponse {
  enabled: boolean;
  hasDemoData: boolean;
  isRunning: boolean;
  counts: {
    merchants: number;
    paymentEvents: number;
    opportunities: number;
    decisions: number;
    executions: number;
    aiAdvice: number;
  };
  metrics: DemoMetrics;
  lastRunScenario: string | null;
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

export async function runDemo(scenario?: 'successful' | 'unsafe' | 'review' | 'all'): Promise<DemoRunResponse> {
  const path = scenario ? `/demo/run/${scenario}` : '/demo/run';
  return request<DemoRunResponse>(path, { method: 'POST' });
}

export async function resetDemo(): Promise<DemoResetResponse> {
  return request<DemoResetResponse>('/demo/reset', { method: 'DELETE' });
}
