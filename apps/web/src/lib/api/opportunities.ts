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
}

export interface OpportunityListResponse {
  opportunities: OpportunitySummary[];
  total: number;
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
