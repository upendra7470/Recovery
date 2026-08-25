import type {
  DetectionContext,
  DetectionFinding,
  DetectionRule,
} from './detection-rule.js';
import { CheckoutDropoffRule } from './rules/checkout-dropoff.rule.js';
import { FailedPaymentRule } from './rules/failed-payment.rule.js';
import { SubscriptionPaymentFailedRule } from './rules/subscription-payment-failed.rule.js';

/**
 * Deterministic revenue leakage detector. Runs every registered rule over the
 * detection context and collects their findings. Pure: no I/O, no clock reads
 * (time comes from the context/config), so identical input always yields an
 * identical result.
 */
export class RevenueLeakageDetector {
  constructor(private readonly rules: readonly DetectionRule[]) {}

  evaluate(context: DetectionContext): DetectionFinding[] {
    const findings: DetectionFinding[] = [];
    for (const rule of this.rules) {
      const finding = rule.evaluate(context);
      if (finding !== null) {
        findings.push(finding);
      }
    }
    return findings;
  }
}

/** The Phase 3 rule set. Rules are mutually exclusive per event type. */
export function createDefaultDetectionRules(): readonly DetectionRule[] {
  return [
    new SubscriptionPaymentFailedRule(),
    new FailedPaymentRule(),
    new CheckoutDropoffRule(),
  ];
}
