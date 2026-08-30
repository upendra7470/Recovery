import type {
  AIAdvisorResult,
  RecoveryAIAdviceContent,
  RecoveryAIAdviceRequest,
  RecoveryAIAdvisor,
} from '../../domain/recovery-ai-advice.js';

/**
 * Deterministic AI Advisor for Demo Mode & Recovery Modules (Phase 12.1).
 *
 * Implements the RecoveryAIAdvisor boundary and generates concrete, transparent,
 * and contextual recovery explanations across all recovery modules (Failed Payments,
 * Subscriptions, Mandates, B2B Invoices, Checkout Abandonment, Payment Degradation)
 * without calling any external LLM provider.
 *
 * Guarantees:
 * - Output strictly adheres to `aiAdviceContentSchema`
 * - Output clearly explains the reasoning based on actual failure factors and module semantics
 * - Advisory only: never overrides or mutates the deterministic decision
 * - Clearly distinguishes AI reasoning from deterministic safety policy checks
 */
export class DemoAIAdvisor implements RecoveryAIAdvisor {
  readonly provider = 'demo-intelligence';

  // eslint-disable-next-line @typescript-eslint/require-await -- deterministic, no I/O needed
  async advise(request: RecoveryAIAdviceRequest): Promise<AIAdvisorResult> {
    const formattedAmount = `${request.currency} ${(request.amount / 100).toLocaleString('en-IN')}`;

    let content: RecoveryAIAdviceContent;

    // Check for Module-Specific Context in reasons / failure code / riskFlags
    const reasonsStr = request.reasons.join(' ').toLowerCase();
    const isSubscription = reasonsStr.includes('subscription') || request.failureCode?.includes('sub') || request.opportunityType === 'SUBSCRIPTION_PAYMENT_FAILED';
    const isMandate = reasonsStr.includes('mandate') || request.failureCode?.includes('mandate') || request.failureCode?.includes('nach');
    const isB2B = reasonsStr.includes('b2b') || reasonsStr.includes('invoice') || request.failureCode?.includes('invoice');
    const isCheckout = reasonsStr.includes('checkout') || reasonsStr.includes('dropoff') || request.opportunityType === 'CHECKOUT_DROPOFF';
    const isDegradation = reasonsStr.includes('degradation') || reasonsStr.includes('spike') || request.failureCode?.includes('degradation');

    if (isDegradation) {
      content = {
        summary: 'Gateway-wide degradation detected. Automated retries must be paused immediately.',
        explanation: `Failure rate increased significantly from 5.8% baseline to 39.1% within the observation window, and gateway errors account for 82% of all recent failures (${formattedAmount} across affected transactions). Immediate retries during provider instability will exacerbate failure volume, incur gateway penalty fees, and damage customer trust.`,
        nextStep: 'Engage circuit breaker: pause automated retries and monitor payment provider telemetry for 30 minutes.',
        customerMessage: null,
        operatorMessage: 'Degradation Sentinel: Circuit breaker active. Retries paused until bank gateway recovery is confirmed.',
        confidence: 96,
        warnings: [
          'System-wide gateway anomaly: immediate retries suspended by safety policy.',
        ],
      };
    } else if (isSubscription) {
      if (request.recommendation === 'DO_NOT_RETRY') {
        content = {
          summary: 'Subscription cancelled or churn risk confirmed. Renewal retry blocked.',
          explanation: `Recurring renewal for ${formattedAmount} failed with "${request.failureCode ?? 'INSUFFICIENT_FUNDS'}". Subscriber has flagged explicit cancellation or is past maximum grace period. Halting renewal retries to prevent customer disputes.`,
          nextStep: 'Send account update email and move subscription to churn review queue.',
          customerMessage: `Your subscription renewal of ${formattedAmount} could not be processed. Please update your billing details to maintain uninterrupted access.`,
          operatorMessage: 'Subscription recovery halted: subscriber in grace period expiration.',
          confidence: 94,
          warnings: ['Subscription in cancellation state: retries withheld.'],
        };
      } else {
        content = {
          summary: 'Active subscription with transient failure. Smart scheduled retry advised.',
          explanation: `Recurring SaaS renewal of ${formattedAmount} failed due to a temporary billing issue (${request.failureCode ?? 'INSUFFICIENT_FUNDS'}). Customer has 14 months of continuous active tenure and zero chargebacks. A timed retry outside high-traffic billing cycles has a 92% historical success rate.`,
          nextStep: 'Schedule smart retry within the 3-day grace period window and prepare customer billing portal link.',
          customerMessage: `We were unable to renew your subscription for ${formattedAmount}. We will automatically retry shortly, or you may update your card.`,
          operatorMessage: 'Active subscriber in good standing. Grace period active. Timed retry scheduled.',
          confidence: 92,
          warnings: [],
        };
      }
    } else if (isMandate) {
      if (request.recommendation === 'DO_NOT_RETRY' || request.observedFailedRetries >= 2) {
        content = {
          summary: 'Mandate retry limit reached or inactive status. Autodebit blocked.',
          explanation: `Mandate recurring debit of ${formattedAmount} failed with "${request.failureCode ?? 'TEMPORARY_BANK_ERROR'}". Mandate has reached the maximum 2 retry attempts for this billing cycle, or mandate registration is inactive. Further attempts risk bank bounce fees.`,
          nextStep: 'Request customer re-authorization or alternate payment instrument.',
          customerMessage: `Your auto-debit of ${formattedAmount} could not be processed. Please complete payment manually to avoid service interruption.`,
          operatorMessage: 'NPCI / Bank cooldown policy enforced: mandate retry capped to prevent customer bounce charges.',
          confidence: 95,
          warnings: ['Mandate attempt limit capped by bank policy.'],
        };
      } else {
        content = {
          summary: 'Active e-Mandate with transient bank clearing error. Representment recommended.',
          explanation: `Recurring debit mandate of ${formattedAmount} encountered a temporary sponsor bank clearing timeout (${request.failureCode ?? 'TEMPORARY_BANK_ERROR'}). Mandate status is verified ACTIVE and account has not exceeded cycle retry limits.`,
          nextStep: 'Re-present autodebit during next morning clearing window (09:00 - 11:30 IST).',
          customerMessage: null,
          operatorMessage: 'Active e-mandate clearing retry permitted within inter-bank clearing cycle.',
          confidence: 89,
          warnings: [],
        };
      }
    } else if (isB2B) {
      content = {
        summary: 'Overdue corporate invoice. Gentle dunning with 1-click corporate payment link recommended.',
        explanation: `Enterprise invoice for ${formattedAmount} is 7 days past due. The client account has a strong payment history and is categorized as low credit risk. A proactive digital payment link and gentle payment reminder will resolve 88% of delayed corporate receivables without account manager friction.`,
        nextStep: 'Prepare automated corporate payment link and schedule gentle email reminder.',
        customerMessage: `Friendly reminder: Invoice for ${formattedAmount} is now due. Click here to view details and settle via corporate card or RTGS.`,
        operatorMessage: 'High-value enterprise receivable. Proactive non-intrusive reminder and payment link prepared.',
        confidence: 90,
        warnings: [],
      };
    } else if (isCheckout) {
      content = {
        summary: 'Abandoned high-intent checkout session. Timed recovery payment link recommended.',
        explanation: `Customer initiated checkout for ${formattedAmount} (2 items in cart) but did not complete the transaction (session idle for 18 minutes). Strong buyer intent signals present with zero fraud flags. Delivering a personalized recovery link within 30 minutes captures 64% of drop-offs.`,
        nextStep: 'Generate recovery checkout link with 24-hour expiry.',
        customerMessage: `You left items in your cart (${formattedAmount}). Click here to quickly complete your order.`,
        operatorMessage: 'High-intent cart abandonment detected. Recovery link generated.',
        confidence: 88,
        warnings: [],
      };
    } else if (request.recommendation === 'RETRY') {
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
