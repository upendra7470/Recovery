const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export const RECOVERY_OPPORTUNITY_TYPES = [
  'FAILED_PAYMENT',
  'SUBSCRIPTION_PAYMENT_FAILED',
  'CHECKOUT_DROPOFF',
] as const;
export type RecoveryOpportunityType = (typeof RECOVERY_OPPORTUNITY_TYPES)[number];

export const RECOVERY_OPPORTUNITY_STATUSES = [
  'OPEN',
  'RECOVERED',
  'EXPIRED',
  'DISMISSED',
] as const;
export type RecoveryOpportunityStatus = (typeof RECOVERY_OPPORTUNITY_STATUSES)[number];

export const RECOMMENDED_ACTIONS = [
  'RETRY',
  'WAIT',
  'CUSTOMER_ACTION_REQUIRED',
  'DO_NOT_RETRY',
  'REVIEW',
  'NO_ACTION',
] as const;
export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];

export const DECISION_PRIORITIES = [
  'VERY_LOW',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const;
export type DecisionPriority = (typeof DECISION_PRIORITIES)[number];

/** Latest stored decision for an opportunity (additive summary field). */
export interface OpportunityDecisionSummary {
  score: number;
  priority: DecisionPriority;
  confidence: number;
  recommendedAction: RecommendedAction;
  evaluatedAt: string;
}

/** Amounts are provider minor units (paise for INR); never estimated. */
export interface OpportunitySummary {
  id: string;
  merchantId: string | null;
  paymentAccountId: string | null;
  type: RecoveryOpportunityType;
  status: RecoveryOpportunityStatus;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  amountAtRisk: number;
  currency: string;
  reason: string;
  detectedAt: string;
  expiresAt: string | null;
  decision?: OpportunityDecisionSummary;
}

export interface DecisionFactor {
  name: string;
  contribution: number;
  value: string | number | boolean | null;
  explanation: string;
}

export interface DecisionRiskFlagDetail {
  flag: string;
  explanation: string;
}

/** Full explainable decision for one opportunity. */
export interface OpportunityDecisionDetail {
  opportunityId: string;
  engineVersion: string;
  score: number;
  priority: DecisionPriority;
  confidence: number;
  recommendedAction: RecommendedAction;
  reasons: string[];
  factors: DecisionFactor[];
  riskFlags: DecisionRiskFlagDetail[];
  evaluatedAt: string;
}

export interface DecisionsOverview {
  criticalOpportunities: number;
  highPriorityOpportunities: number;
  recommendedRetries: number;
  reviewRequired: number;
  doNotRetry: number;
  /** Average confidence across stored decisions; null when none exist. */
  averageConfidence: number | null;
  engineVersion: string;
}

export interface OpportunityListResponse {
  opportunities: OpportunitySummary[];
  total: number;
}

/** Full single-opportunity detail incl. non-sensitive source-event summary. */
export interface SourceEventSummary {
  id: string;
  eventType: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  amount?: number;
  currency?: string;
  status?: string;
  occurredAt: string;
}

export interface OpportunityDetail extends Omit<OpportunitySummary, 'decision'> {
  evidence: unknown;
  resolvedAt: string | null;
  recoveryEventId: string | null;
  sourceEvent: SourceEventSummary | null;
}

export interface CurrencyBreakdown {
  currency: string;
  /** Sum of OPEN opportunity amounts in this currency (minor units). */
  revenueAtRisk: number;
  /** Sum of RECOVERED opportunity amounts in this currency (minor units). */
  recoveredAmount: number;
}

export interface OpportunitiesOverviewResponse {
  openOpportunities: number;
  failedPayments: number;
  currencies: CurrencyBreakdown[];
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function getOpportunityOverview(
  merchantId?: string
): Promise<OpportunitiesOverviewResponse | null> {
  const query = merchantId !== undefined ? `?merchantId=${encodeURIComponent(merchantId)}` : '';
  return fetchJson<OpportunitiesOverviewResponse>(`/opportunities/overview${query}`);
}

export async function getOpportunities(filters: {
  merchantId?: string;
  status?: RecoveryOpportunityStatus;
  type?: RecoveryOpportunityType;
} = {}): Promise<OpportunityListResponse | null> {
  const params = new URLSearchParams();
  if (filters.merchantId !== undefined) params.set('merchantId', filters.merchantId);
  if (filters.status !== undefined) params.set('status', filters.status);
  if (filters.type !== undefined) params.set('type', filters.type);
  const query = params.size > 0 ? `?${params.toString()}` : '';
  return fetchJson<OpportunityListResponse>(`/opportunities${query}`);
}

export async function getOpportunity(
  opportunityId: string
): Promise<OpportunityDetail | null> {
  return fetchJson<OpportunityDetail>(`/opportunities/${encodeURIComponent(opportunityId)}`);
}

export async function getOpportunityDecision(
  opportunityId: string
): Promise<OpportunityDecisionDetail | null> {
  return fetchJson<OpportunityDecisionDetail>(
    `/opportunities/${encodeURIComponent(opportunityId)}/decision`
  );
}

export async function getDecisionsOverview(): Promise<DecisionsOverview | null> {
  return fetchJson<DecisionsOverview>(`/decisions/overview`);
}
