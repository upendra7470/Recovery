import type {
  AIAdvisorResult,
  RecoveryAIAdviceContent,
  RecoveryAIAdviceRequest,
  RecoveryAIAdvisor,
} from '../../domain/recovery-ai-advice.js';

/**
 * Deterministic AI Advisor for Demo Mode (Phase 11.2).
 *
 * Implements the RecoveryAIAdvisor boundary and generates concrete, transparent,
 * and contextual recovery explanations for synthetic demo scenarios without
 * calling any external LLM provider.
 *
 * Guarantees:
 * - Output strictly adheres to `aiAdviceContentSchema`
 * - Output clearly explains the reasoning based on actual failure factors
 * - Advisory only: never overrides or mutates the deterministic decision
 * - Clearly distinguishes AI reasoning from deterministic safety policy checks
 */
export class DemoAIAdvisor implements RecoveryAIAdvisor {
  readonly provider = 'demo-intelligence';

  // eslint-disable-next-line @typescript-eslint/require-await -- deterministic, no I/O needed
  async advise(request: RecoveryAIAdviceRequest): Promise<AIAdvisorResult> {
    const formattedAmount = `${request.currency} ${(request.amount / 100).toLocaleString('en-IN')}`;

    let content: RecoveryAIAdviceContent;

    if (request.recommendation === 'RETRY') {
      content = {
        summary: 'Transient gateway decline indicates strong recovery potential via retry.',
        explanation: `Payment of ${formattedAmount} failed due to a transient bank authorization error (${request.failureCode ?? 'GATEWAY_ERROR'}). Customer transaction history shows zero chargebacks or fraud indicators, and retry count (${request.observedFailedRetries}) is well below policy cap. Historical recovery for temporary banking declines exceeds 85%.`,
        nextStep: 'Initiate automated payment retry within the exponential backoff window.',
        customerMessage: `Your payment of ${formattedAmount} was temporarily interrupted by your bank. We are automatically securing your checkout.`,
        operatorMessage: 'Transient bank decline on card checkout. Merchant safety policy allows 1 retry. Execution approved.',
        confidence: 91,
        warnings: [],
      };
    } else if (request.recommendation === 'DO_NOT_RETRY') {
      content = {
        summary: 'Permanent instrument decline detected. Automated retry is blocked by safety policy.',
        explanation: `Payment method failed with "${request.failureCode ?? 'expired_card'}", indicating a permanent instrument failure. Retrying an expired card has 0% chance of success, risks incurring gateway penalty fees, and degrades customer experience. Deterministic safety policy firmly blocks execution.`,
        nextStep: 'Notify customer to update their payment instrument or supply an alternate payment method.',
        customerMessage: `Your payment card has expired. Please update your payment method to complete your ${formattedAmount} purchase.`,
        operatorMessage: 'Safety gate engaged: DO_NOT_RETRY enforced to protect merchant reputation and prevent gateway decline penalties.',
        confidence: 96,
        warnings: [
          'Permanent instrument failure: automated retries strictly prohibited by safety policy.',
        ],
      };
    } else if (request.recommendation === 'REVIEW') {
      content = {
        summary: 'Ambiguous gateway response requires operator review before recovery action.',
        explanation: `Failure code "${request.failureCode ?? 'UNKNOWN_ERROR'}" provides ambiguous telemetry regarding transaction status. AI confidence score (${request.confidence}%) is below the automated recovery threshold (60%). Automated retry is withheld to eliminate double-billing risks.`,
        nextStep: 'Operator must verify charge state in payment gateway dashboard or await webhook confirmation.',
        customerMessage: null,
        operatorMessage: `Decision confidence (${request.confidence}%) is below automated threshold (60%). Flagged for operator review to avoid duplicate debits.`,
        confidence: 45,
        warnings: [
          'Ambiguous provider error code: manual verification required to avoid double billing.',
        ],
      };
    } else {
      content = {
        summary: `Deterministic policy produced recommendation: ${request.recommendation}.`,
        explanation: `The recovery opportunity was analyzed with a score of ${request.score}/100 and confidence of ${request.confidence}%. Action ${request.recommendation} is advised based on failure classification "${request.failureCategory}".`,
        nextStep: 'Follow merchant operational guidelines for this opportunity status.',
        customerMessage: null,
        operatorMessage: `Recovery assessment completed with priority ${request.priority}.`,
        confidence: request.confidence,
        warnings: [],
      };
    }

    return {
      status: 'available',
      content,
    };
  }
}
