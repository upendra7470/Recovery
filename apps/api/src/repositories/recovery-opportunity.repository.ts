import { Prisma } from '@prisma/client';
import type {
  NewRecoveryOpportunityData,
  OpportunityFilters,
  OpportunityStatusSummary,
  RecoveryOpportunityRow,
  RecoveryOpportunityStore,
  RecoveryOpportunityType,
} from '../domain/recovery-opportunity.js';
import type { DetectionFinding } from '../detection/detection-rule.js';
import type { PaymentEventRow } from '../domain/payment-event.js';
import { InternalError } from '../lib/errors.js';

export interface OpportunityCreateResult {
  opportunity: RecoveryOpportunityRow;
  /** true when a new row was created; false when an existing row for the same
   * (source event, type) pair was returned instead. */
  isNew: boolean;
}

/**
 * Persistence facade for recovery opportunities.
 *
 * Idempotency is enforced by the database's unique constraint on
 * (source_event_id, type); unique-violation races resolve by re-reading the
 * winning row. Merchant/account attribution is copied exclusively from the
 * source payment event so tenant isolation can never be bypassed by a rule.
 */
export class RecoveryOpportunityRepository {
  constructor(private readonly store: RecoveryOpportunityStore) {}

  async createFromFinding(args: {
    finding: DetectionFinding;
    sourceEvent: PaymentEventRow;
    detectedAt: Date;
  }): Promise<OpportunityCreateResult> {
    const data = this.toRowData(args);
    try {
      const opportunity = await this.store.insert(data);
      return { opportunity, isNew: true };
    } catch (error) {
      // Concurrent processing of the same event lost the insert race; return
      // the persisted row so callers treat this as an idempotent no-op.
      if (isUniqueConstraintViolation(error)) {
        const existing = await this.store.findBySourceEventAndType(
          data.sourceEventId,
          data.type
        );
        if (existing) {
          return { opportunity: existing, isNew: false };
        }
      }
      throw new InternalError('Failed to persist recovery opportunity.', { cause: error });
    }
  }

  findBySourceEventAndType(
    sourceEventId: string,
    type: RecoveryOpportunityType
  ): Promise<RecoveryOpportunityRow | null> {
    return this.store.findBySourceEventAndType(sourceEventId, type);
  }

  findOpenByPaymentCorrelation(args: {
    providerPaymentId: string | null;
    providerOrderId: string | null;
  }): Promise<RecoveryOpportunityRow[]> {
    return this.store.findOpenByPaymentCorrelation(args);
  }

  findById(id: string): Promise<RecoveryOpportunityRow | null> {
    return this.store.findById(id);
  }

  list(filters: OpportunityFilters): Promise<RecoveryOpportunityRow[]> {
    return this.store.list(filters);
  }

  count(filters: OpportunityFilters): Promise<number> {
    return this.store.count(filters);
  }

  markRecovered(args: {
    id: string;
    recoveryEventId: string;
    resolvedAt: Date;
  }): Promise<RecoveryOpportunityRow> {
    return this.store.markRecovered(args);
  }

  summarizeByStatusAndCurrency(merchantId?: string): Promise<OpportunityStatusSummary[]> {
    return this.store.summarizeByStatusAndCurrency(merchantId);
  }

  countByType(type: RecoveryOpportunityType, merchantId?: string): Promise<number> {
    return this.store.countByType(type, merchantId);
  }

  outcomeStatsByType(type: RecoveryOpportunityType): Promise<{
    total: number;
    recovered: number;
  }> {
    return this.store.outcomeStatsByType(type);
  }

  private toRowData(args: {
    finding: DetectionFinding;
    sourceEvent: PaymentEventRow;
    detectedAt: Date;
  }): NewRecoveryOpportunityData {
    const { finding, sourceEvent } = args;
    return {
      // Attribution flows ONLY from the persisted source event (tenant isolation).
      merchantId: sourceEvent.merchantId,
      paymentAccountId: sourceEvent.paymentAccountId,
      type: finding.type,
      status: 'OPEN',
      sourceEventId: sourceEvent.id,
      providerPaymentId: finding.evidence.providerPaymentId,
      providerOrderId: finding.evidence.providerOrderId,
      amountAtRisk: finding.evidence.amount,
      currency: finding.evidence.currency,
      reason: finding.reason,
      evidence: finding.evidence,
      recoveryEventId: null,
      detectedAt: args.detectedAt,
      expiresAt: finding.expiresAt,
      resolvedAt: null,
    };
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
