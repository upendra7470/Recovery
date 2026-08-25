import type { DetectionContext, DetectionFinding, DetectionRule } from '../detection-rule.js';
import { buildEvidence, hasCapturedPayment } from '../detection-rule.js';
import { toEventView } from '../event-view.js';

/**
 * SUBSCRIPTION_PAYMENT_FAILED: a payment.failed event carrying a provider
 * subscription identifier (recurring context) with no captured payment for
 * the same order or payment id within the detection window.
 *
 * The subscription identifier comes straight from the Razorpay payment entity
 * (`subscription_id`); it is never inferred from amounts, descriptions or
 * heuristics. Payments without that field are handled by FailedPaymentRule.
 */
export class SubscriptionPaymentFailedRule implements DetectionRule {
  readonly type = 'SUBSCRIPTION_PAYMENT_FAILED' as const;

  evaluate(context: DetectionContext): DetectionFinding | null {
    const view = toEventView(context.event);

    if (view.eventType !== 'payment.failed' || view.subscriptionId === null) {
      // No subscription context in the stored event data: not this rule's case.
      return null;
    }
    if (
      view.providerPaymentId === null ||
      view.amount === null ||
      view.amount <= 0 ||
      view.currency === null
    ) {
      return null;
    }
    if (hasCapturedPayment(view, context.relatedEvents)) {
      return null;
    }

    return {
      type: this.type,
      reason:
        'A recurring (subscription) payment failed and no successful payment was observed within the detection window.',
      evidence: buildEvidence(view, view.amount, view.currency),
      expiresAt: null,
    };
  }
}
