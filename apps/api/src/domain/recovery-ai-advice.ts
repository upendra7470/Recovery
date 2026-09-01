import { z } from 'zod';
import type { RecoveryDecisionRow } from './recovery-decision.js';

/**
 * Phase 5 — AI-assisted recovery intelligence.
 *
 * The AI layer is ADVISORY ONLY. It never mutates the deterministic decision:
 * score, priority, confidence, risk flags and the recommendation always come
 * from DeterministicDecisionEngine. Advice is persisted per (deterministic
 * decision, advisor version, model) and reused until the underlying decision
 * content changes.
 */

/** Lifecycle of stored advice. Only AVAILABLE rows are persisted today; the
 * enum exists so transient states can be recorded later without migrations
 * colliding with data semantics. Mirrors the AIAdviceStatus Prisma enum. */
export const AI_ADVICE_STATUSES = ['AVAILABLE'] as const;
export type AIAdviceStatus = (typeof AI_ADVICE_STATUSES)[number];

/**
 * Why live advice could not be produced. Never exposes provider internals —
 * these are stable, safe-to-render reason codes.
 */
export const AI_ADVICE_UNAVAILABLE_REASONS = [
  'disabled',
  'timeout',
  'rate_limited',
  'provider_error',
  'network_error',
  'invalid_response',
] as const;
export type AIAdviceUnavailableReason = (typeof AI_ADVICE_UNAVAILABLE_REASONS)[number];

/**
 * Minimized, deliberately constructed input handed to an advisor.
 *
 * Data minimization: NO customer PII (email/contact), no payment instrument
 * data, no raw webhook payloads, no secrets — only the structured fields the
 * model needs to reason about recovery context.
 */
export interface RecoveryAIAdviceRequest {
  opportunityId: string;
  opportunityType: string;
  currency: string;
  /** Minor currency units (paise for INR). */
  amount: number;
  failureCategory: string;
  /** null when absent from evidence; the prompt must acknowledge gaps. */
  failureCode: string | null;
  observedFailedRetries: number;
  opportunityStatus: string;
  // --- deterministic assessment (authoritative, read-only for the model) ---
  score: number;
  priority: string;
  confidence: number;
  recommendation: string;
  reasons: readonly string[];
  riskFlags: readonly { flag: string; explanation: string }[];
  historicalRecoveryRatePercent: number | null;
  // --- Phase 12.3: strategy intelligence context ---
  /** Module type for strategy candidate validation. */
  moduleType?: string;
  /** Candidate strategies valid for this module. */
  candidateStrategies?: readonly {
    strategy: string;
    label: string;
    isDefault: boolean;
    executable: boolean;
  }[];
  /** Merchant-specific historical strategy performance. */
  merchantHistory?: {
    confidence: 'SUFFICIENT' | 'LOW' | 'INSUFFICIENT';
    totalSamples: number;
    strategyPerformance: readonly {
      strategy: string;
      successRate: number;
      effectivenessScore: number;
      confidence: number;
      sampleCount: number;
    }[];
  };
  /** The deterministic strategy recommendation based on merchant memory. */
  deterministicStrategyRecommendation?: {
    strategy: string;
    reason: string;
    score: number;
  };
}

/**
 * Validated advisory output produced by an advisor. Deliberately contains NO
 * recommendation/score/priority fields — the model cannot override what it is
 * not given a slot to express.
 */
export interface RecoveryAIAdviceContent {
  summary: string;
  explanation: string;
  nextStep: string;
  customerMessage: string | null;
  operatorMessage: string | null;
  /** Model's self-reported confidence in its own analysis, 0–100. */
  confidence: number;
  warnings: string[];
}

/** Result contract for advisors: available content or a safe unavailability. */
export type AIAdvisorResult =
  | { status: 'available'; content: RecoveryAIAdviceContent }
  | { status: 'unavailable'; reason: AIAdviceUnavailableReason };

/** Provider-independent advisor boundary. Implementations must be side-effect
 * free beyond their outbound call and MUST NOT be trusted for safety. */
export interface RecoveryAIAdvisor {
  /** Informational provider label persisted alongside advice. */
  readonly provider: string;
  advise(request: RecoveryAIAdviceRequest): Promise<AIAdvisorResult>;
}

/** Persisted shape of a recovery_ai_advice row. */
export interface RecoveryAIAdviceRow {
  id: string;
  merchantId: string | null;
  opportunityId: string;
  decisionId: string;
  provider: string;
  model: string;
  advisorVersion: string;
  promptVersion: string;
  status: AIAdviceStatus;
  summary: string;
  explanation: string;
  nextStep: string;
  customerMessage: string | null;
  operatorMessage: string | null;
  confidence: number;
  warnings: string[];
  safetyConstrained: boolean;
  /**
   * SHA-256 of the deterministic decision's safety-relevant content at advice
   * generation time; mismatch ⇒ stale ⇒ regenerate on next read.
   */
  decisionFingerprint: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Data required to persist AI advice. */
export interface NewRecoveryAIAdviceData {
  merchantId: string | null;
  opportunityId: string;
  decisionId: string;
  provider: string;
  model: string;
  advisorVersion: string;
  promptVersion: string;
  status: AIAdviceStatus;
  summary: string;
  explanation: string;
  nextStep: string;
  customerMessage: string | null;
  operatorMessage: string | null;
  confidence: number;
  warnings: string[];
  safetyConstrained: boolean;
  decisionFingerprint: string;
}

/** Persistence boundary for AI advice (Prisma adapter in prisma-stores.ts). */
export interface RecoveryAIAdviceStore {
  upsert(data: NewRecoveryAIAdviceData): Promise<RecoveryAIAdviceRow>;
  findByDecision(args: {
    decisionId: string;
    advisorVersion: string;
    model: string;
  }): Promise<RecoveryAIAdviceRow | null>;
  findByDecisionId(decisionId: string): Promise<RecoveryAIAdviceRow | null>;
}

// ---------------------------------------------------------------------------
// Model-output validation schema (the LLM is untrusted input)
// ---------------------------------------------------------------------------

const boundedText = (min: number, max: number) =>
  z.string().transform((value) => value.trim()).pipe(z.string().min(min).max(max));

/**
 * Strict schema for model output. Missing required fields, non-finite or
 * out-of-range confidence, oversized text and wrong types are all rejected —
 * malformed model output can never crash the API or leak into persistence.
 */
export const aiAdviceContentSchema = z.object({
  summary: boundedText(8, 600),
  explanation: boundedText(20, 2000),
  nextStep: boundedText(4, 400),
  customerMessage: boundedText(4, 800).nullish(),
  operatorMessage: boundedText(4, 800).nullish(),
  // Strictly numeric: coercions like null/"" → 0 would silently launder
  // invalid model output into a plausible-looking confidence.
  confidence: z.number().finite().int().min(0).max(100),
  warnings: z.array(boundedText(2, 300)).max(10).default([]),
});

export type ValidatedAIAdviceContent = z.infer<typeof aiAdviceContentSchema>;

// ---------------------------------------------------------------------------
// Route schemas
// ---------------------------------------------------------------------------

export const aiAdviceParamsSchema = z.object({
  id: z.string().uuid(),
});

/** Stable fingerprint input: only safety-relevant decision fields. */
export function decisionFingerprintParts(decision: Pick<
  RecoveryDecisionRow,
  'score' | 'priority' | 'confidence' | 'recommendedAction' | 'riskFlags'
>): string {
  return JSON.stringify([
    decision.score,
    decision.priority,
    decision.confidence,
    decision.recommendedAction,
    [...decision.riskFlags]
      .map((flag) => `${flag.flag}:${flag.explanation}`)
      .sort(),
  ]);
}
