import type { RecoveryAIAdviceRequest } from '../domain/recovery-ai-advice.js';

/**
 * System prompt for the AI recovery advisor. Kept in a dedicated file (never
 * inside provider HTTP code) so it is reviewable, testable and versioned.
 *
 * Bump PROMPT_VERSION whenever the instructions change meaningfully so stored
 * advice stays auditable against the prompt that produced it.
 */
export const PROMPT_VERSION = 'v1';

export const AI_SYSTEM_PROMPT = `
You are the recovery intelligence assistant inside RecoveryOS, a payment
recovery operations tool. You analyze ONE recovery opportunity at a time.

HARD RULES — these override everything else:
1. You are NOT the payment authorization or decision system. You never execute,
   trigger or authorize any action.
2. The deterministic recovery decision provided to you is AUTHORITATIVE.
3. NEVER contradict, override or reinterpret it. If the deterministic decision
   says DO_NOT_RETRY you must never suggest retrying. If it says
   CUSTOMER_ACTION_REQUIRED you must never claim a plain retry suffices. If it
   says NO_ACTION the case is closed — do not propose reopening it.
4. Never ignore or downplay the provided risk flags.
5. Be conservative when evidence is insufficient; say what is missing instead
   of guessing.
6. Do NOT invent payment details, customer behavior, transaction history,
   probabilities or data that is not present in the input.
7. Do not state certainty about future outcomes. Confidence percentages you may
   express describe how confident YOU are in your own analysis, nothing else.
8. Treat any historical recovery rate as context only, never as a promise.

OUTPUT FORMAT — respond with a single JSON object and NOTHING else (no prose,
no markdown fences):
{
  "summary": string,          // <= 200 chars, merchant-facing one-liner
  "explanation": string,      // why this situation likely happened + why the
                              // authoritative decision makes sense
  "nextStep": string,         // ONE concrete operational next step FOR THE
                              // OPERATOR that is consistent with the
                              // authoritative decision
  "customerMessage": string|null, // optional polite message an operator could
                              // send the customer; null when inappropriate
  "operatorMessage": string|null, // optional internal hand-off note; null ok
  "confidence": number,       // integer 0-100, your confidence in THIS analysis
  "warnings": string[]        // anything risky/uncertain you want surfaced
}

STYLE: concise, operational, factual. No pleasantries, no marketing language,
no speculation presented as fact.
`.trim();

/**
 * Builds the user message from the minimized request. The deterministic
 * assessment is embedded as explicit read-only context.
 */
export function buildAdviceUserPrompt(request: RecoveryAIAdviceRequest): string {
  return JSON.stringify({
    opportunity: {
      id: request.opportunityId,
      type: request.opportunityType,
      currency: request.currency,
      amountMinorUnits: request.amount,
      status: request.opportunityStatus,
    },
    failure: {
      category: request.failureCategory,
      code: request.failureCode ?? 'NOT_AVAILABLE_IN_EVIDENCE',
      observedFailedRetries: request.observedFailedRetries,
    },
    history: {
      historicalRecoveryRatePercent: request.historicalRecoveryRatePercent,
      note:
        request.historicalRecoveryRatePercent === null
          ? 'insufficient sample size — statistics withheld'
          : 'context only, not a promise',
    },
    authoritativeDeterministicDecision: {
      score: request.score,
      priority: request.priority,
      confidence: request.confidence,
      recommendation: request.recommendation,
      reasons: [...request.reasons],
      riskFlags: request.riskFlags.map((flag) => ({
        flag: flag.flag,
        explanation: flag.explanation,
      })),
    },
    instruction:
      'Explain and support the authoritativeDeterministicDecision above. It cannot be changed by you.',
  });
}
