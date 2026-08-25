import type { FailureCategory } from '../domain/recovery-decision.js';

/**
 * Deterministic mapping from provider failure codes to recovery-relevant
 * categories. Matching is case-insensitive substring matching over known
 * code tokens (Razorpay codes are not fully enumerated publicly and vary by
 * issuer/bank, so exact-match tables would silently misclassify new codes).
 *
 * Unmapped codes stay UNKNOWN — the engine never guesses a category it
 * cannot support, and UNKNOWN lowers confidence instead of inventing one.
 */
const TRANSIENT_TOKENS = [
  'network',
  'gateway',
  'timeout',
  'timed_out',
  'server_error',
  'internal_error',
  'technology_issue',
  'issuer_unavailable',
  'processing_error',
  'system_error',
] as const;

const INSUFFICIENT_FUNDS_TOKENS = [
  'insufficient',
  'insuff_funds',
  'no_funds',
  'low_balance',
  'exceeds_limit',
  'limit_exceeded',
] as const;

const AUTHENTICATION_TOKENS = [
  'auth',
  'authentication',
  'otp',
  'pin',
  'three_d',
  '3ds',
  'cvv',
  'password',
] as const;

/** Conditions where retrying is inappropriate per explicitly encoded rules. */
const HARD_DECLINE_TOKENS = [
  'lost_card',
  'stolen_card',
  'reported_lost',
  'reported_stolen',
  'blocked_card',
  'card_blocked',
  'fraud',
  'do_not_honor',
  'do_not_honour',
  'invalid_card',
  'cancelled_card',
  'expired_card',
  'prohibited',
] as const;

export interface FailureCategoryAssessment {
  category: FailureCategory;
  /** Short deterministic rationale recorded in decision factors/reasons. */
  explanation: string;
}

export function categorizeFailureCode(failureCode: string | null): FailureCategoryAssessment {
  if (failureCode === null || failureCode.trim() === '') {
    return {
      category: 'UNKNOWN',
      explanation: 'No failure code was recorded in the opportunity evidence.',
    };
  }

  const normalized = failureCode.toLowerCase();

  // Order matters: hard declines win over overlapping tokens so a blocked or
  // fraudulent card is never recommended a retry.
  if (matchesAny(normalized, HARD_DECLINE_TOKENS)) {
    return {
      category: 'HARD_DECLINE',
      explanation: `Failure code "${failureCode}" indicates a condition that is not appropriate to retry.`,
    };
  }
  if (matchesAny(normalized, AUTHENTICATION_TOKENS)) {
    return {
      category: 'AUTHENTICATION',
      explanation: `Failure code "${failureCode}" points to an authentication/verification issue that requires customer action.`,
    };
  }
  if (matchesAny(normalized, INSUFFICIENT_FUNDS_TOKENS)) {
    return {
      category: 'INSUFFICIENT_FUNDS',
      explanation: `Failure code "${failureCode}" indicates a funding shortfall on the customer side.`,
    };
  }
  if (matchesAny(normalized, TRANSIENT_TOKENS)) {
    return {
      category: 'TRANSIENT',
      explanation: `Failure code "${failureCode}" looks transient (network/gateway/issuer availability) and is typically retryable.`,
    };
  }

  return {
    category: 'UNKNOWN',
    explanation: `Failure code "${failureCode}" is not in the known classification table; treated conservatively as unknown.`,
  };
}

function matchesAny(normalizedCode: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => normalizedCode.includes(token));
}
