import type { DetectionContext, DetectionFinding, DetectionRule } from '../detection-rule.js';
import { buildEvidence, hasCapturedPayment, hasFailedPayment } from '../detection-rule.js';
import { toEventView } from '../event-view.js';

/**
 * CHECKOUT_DROPOFF: a payment.authorized event that is never captured and
 * never explicitly fails within the detection window. The authorization hold
 * eventually lapses without revenue being realized.
 *
 * This is deliberately conservative: an authorized payment whose capture
 * arrives later, or which produces an explicit failure event, is NOT treated
 * as drop-off (the completed capture resolves the opportunity; the failure
 * event is owned by the failed-payment rules). Events missing amount,
 * currency or payment id are skipped.
 */
export class CheckoutDropoffRule implements DetectionRule {
  readonly type = 'CHECKOUT_DROPOFF' as const;

  evaluate(context: DetectionContext): DetectionFinding | null {
    const view = toEventView(context.event);

    if (view.eventType !== 'payment.authorized') {
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
    if (
      hasCapturedPayment(view, context.relatedEvents) ||
      hasFailedPayment(view, context.relatedEvents)
    ) {
      return null;
    }

    return {
      type: this.type,
      reason:
        'Payment was authorized but neither captured nor declined within the detection window.',
      evidence: buildEvidence(view, view.amount, view.currency),
      expiresAt: new Date(view.occurredAt.getTime() + context.config.windowMs),
    };
  }
}
