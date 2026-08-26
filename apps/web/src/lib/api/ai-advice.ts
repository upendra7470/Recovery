const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

/** Authoritative deterministic decision summary (always present in responses). */
export interface AIDecisionSummary {
  engineVersion: string;
  score: number;
  priority: string;
  confidence: number;
  recommendedAction: string;
  riskFlags: { flag: string; explanation: string }[];
}

export interface AIAvailableAdvice {
  status: 'available';
  provider: string;
  model: string;
  advisorVersion: string;
  promptVersion: string;
  summary: string;
  explanation: string;
  nextStep: string;
  customerMessage: string | null;
  operatorMessage: string | null;
  /** Model self-reported confidence — advisory metadata only. */
  confidence: number;
  warnings: string[];
  safetyConstrained: boolean;
  generatedAt: string;
}

export interface AIUnavailableAdvice {
  status: 'unavailable';
  reason: string;
  message: string;
}

export interface AIDisabledAdvice {
  status: 'disabled';
  message: string;
}

export type AIAdviceState =
  | AIAvailableAdvice
  | AIUnavailableAdvice
  | AIDisabledAdvice;

export interface AIAdviceResponse {
  opportunityId: string;
  decision: AIDecisionSummary;
  ai: AIAdviceState;
}

/**
 * Fetches advisory AI intelligence for one opportunity. The response always
 * carries the authoritative deterministic decision; the AI section may be in
 * a disabled/unavailable state. Returns null when the API is unreachable.
 */
export async function getAIAdvice(opportunityId: string): Promise<AIAdviceResponse | null> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/opportunities/${encodeURIComponent(opportunityId)}/ai-advice`,
      {
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as AIAdviceResponse;
  } catch {
    return null;
  }
}
