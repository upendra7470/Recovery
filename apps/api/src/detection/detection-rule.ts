import type { PaymentEventRow } from '../domain/payment-event.js';
import type { OpportunityEvidence, RecoveryOpportunityType } from '../domain/recovery-opportunity.js';
import { toEventView, type PaymentEventView } from './event-view.js';

/** How far the engine looks for correlated events (successes/failures). */
export interface DetectionWindowConfig {
  readonly windowMs: number;
}

export interface DetectionContext {
  /** The newly ingested event being evaluated. */
  readonly event: PaymentEventRow;
  /** Events correlated to the same payment/order within the detection window. */
  readonly relatedEvents: readonly PaymentEventRow[];
  readonly config: DetectionWindowConfig;
}

/** A positive detection outcome produced by exactly one rule. */
export interface DetectionFinding {
  readonly type: RecoveryOpportunityType;
  readonly reason: string;
  readonly evidence: OpportunityEvidence;
  readonly expiresAt: Date | null;
}

/**
 * A deterministic, side-effect-free leakage rule. Given the same context it
 * must always return the same finding (or null); all persistence happens in
 * the service layer, never inside rules.
 */
export interface DetectionRule {
  readonly type: RecoveryOpportunityType;
  evaluate(context: DetectionContext): DetectionFinding | null;
}

/** True when a captured (successful) payment exists for the same order or payment id. */
export function hasCapturedPayment(
  view: PaymentEventView,
  relatedEvents: readonly PaymentEventRow[]
): boolean {
  return matchesRelated(view, relatedEvents, 'payment.captured');
}

/** True when an explicitly failed payment exists for the same order or payment id. */
export function hasFailedPayment(
  view: PaymentEventView,
  relatedEvents: readonly PaymentEventRow[]
): boolean {
  return matchesRelated(view, relatedEvents, 'payment.failed');
}

function matchesRelated(
  view: PaymentEventView,
  relatedEvents: readonly PaymentEventRow[],
  eventType: string
): boolean {
  return relatedEvents.some((row) => {
    const candidate = toEventView(row);
    if (candidate.eventType !== eventType) {
      return false;
    }
    if (view.providerOrderId !== null && candidate.providerOrderId === view.providerOrderId) {
      return true;
    }
    return view.providerPaymentId !== null && candidate.providerPaymentId === view.providerPaymentId;
  });
}

export function buildEvidence(
  view: PaymentEventView,
  amount: number,
  currency: string
): OpportunityEvidence {
  return {
    sourceEventId: view.id,
    providerPaymentId: view.providerPaymentId,
    providerOrderId: view.providerOrderId,
    eventType: view.eventType,
    amount,
    currency,
    occurredAt: view.occurredAt.toISOString(),
    failureCode: view.errorCode ?? null,
  };
}
