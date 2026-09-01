import type { MerchantMemoryStrategy, MerchantStrategyMemoryRow } from '../domain/merchant-memory.js';
import type { RecoveryModuleType } from '../domain/recovery-module.js';
import {
  getStrategyCandidates,
  getDefaultStrategy,
  type ModuleStrategyCandidate,
} from '../modules/module-strategies.js';

/**
 * Phase 12.3 — Deterministic Strategy Ranking.
 *
 * Ranks candidate strategies using actual merchant-memory evidence.
 * The ranking formula is simple, deterministic, documented, and tested.
 *
 * Scoring formula (per strategy):
 *   score = (successRate × 0.50) + (effectivenessScore/100 × 0.30) + (confidence/100 × 0.20)
 *
 * Where:
 *   successRate        = successes / attempts (0.0 – 1.0)
 *   effectivenessScore = MerchantMemoryService-calculated score (0 – 100)
 *   confidence         = sample-size-based confidence (0 – 100)
 *
 * Cold-start behavior:
 *   When merchant memory has insufficient data (sampleCount < 5 or no rows),
 *   the ranking returns INSUFFICIENT confidence with the module's default strategy.
 */

export interface StrategyRanking {
  /** The ranked strategies, highest score first. */
  strategies: RankedStrategy[];
  /** Overall confidence in the ranking based on available evidence. */
  confidence: 'SUFFICIENT' | 'LOW' | 'INSUFFICIENT';
  /** The recommended strategy (top-ranked or default). */
  recommended: MerchantMemoryStrategy;
  /** Explanation of why this strategy was recommended. */
  reason: string;
  /** Whether this is a cold-start recommendation. */
  isColdStart: boolean;
  /** Total number of historical outcomes used for this ranking. */
  totalSamples: number;
}

export interface RankedStrategy {
  strategy: MerchantMemoryStrategy;
  label: string;
  score: number;
  successRate: number;
  effectivenessScore: number;
  confidence: number;
  sampleCount: number;
  isDefault: boolean;
  executable: boolean;
}

const MIN_SAMPLES_FOR_SUFFICIENT = 5;
const MIN_SAMPLES_FOR_LOW = 1;

/**
 * Rank strategies for a given merchant + module + failure type combination.
 *
 * @param merchantId - The merchant to rank strategies for
 * @param moduleType - The recovery module type
 * @param failureType - The specific failure type (e.g., "GATEWAY_ERROR")
 * @param memoryRows - Historical memory rows from MerchantStrategyMemoryStore
 */
export function rankStrategies(
  merchantId: string,
  moduleType: RecoveryModuleType,
  failureType: string,
  memoryRows: MerchantStrategyMemoryRow[]
): StrategyRanking {
  const candidates = getStrategyCandidates(moduleType);
  const defaultStrategy = getDefaultStrategy(moduleType);

  // Filter memory rows to only those matching this merchant + failure type
  const relevantRows = memoryRows.filter(
    (row) =>
      row.merchantId === merchantId &&
      row.failureType === failureType
  );

  // Build a lookup of strategy → memory row
  const memoryByStrategy = new Map<MerchantMemoryStrategy, MerchantStrategyMemoryRow>();
  for (const row of relevantRows) {
    memoryByStrategy.set(row.strategy, row);
  }

  // Calculate total samples across all strategies for this failure type
  const totalSamples = relevantRows.reduce((sum, row) => sum + row.sampleCount, 0);

  // Rank each candidate strategy
  const ranked: RankedStrategy[] = candidates.map((candidate) => {
    const memory = memoryByStrategy.get(candidate.strategy);

    if (memory === undefined || memory.sampleCount === 0) {
      return {
        strategy: candidate.strategy,
        label: candidate.label,
        score: candidate.isDefault ? 0.1 : 0,
        successRate: 0,
        effectivenessScore: 0,
        confidence: 0,
        sampleCount: 0,
        isDefault: candidate.isDefault,
        executable: candidate.executable,
      };
    }

    const score = calculateStrategyScore(
      memory.successRate,
      memory.effectivenessScore,
      memory.confidence
    );

    return {
      strategy: candidate.strategy,
      label: candidate.label,
      score,
      successRate: memory.successRate,
      effectivenessScore: memory.effectivenessScore,
      confidence: memory.confidence,
      sampleCount: memory.sampleCount,
      isDefault: candidate.isDefault,
      executable: candidate.executable,
    };
  });

  // Sort by score descending
  ranked.sort((a, b) => b.score - a.score);

  // Determine confidence level
  const confidence = determineConfidence(totalSamples, ranked);

  // Determine recommendation
  let recommended: MerchantMemoryStrategy;
  let reason: string;
  let isColdStart: boolean;

  if (confidence === 'INSUFFICIENT') {
    recommended = defaultStrategy;
    reason = 'Insufficient merchant history — using default strategy.';
    isColdStart = true;
  } else {
    const topRanked = ranked[0]!;
    recommended = topRanked.strategy;
    if (topRanked.sampleCount >= MIN_SAMPLES_FOR_SUFFICIENT) {
      reason = `Merchant history shows ${topRanked.strategy} has produced the strongest verified recovery performance (${Math.round(topRanked.successRate * 100)}% success rate, effectiveness ${topRanked.effectivenessScore.toFixed(1)}).`;
    } else {
      reason = `Limited merchant history suggests ${topRanked.strategy} as the best available option.`;
    }
    isColdStart = false;
  }

  return {
    strategies: ranked,
    confidence,
    recommended,
    reason,
    isColdStart,
    totalSamples,
  };
}

/**
 * Calculate a deterministic score for a strategy based on its historical metrics.
 *
 * Formula:
 *   score = (successRate × 50) + (effectivenessScore/100 × 30) + (confidence/100 × 20)
 *
 * Range: 0 – 100
 */
export function calculateStrategyScore(
  successRate: number,
  effectivenessScore: number,
  confidence: number
): number {
  const baseComponent = successRate * 50;
  const effectivenessComponent = (effectivenessScore / 100) * 30;
  const confidenceComponent = (confidence / 100) * 20;
  return Math.round(Math.min(100, baseComponent + effectivenessComponent + confidenceComponent) * 10) / 10;
}

/**
 * Determine the confidence level for a strategy ranking.
 */
function determineConfidence(
  totalSamples: number,
  ranked: RankedStrategy[]
): 'SUFFICIENT' | 'LOW' | 'INSUFFICIENT' {
  if (totalSamples < MIN_SAMPLES_FOR_LOW) {
    return 'INSUFFICIENT';
  }

  // Check if at least one strategy has enough samples
  const hasSufficientData = ranked.some((r) => r.sampleCount >= MIN_SAMPLES_FOR_SUFFICIENT);
  if (hasSufficientData) {
    return 'SUFFICIENT';
  }

  return 'LOW';
}

/**
 * Validate that an AI-recommended strategy is valid for the module
 * and was present in the candidate strategies.
 */
export function validateAiStrategy(
  moduleType: RecoveryModuleType,
  recommendedStrategy: string,
  candidateStrategies: ModuleStrategyCandidate[]
): { valid: boolean; reason: string } {
  // Check if strategy exists in candidates
  const found = candidateStrategies.find((c) => c.strategy === recommendedStrategy);
  if (found === undefined) {
    return {
      valid: false,
      reason: `Strategy "${recommendedStrategy}" is not a valid candidate for module ${moduleType}. Valid candidates: ${candidateStrategies.map((c) => c.strategy).join(', ')}`,
    };
  }

  return { valid: true, reason: 'Strategy validated against module candidates.' };
}
