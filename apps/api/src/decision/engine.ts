import type {
  DecisionFactor,
  DecisionFeatures,
  DecisionRiskFlagDetail,
  RecoveryDecisionResult,
  RecommendedAction,
} from '../domain/recovery-decision.js';

/**
 * DeterministicDecisionEngine — Phase 4.
 *
 * A transparent, explainable heuristic model (NOT machine learning): fixed
 * weights over observed factors produce the score; a separate evidence-quality
 * calculation produces confidence; ordered safety rules pick the action.
 *
 * Purity contract: no clock reads, no randomness, no I/O. The evaluation time
 * arrives inside the features (opportunityAgeMs / retry recency are computed
 * by the caller), so identical input always yields an identical decision.
 */
export const DECISION_ENGINE_VERSION = 'v1';

/** Historical sample below which statistics are treated as unavailable. */
export const MIN_HISTORICAL_SAMPLE = 20;
/** Confidence at or below this level forces REVIEW (safety-first). */
export const LOW_CONFIDENCE_THRESHOLD = 40;
/** Failed retries from which the engine flags an aggressive attempt pattern. */
export const HIGH_RETRY_THRESHOLD = 4;
/** Retry attempts within this many minutes are considered "too recent". */
const RECENT_RETRY_WINDOW_MINUTES = 60;

interface FactorWeights {
  readonly value: number;
  readonly recency: number;
  readonly recoverability: number;
  readonly retryHistory: number;
  readonly historicalSupport: number;
}

/**
 * Fixed, documented weights (sum ≡ 100). Changing them changes engine
 * semantics and requires bumping DECISION_ENGINE_VERSION.
 */
const WEIGHTS: FactorWeights = {
  value: 25,
  recency: 15,
  recoverability: 25,
  retryHistory: 15,
  historicalSupport: 20,
};

export class DeterministicDecisionEngine {
  readonly version = DECISION_ENGINE_VERSION;

  evaluate(features: DecisionFeatures): RecoveryDecisionResult {
    const factors = [
      ...valueFactor(features, WEIGHTS.value),
      ...recencyFactor(features, WEIGHTS.recency),
      ...recoverabilityFactor(features, WEIGHTS.recoverability),
      ...retryHistoryFactor(features, WEIGHTS.retryHistory),
      ...historicalSupportFactor(features, WEIGHTS.historicalSupport),
    ];

    const score = clamp(
      factors.reduce((total, factor) => total + factor.contribution, 0),
      0,
      100
    );

    const riskFlags = buildRiskFlags(features);
    const confidence = computeConfidence(features);
    const recommendedAction = selectAction(features, confidence);

    return {
      score,
      priority: priorityForScore(score),
      confidence,
      recommendedAction,
      reasons: buildReasons(features, factors, riskFlags, recommendedAction),
      factors,
      riskFlags,
    };
  }
}

// ---------------------------------------------------------------------------
// Factors
// ---------------------------------------------------------------------------

function valueFactor(features: DecisionFeatures, weight: number): DecisionFactor[] {
  // Bands in minor units. INR paise is the primary ledger; for other
  // currencies the same minor-unit thresholds apply as a documented
  // approximation (Phase 4 supports INR operationally).
  const amount = Math.max(0, features.recoverableAmount);
  let contribution: number;
  if (amount < 50_000) contribution = Math.round(weight * 0.2);        // < ₹500
  else if (amount < 200_000) contribution = Math.round(weight * 0.4);   // < ₹2,000
  else if (amount < 1_000_000) contribution = Math.round(weight * 0.64); // < ₹10,000
  else if (amount < 5_000_000) contribution = Math.round(weight * 0.84); // < ₹50,000
  else contribution = weight;

  return [
    {
      name: 'value',
      contribution,
      value: amount,
      explanation: `Recoverable amount of ${amount} ${features.currency} minor units contributes ${contribution}/${weight} points.`,
    },
  ];
}

function recencyFactor(features: DecisionFeatures, weight: number): DecisionFactor[] {
  const ageHours = features.opportunityAgeMs / (60 * 60 * 1000);
  let contribution: number;
  if (ageHours < 1) contribution = weight;
  else if (ageHours < 6) contribution = Math.round(weight * 0.87);
  else if (ageHours < 24) contribution = Math.round(weight * 0.73);
  else if (ageHours < 72) contribution = Math.round(weight * 0.47);
  else if (ageHours < 24 * 7) contribution = Math.round(weight * 0.27);
  else contribution = Math.round(weight * 0.13);

  return [
    {
      name: 'recency',
      contribution,
      value: Math.round(ageHours * 10) / 10,
      explanation: `Opportunity detected ${Math.round(ageHours)}h ago; newer opportunities receive operational priority (${contribution}/${weight} points).`,
    },
  ];
}

function recoverabilityFactor(features: DecisionFeatures, weight: number): DecisionFactor[] {
  switch (features.failureCategory) {
    case 'TRANSIENT':
      return [
        {
          name: 'recoverability',
          contribution: weight,
          value: features.failureCategory,
          explanation: `Transient-style failure classes are typically retryable: full ${weight} points.`,
        },
      ];
    case 'UNKNOWN':
      return [
        {
          name: 'recoverability',
          contribution: Math.round(weight * 0.48),
          value: features.failureCategory,
          explanation: `Failure category is unknown, so recoverability is scored conservatively at midpoint-below (${Math.round(weight * 0.48)}/${weight} points).`,
        },
      ];
    case 'INSUFFICIENT_FUNDS':
      return [
        {
          name: 'recoverability',
          contribution: Math.round(weight * 0.4),
          value: features.failureCategory,
          explanation: `Insufficient funds may resolve once the customer has funds available, but timing is uncertain (${Math.round(weight * 0.4)}/${weight} points).`,
        },
      ];
    case 'AUTHENTICATION':
      return [
        {
          name: 'recoverability',
          contribution: Math.round(weight * 0.32),
          value: features.failureCategory,
          explanation: `Authentication failures require customer verification before any retry can succeed (${Math.round(weight * 0.32)}/${weight} points).`,
        },
      ];
    case 'HARD_DECLINE':
      return [
        {
          name: 'recoverability',
          contribution: 0,
          value: features.failureCategory,
          explanation: 'Hard-decline conditions (blocked/stolen/fraud-flagged instruments) must not be retried: 0 points.',
        },
      ];
  }
}

function retryHistoryFactor(features: DecisionFeatures, weight: number): DecisionFactor[] {
  const retries = features.observedFailedRetries;
  let contribution: number;
  if (retries === 0) contribution = weight;
  else if (retries <= 1) contribution = Math.round(weight * 0.8);
  else if (retries <= 3) contribution = Math.round(weight * 0.47);
  else contribution = Math.round(weight * 0.2);

  return [
    {
      name: 'retryHistory',
      contribution,
      value: retries,
      explanation:
        retries === 0
          ? `No further failed attempts observed after the source failure: full ${weight} points.`
          : `${retries} failed retr${retries === 1 ? 'y' : 'ies'} already observed; each additional failure lowers the expected value of another immediate attempt (${contribution}/${weight} points).`,
    },
  ];
}

function historicalSupportFactor(features: DecisionFeatures, weight: number): DecisionFactor[] {
  const stats = features.historicalOutcomes;
  if (stats === null || stats.sampleSize < MIN_HISTORICAL_SAMPLE) {
    return [
      {
        name: 'historicalSupport',
        contribution: 0,
        value: stats?.sampleSize ?? null,
        explanation: `Insufficient historical data (${stats?.sampleSize ?? 0} samples, ${MIN_HISTORICAL_SAMPLE} required): factor unavailable and scored 0 rather than inventing a recovery rate.`,
      },
    ];
  }

  const rate = stats.recoveredCount / stats.sampleSize;
  const contribution = Math.min(weight, Math.round(weight * rate));
  return [
    {
      name: 'historicalSupport',
      contribution,
      value: Math.round(rate * 1000) / 1000,
      explanation: `Historical recovery rate for this opportunity type is ${(rate * 100).toFixed(1)}% over ${stats.sampleSize} outcomes: ${contribution}/${weight} points.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Confidence (evidence quality — NOT success probability)
// ---------------------------------------------------------------------------

function computeConfidence(features: DecisionFeatures): number {
  let confidence = 30;

  if (features.failureCode !== null && features.failureCategory !== 'UNKNOWN') {
    confidence += 25;
  } else if (features.failureCode !== null) {
    confidence += 8; // code present but unmapped
  } else {
    confidence += 5; // no code at all
  }

  const sampleSize = features.historicalOutcomes?.sampleSize ?? 0;
  if (sampleSize >= 100) confidence += 25;
  else if (sampleSize >= MIN_HISTORICAL_SAMPLE) confidence += 15;
  else if (sampleSize > 0) confidence += 5;

  if (features.observedFailedRetries > 0 || features.lastFailedRetryAt !== null) {
    confidence += 10; // actual post-detection behavior was observed
  }

  return clamp(confidence, 0, 100);
}

// ---------------------------------------------------------------------------
// Risk flags
// ---------------------------------------------------------------------------

function buildRiskFlags(features: DecisionFeatures): DecisionRiskFlagDetail[] {
  const flags: DecisionRiskFlagDetail[] = [];

  if (features.failureCategory === 'HARD_DECLINE') {
    flags.push({
      flag: 'NON_RECOVERABLE_CONDITION',
      explanation: `Failure code "${features.failureCode ?? ''}" matches a hard-decline condition; automated retry would be inappropriate.`,
    });
  }
  if (features.failureCode === null || features.failureCode.trim() === '') {
    flags.push({
      flag: 'MISSING_FAILURE_CODE',
      explanation: 'The opportunity evidence carries no provider failure code, limiting classification accuracy.',
    });
  }
  const sampleSize = features.historicalOutcomes?.sampleSize ?? 0;
  if (features.historicalOutcomes === null || sampleSize < MIN_HISTORICAL_SAMPLE) {
    flags.push({
      flag: 'INSUFFICIENT_HISTORICAL_DATA',
      explanation: `Only ${sampleSize} historical outcome${sampleSize === 1 ? '' : 's'} available for this opportunity type; recovery-rate statistics are withheld.`,
    });
  }
  if (features.observedFailedRetries >= HIGH_RETRY_THRESHOLD) {
    flags.push({
      flag: 'HIGH_RETRY_COUNT',
      explanation: `${features.observedFailedRetries} failed attempts already observed; further aggressive retrying risks customer harm and issuer blocking.`,
    });
  }
  if (
    features.failureCategory === 'UNKNOWN' &&
    features.failureCode !== null &&
    features.failureCode.trim() !== ''
  ) {
    flags.push({
      flag: 'CONFLICTING_EVIDENCE',
      explanation: `Failure code "${features.failureCode}" is present but unmapped, so signals about recoverability conflict.`,
    });
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Recommendation (ordered rules — first match wins)
// ---------------------------------------------------------------------------

function selectAction(features: DecisionFeatures, confidence: number): RecommendedAction {
  // Rule order is part of the documented v1 policy — first match wins:
  if (features.opportunityStatus !== 'OPEN') {
    return 'NO_ACTION';
  }

  const category = features.failureCategory;

  if (category === 'HARD_DECLINE') {
    return 'DO_NOT_RETRY';
  }
  if (category === 'AUTHENTICATION' || category === 'INSUFFICIENT_FUNDS') {
    return 'CUSTOMER_ACTION_REQUIRED';
  }

  if (features.observedFailedRetries >= 2 && minutesSinceLastRetry(features) <= RECENT_RETRY_WINDOW_MINUTES) {
    return 'WAIT';
  }

  if (confidence <= LOW_CONFIDENCE_THRESHOLD || category === 'UNKNOWN') {
    return 'REVIEW';
  }

  if (features.observedFailedRetries >= HIGH_RETRY_THRESHOLD) {
    return 'REVIEW';
  }

  return 'RETRY';
}

/** Minutes between the last observed failed retry and the evaluation instant. */
function minutesSinceLastRetry(features: DecisionFeatures): number {
  if (features.lastFailedRetryAt === null) {
    return Number.POSITIVE_INFINITY;
  }
  return (features.evaluatedAtMs - features.lastFailedRetryAt.getTime()) / (60 * 1000);
}

// ---------------------------------------------------------------------------
// Priority bands & helpers
// ---------------------------------------------------------------------------

export function priorityForScore(score: number): RecoveryDecisionResult['priority'] {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  if (score >= 20) return 'LOW';
  return 'VERY_LOW';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildReasons(
  features: DecisionFeatures,
  factors: readonly DecisionFactor[],
  riskFlags: readonly DecisionRiskFlagDetail[],
  action: RecommendedAction
): string[] {
  const reasons: string[] = [actionRationale(features, action)];

  for (const factor of factors) {
    if (factor.contribution > 0) {
      reasons.push(factor.explanation);
    } else if (factor.name === 'historicalSupport') {
      reasons.push('Historical outcome data is insufficient to adjust priority.');
    }
  }

  if (features.observedFailedRetries === 0) {
    reasons.push('Only one failure has occurred so far — no aggressive retry pattern detected.');
  }

  for (const flag of riskFlags) {
    reasons.push(flag.explanation);
  }

  return reasons;
}

function actionRationale(features: DecisionFeatures, action: RecommendedAction): string {
  switch (action) {
    case 'RETRY':
      return 'Recommendation: RETRY — the failure class looks retryable and no safety rule blocks another attempt.';
    case 'WAIT':
      return `Recommendation: WAIT — ${features.observedFailedRetries} failed attempts occurred with the latest only ${Math.round(minutesSinceLastRetry(features))} minute(s) before evaluation; backing off is safer than an immediate retry.`;
    case 'CUSTOMER_ACTION_REQUIRED':
      return 'Recommendation: CUSTOMER_ACTION_REQUIRED — evidence indicates the customer must resolve something (funds or verification) before payment can succeed.';
    case 'DO_NOT_RETRY':
      return 'Recommendation: DO_NOT_RETRY — the failure condition is explicitly classified as inappropriate to retry.';
    case 'REVIEW':
      return 'Recommendation: REVIEW — available signals are too weak or conflicting for a safe automated recommendation.';
    case 'NO_ACTION':
      return 'Recommendation: NO_ACTION — the opportunity lifecycle has closed; nothing further should be attempted.';
  }
}
