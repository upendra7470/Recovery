const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export interface DashboardRevenueMetrics {
  atRisk: number;
  recoverable: number;
  recovered: number;
  recoveryRate: number;
}

export interface DashboardPaymentMetrics {
  total: number;
  successful: number;
  failed: number;
  successRate: number;
}

export interface DashboardRecoveryMetrics {
  opportunities: number;
  executionsAttempted: number;
  blocked: number;
  succeeded: number;
  failed: number;
  pending: number;
  verified: number;
}

export interface DashboardSafetyMetrics {
  approved: number;
  blocked: number;
  humanReview: number;
}

export interface DashboardActivityItem {
  id: string;
  type: 'opportunity' | 'execution' | 'decision';
  action: string;
  status: string;
  amount: number | null;
  currency: string | null;
  timestamp: string;
  detail: string;
}

export interface DashboardOverview {
  revenue: DashboardRevenueMetrics;
  payments: DashboardPaymentMetrics;
  recovery: DashboardRecoveryMetrics;
  safety: DashboardSafetyMetrics;
  recentActivity: DashboardActivityItem[];
  hasData: boolean;
}

export async function getDashboardOverview(
  merchantId?: string
): Promise<DashboardOverview | null> {
  const params = new URLSearchParams();
  if (merchantId) {
    params.set('merchantId', merchantId);
  }
  const qs = params.toString();
  const url = `${API_BASE}/dashboard/overview${qs ? `?${qs}` : ''}`;

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as DashboardOverview;
  } catch {
    return null;
  }
}
