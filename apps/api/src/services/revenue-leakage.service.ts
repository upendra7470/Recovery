import type { PaymentEventRow, PaymentEventStore } from '../domain/payment-event.js';
import type { DetectionWindowConfig } from '../detection/detection-rule.js';
import { toEventView } from '../detection/event-view.js';
import type { RevenueLeakageDetector } from '../detection/revenue-leakage.detector.js';
import type { RecoveryOpportunityRepository } from '../repositories/recovery-opportunity.repository.js';

/** Providers whose events the Phase 3 engine understands. */
const SUPPORTED_PROVIDERS = ['razorpay'] as const;

export type LeakageOutcomeKind =
  | 'opportunity-created'
  | 'opportunity-recovered'
  | 'no-action'
  | 'skipped';

export interface LeakageProcessingOutcome {
  sourceEventId: string;
  outcome: LeakageOutcomeKind;
  opportunityIds: string[];
}

/**
 * Deterministic revenue leakage orchestration.
 *
 * Operates on PERSISTED payment events only (the webhook layer owns ingestion):
 *   event → correlate related events within the detection window →
 *   run detection rules → persist opportunities idempotently
 *
 * Captured payments resolve open opportunities as RECOVERED — but only with a
 * real capturing payment event as evidence. No LLM, heuristics or estimates
 * participate anywhere in this pipeline.
 */
export class RevenueLeakageService {
  constructor(
    private readonly detector: RevenueLeakageDetector,
    private readonly opportunities: RecoveryOpportunityRepository,
    private readonly paymentEvents: PaymentEventStore,
    private readonly config: DetectionWindowConfig
  ) {}

  /** Batch entry point: process many persisted events in order. */
  async processPaymentEvents(events: readonly PaymentEventRow[]): Promise<LeakageProcessingOutcome[]> {
    const outcomes: LeakageProcessingOutcome[] = [];
    for (const event of events) {
      outcomes.push(await this.processPaymentEvent(event));
    }
    return outcomes;
  }

  async processPaymentEvent(event: PaymentEventRow): Promise<LeakageProcessingOutcome> {
    if (!includesProvider(SUPPORTED_PROVIDERS, event.provider)) {
      return { sourceEventId: event.id, outcome: 'skipped', opportunityIds: [] };
    }

    switch (event.eventType) {
      case 'payment.failed':
      case 'payment.authorized':
        return this.detectForEvent(event);
      case 'payment.captured':
        return this.resolveRecoveries(event);
      default:
        return { sourceEventId: event.id, outcome: 'skipped', opportunityIds: [] };
    }
  }

  private async detectForEvent(event: PaymentEventRow): Promise<LeakageProcessingOutcome> {
    const view = toEventView(event);
    const relatedEvents =
      view.providerPaymentId === null && view.providerOrderId === null
        ? []
        : await this.paymentEvents.findRelatedByOrderOrPayment({
            providerPaymentId: view.providerPaymentId,
            providerOrderId: view.providerOrderId,
            occurredAfter: new Date(view.occurredAt.getTime() - this.config.windowMs),
            occurredBefore: new Date(view.occurredAt.getTime() + this.config.windowMs),
          });

    const findings = this.detector.evaluate({ event, relatedEvents, config: this.config });
    if (findings.length === 0) {
      return { sourceEventId: event.id, outcome: 'no-action', opportunityIds: [] };
    }

    const opportunityIds: string[] = [];
    let createdAny = false;
    for (const finding of findings) {
      // Idempotency first: an opportunity for this (event, category) already
      // exists regardless of how many times the webhook was redelivered.
      const existing = await this.opportunities.findBySourceEventAndType(
        event.id,
        finding.type
      );
      if (existing !== null) {
        opportunityIds.push(existing.id);
        continue;
      }
      const created = await this.opportunities.createFromFinding({
        finding,
        sourceEvent: event,
        detectedAt: new Date(),
      });
      opportunityIds.push(created.opportunity.id);
      createdAny = createdAny || created.isNew;
    }

    return {
      sourceEventId: event.id,
      outcome: createdAny ? 'opportunity-created' : 'no-action',
      opportunityIds,
    };
  }

  private async resolveRecoveries(event: PaymentEventRow): Promise<LeakageProcessingOutcome> {
    const view = toEventView(event);
    if (view.providerPaymentId === null && view.providerOrderId === null) {
      return { sourceEventId: event.id, outcome: 'skipped', opportunityIds: [] };
    }

    const candidates = await this.opportunities.findOpenByPaymentCorrelation({
      providerPaymentId: view.providerPaymentId,
      providerOrderId: view.providerOrderId,
    });

    // Tenant isolation: a captured event may only resolve opportunities that
    // belong to the SAME merchant (strict equality, including null == null).
    const recoveredIds: string[] = [];
    for (const candidate of candidates) {
      if (candidate.merchantId !== event.merchantId) {
        continue;
      }
      await this.opportunities.markRecovered({
        id: candidate.id,
        recoveryEventId: event.id,
        resolvedAt: new Date(),
      });
      recoveredIds.push(candidate.id);
    }

    return recoveredIds.length > 0
      ? { sourceEventId: event.id, outcome: 'opportunity-recovered', opportunityIds: recoveredIds }
      : { sourceEventId: event.id, outcome: 'no-action', opportunityIds: [] };
  }
}

function includesProvider(
  supported: readonly string[],
  provider: PaymentEventRow['provider']
): boolean {
  return supported.some((candidate) => candidate === provider);
}
