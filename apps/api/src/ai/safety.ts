import type {
  RecoveryAIAdviceContent,
  RecoveryAIAdviceRequest,
} from '../domain/recovery-ai-advice.js';

/**
 * Deterministic post-processing guard between the model and the response.
 *
 * The advice schema has no recommendation/score/priority fields, so the model
 * structurally cannot override the deterministic decision — but free text can
 * still contradict it (e.g. "you should retry now" while the authoritative
 * action is DO_NOT_RETRY). This guard detects such contradictions, appends an
 * explicit warning, and marks the advice as safety-constrained. The
 * deterministic decision itself is never touched.
 */

/** Actions where any retry suggestion in AI text is a safety contradiction. */
const NO_RETRY_ACTIONS = new Set(['DO_NOT_RETRY', 'NO_ACTION']);

export interface GuardedAdvice {
  content: RecoveryAIAdviceContent;
  safetyConstrained: boolean;
}

export function constrainAdvice(args: {
  content: RecoveryAIAdviceContent;
  /** The authoritative deterministic assessment the advice must respect. */
  decision: Pick<
    RecoveryAIAdviceRequest,
    'recommendation' | 'riskFlags' | 'failureCode' | 'confidence'
  >;
}): GuardedAdvice {
  const { content, decision } = args;

  const warnings = [...content.warnings];
  let safetyConstrained = false;

  const retryText = scanForRetrySuggestions(content);
  if (
    retryText !== null &&
    (NO_RETRY_ACTIONS.has(decision.recommendation) ||
      decision.riskFlags.some((flag) => flag.flag === 'NON_RECOVERABLE_CONDITION'))
  ) {
    warnings.push(
      `Safety constraint applied: the AI text suggested retrying (${retryText}) which contradicts the authoritative decision "${decision.recommendation}". The deterministic decision stands.`
    );
    safetyConstrained = true;
  }

  // A missing failure code means the model has no basis for confident claims:
  // force explicit acknowledgment into the persisted warnings trail.
  if (decision.failureCode === null && !warnings.some((w) => /failure code/i.test(w))) {
    warnings.push(
      'Evidence gap: no provider failure code was available for this analysis.'
    );
  }

  return {
    content: { ...content, warnings },
    safetyConstrained,
  };
}

/** Returns the offending snippet when any advice field suggests retrying. */
function scanForRetrySuggestions(content: RecoveryAIAdviceContent): string | null {
  const fields: [string, string | null][] = [
    ['summary', content.summary],
    ['nextStep', content.nextStep],
    ['explanation', content.explanation],
    ['customerMessage', content.customerMessage],
    ['operatorMessage', content.operatorMessage],
  ];
  for (const [field, text] of fields) {
    if (text === null) continue;
    if (/\bretry\b|\bre-?attempt\b|\btry again\b|try paying again/i.test(text)) {
      return `${field}: "${truncate(text, 80)}"`;
    }
  }
  return null;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
