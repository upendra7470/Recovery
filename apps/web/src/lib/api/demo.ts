import { apiRequest, ApiError } from './client';

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

export class DemoApiError extends ApiError {
  constructor(
    code: string,
    message: string,
    status: number = 500
  ) {
    super(code, message, status);
    this.name = 'DemoApiError';
  }
}

export async function getDemoStatus(): Promise<DemoStatusResponse> {
  return apiRequest<DemoStatusResponse>('/demo/status');
}

export async function runDemo(scenario?: 'successful' | 'unsafe' | 'review' | 'all'): Promise<DemoRunResponse> {
  const path = scenario ? `/demo/run/${scenario}` : '/demo/run';
  return apiRequest<DemoRunResponse>(path, { method: 'POST' });
}

export async function resetDemo(): Promise<DemoResetResponse> {
  return apiRequest<DemoResetResponse>('/demo/reset', { method: 'DELETE' });
}

export type ModuleScenarioKey =
  | 'subscription_success' | 'subscription_unsafe'
  | 'mandate_success' | 'mandate_unsafe'
  | 'b2b_success' | 'b2b_promise_broken'
  | 'checkout_recovery' | 'checkout_recent'
  | 'degradation_incident';

export const MODULE_SCENARIOS: { key: ModuleScenarioKey; label: string; module: string; outcome: string }[] = [
  { key: 'subscription_success', label: 'Subscription Success', module: 'SUBSCRIPTION_RECOVERY', outcome: 'success' },
  { key: 'subscription_unsafe', label: 'Subscription Unsafe', module: 'SUBSCRIPTION_RECOVERY', outcome: 'blocked' },
  { key: 'mandate_success', label: 'Mandate Retry', module: 'MANDATE_RETRY', outcome: 'success' },
  { key: 'mandate_unsafe', label: 'Mandate Unsafe', module: 'MANDATE_RETRY', outcome: 'blocked' },
  { key: 'b2b_success', label: 'B2B Receivable', module: 'B2B_RECEIVABLE', outcome: 'success' },
  { key: 'b2b_promise_broken', label: 'B2B Promise Broken', module: 'B2B_RECEIVABLE', outcome: 'escalation' },
  { key: 'checkout_recovery', label: 'Checkout Recovery', module: 'CHECKOUT_DROPOFF', outcome: 'success' },
  { key: 'checkout_recent', label: 'Checkout Cooldown', module: 'CHECKOUT_DROPOFF', outcome: 'cooldown' },
  { key: 'degradation_incident', label: 'Degradation Alert', module: 'PAYMENT_DEGRADATION', outcome: 'blocked' },
];

export interface ModuleScenarioResponse {
  scenario: string;
  moduleType: string;
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
  } | null;
  executionOutcome: string;
  executionStatus: string;
  providerReferenceId?: string;
  recovered: boolean;
  recoveredAmount: number;
  description: string;
  stages: DemoStageTrace[];
}

export async function runModuleScenario(moduleScenario: ModuleScenarioKey): Promise<ModuleScenarioResponse> {
  return apiRequest<ModuleScenarioResponse>(`/demo/run/module/${moduleScenario}`, { method: 'POST' });
}
