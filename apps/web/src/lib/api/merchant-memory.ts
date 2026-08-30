const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export interface MerchantStrategyMemoryRow {
  id: string;
  merchantId: string;
  strategy: string;
  failureType: string;
  attempts: number;
  successes: number;
  failures: number;
  blocked: number;
  humanReviews: number;
  totalAmountAttempted: number;
  totalAmountRecovered: number;
  successRate: number;
  recoveryRate: number;
  sampleCount: number;
  confidence: number;
  effectivenessScore: number;
  lastObservedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantFailurePatternSummary {
  failureType: string;
  attempts: number;
  successes: number;
  recoveryRate: number;
  bestStrategy: string | null;
  bestStrategySuccessRate: number;
}

export interface MerchantMemoryOverview {
  merchantId: string;
  totalOutcomes: number;
  totalRecovered: number;
  totalAmountRecovered: number;
  recoveryRate: number;
  bestStrategy: string | null;
  bestStrategySuccessRate: number;
  strategies: MerchantStrategyMemoryRow[];
  failurePatterns: MerchantFailurePatternSummary[];
  confidence: 'NO_DATA' | 'LOW' | 'SUFFICIENT';
  lastObservedAt: string | null;
}

export interface MerchantMemoryEvidence {
  merchantId: string;
  strategyPerformance: Array<{
    strategy: string;
    failureType: string;
    attempts: number;
    successes: number;
    successRate: number;
    totalAmountRecovered: number;
    confidence: number;
  }>;
  overallRecoveryRate: number;
  totalOutcomes: number;
  confidenceLevel: 'NO_DATA' | 'LOW' | 'SUFFICIENT';
}

export interface MerchantMemoryClearResponse {
  cleared: number;
}

export class MerchantMemoryApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 500
  ) {
    super(message);
    this.name = 'MerchantMemoryApiError';
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
    throw new MerchantMemoryApiError(
      error?.error?.code ?? 'UNKNOWN_ERROR',
      error?.error?.message ?? 'An unexpected error occurred',
      response.status
    );
  }

  return body as T;
}

export async function getMerchantMemoryOverview(): Promise<MerchantMemoryOverview> {
  return request<MerchantMemoryOverview>('/merchant-memory');
}

export async function getMerchantMemoryEvidence(): Promise<MerchantMemoryEvidence> {
  return request<MerchantMemoryEvidence>('/merchant-memory/evidence');
}

export async function clearMerchantMemory(): Promise<MerchantMemoryClearResponse> {
  return request<MerchantMemoryClearResponse>('/merchant-memory/clear', { method: 'POST' });
}
