const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export const RECOVERY_MODULE_TYPES = [
  'FAILED_PAYMENT',
  'SUBSCRIPTION_RECOVERY',
  'MANDATE_RETRY',
  'B2B_RECEIVABLE',
  'CHECKOUT_DROPOFF',
  'PAYMENT_DEGRADATION',
] as const;

export type RecoveryModuleType = (typeof RECOVERY_MODULE_TYPES)[number];

export interface RecoveryModuleInfo {
  type: RecoveryModuleType;
  name: string;
  shortName: string;
  description: string;
  triggerEvent: string;
  primaryAction: string;
  allowedActions: string[];
  defaultUrgency: string;
  icon: string;
  badgeTone: string;
}

export interface ModuleMetrics {
  totalOpportunities: number;
  revenueAtRisk: number;
  recoverableRevenue: number;
  recoveredRevenue: number;
  recoveryRate: number;
  activeCases: number;
  blockedActions: number;
  humanReviews: number;
}

export interface ModuleOpportunityItem {
  id: string;
  moduleType: RecoveryModuleType;
  moduleName: string;
  amount: number;
  currency: string;
  status: string;
  urgency: string;
  triggerEvent: string;
  failureReason: string;
  customerName: string;
  businessContext: string;
  detectedAt: string;
  resolvedAt: string | null;
  decision: {
    recommendedAction: string;
    score: number;
    confidence: number;
    priority: string;
    reasons: string[];
  } | null;
  policyResult: {
    passed: boolean;
    checks: Array<{ name: string; passed: boolean; detail: string }>;
  };
  action: {
    type: string;
    status: string;
    summary: string;
  };
  outcome: {
    recovered: boolean;
    recoveredAmount: number;
    description: string;
  };
}

export interface RecoveryModuleSummary {
  moduleType: RecoveryModuleType;
  info: RecoveryModuleInfo;
  metrics: ModuleMetrics;
  opportunitiesCount: number;
  sampleOpportunities: ModuleOpportunityItem[];
}

export interface RecoveryModulesOverview {
  summary: {
    totalModules: number;
    totalOpportunities: number;
    totalRevenueAtRisk: number;
    totalRecoverableRevenue: number;
    totalRecoveredRevenue: number;
    overallRecoveryRate: number;
    totalBlockedActions: number;
    totalHumanReviews: number;
  };
  modules: RecoveryModuleSummary[];
}

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
  policyChecks: Array<{ name: string; passed: boolean; detail: string }>;
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
  stages: Array<{
    id: string;
    stepNumber: number;
    key: string;
    name: string;
    title: string;
    subtitle: string;
    timeOffsetMs: number;
    status: string;
    details: Record<string, unknown>;
    badge?: string;
    badgeTone?: string;
  }>;
}

export async function getRecoveryModulesOverview(): Promise<RecoveryModulesOverview | null> {
  try {
    const res = await fetch(`${API_BASE}/recovery-modules`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<RecoveryModulesOverview>;
  } catch {
    return null;
  }
}

export async function getRecoveryModuleDetail(type: RecoveryModuleType): Promise<RecoveryModuleSummary | null> {
  try {
    const res = await fetch(`${API_BASE}/recovery-modules/${type}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<RecoveryModuleSummary>;
  } catch {
    return null;
  }
}

export async function getModuleOpportunities(module?: RecoveryModuleType): Promise<{ opportunities: ModuleOpportunityItem[]; total: number } | null> {
  try {
    const url = module
      ? `${API_BASE}/recovery-modules/opportunities?module=${module}`
      : `${API_BASE}/recovery-modules/opportunities`;
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<{ opportunities: ModuleOpportunityItem[]; total: number }>;
  } catch {
    return null;
  }
}

export async function runModuleScenario(moduleScenario: string): Promise<ModuleScenarioResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/demo/run/module/${moduleScenario}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<ModuleScenarioResponse>;
  } catch {
    return null;
  }
}
