import type { DetectionContext, DetectionFinding, DetectionRule } from '../detection-rule.js';
import { buildEvidence, hasCapturedPayment } from '../detection-rule.js';
import { toEventView } from '../event-view.js';

/**
 * FAILED_PAYMENT: a payment.failed event with a positive amount and no
 * captured (successful) payment observed for the same order or payment id
 * within the detection window.
 *
 * Subscription-based failures are intentionally excluded here — the
 * subscription rule owns them so one event never produces two opportunities.
 * Events missing amount/currency/payment id are skipped safely (never guessed).
 */
export class FailedPaymentRule implements DetectionRule {
  readonly type = 'FAILED_PAYMENT' as const;

  evaluate(context: DetectionContext): DetectionFinding | null {
    const view = toEventView(context.event);

    if (view.eventType !== 'payment.failed' || view.subscriptionId !== null) {
      return null;
    }
    if (
      view.providerPaymentId === null ||
      view.amount === null ||
      view.amount <= 0 ||
      view.currency === null
    ) {
      // Insufficient evidence: skip rather than invent values.
      return null;
    }
    if (hasCapturedPayment(view, context.relatedEvents)) {
      // A successful payment for the same order/payment was observed; the
      // revenue materialized and nothing is at risk from this failure.
      return null;
    }

    return {
      type: this.type,
      reason:
        'Payment failed and no successful payment was observed within the detection window.',
      evidence: buildEvidence(view, view.amount, view.currency),
      expiresAt: null,
    };
  }
}
