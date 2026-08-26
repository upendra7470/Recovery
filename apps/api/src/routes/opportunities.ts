import type { FastifyPluginAsync } from 'fastify';
import { NotFoundError } from '../lib/errors.js';
import { parseWith } from '../validation/parse.js';
import {
  assertObjectAccess,
  requireAuthenticated,
  requireMerchantScope,
} from '../auth/guards.js';
import {
  listOpportunitiesQuerySchema,
  type OpportunityStatusSummary,
  type RecoveryOpportunityRow,
} from '../domain/recovery-opportunity.js';
import { toEventView } from '../detection/event-view.js';
import type { AppDatabase } from '../lib/database.js';
import type {
  OpportunityDecisionSummaryResponse,
} from './decisions.js';
import type { RecoveryDecisionRow } from '../domain/recovery-decision.js';

export interface OpportunitySummaryResponse {
  id: string;
  merchantId: string | null;
  paymentAccountId: string | null;
  type: RecoveryOpportunityRow['type'];
  status: RecoveryOpportunityRow['status'];
  providerPaymentId: string | null;
  providerOrderId: string | null;
  /** Minor currency units (paise for INR). */
  amountAtRisk: number;
  currency: string;
  reason: string;
  detectedAt: Date;
  expiresAt: Date | null;
  /** Latest stored decision summary; absent when not yet evaluated. */
  decision?: OpportunityDecisionSummaryResponse;
}

export interface OpportunityListResponse {
  opportunities: OpportunitySummaryResponse[];
  total: number;
}

export interface SourceEventSummary {
  id: string;
  eventType: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  /** Minor currency units (paise for INR); omitted when unknown. */
  amount?: number;
  currency?: string;
  status?: string;
  occurredAt: string;
}

export interface OpportunityDetailResponse extends OpportunitySummaryResponse {
  evidence: unknown;
  resolvedAt: Date | null;
  recoveryEventId: string | null;
  sourceEvent: SourceEventSummary | null;
}

export interface CurrencyBreakdown {
  currency: string;
  revenueAtRisk: number;
  recoveredAmount: number;
}

export interface OpportunitiesOverviewResponse {
  openOpportunities: number;
  failedPayments: number;
  /** Per-currency totals; currencies are never mixed into one number. */
  currencies: CurrencyBreakdown[];
}

function toSummaryResponse(row: RecoveryOpportunityRow): OpportunitySummaryResponse {
  return {
    id: row.id,
    merchantId: row.merchantId,
    paymentAccountId: row.paymentAccountId,
    type: row.type,
    status: row.status,
    providerPaymentId: row.providerPaymentId,
    providerOrderId: row.providerOrderId,
    amountAtRisk: row.amountAtRisk,
    currency: row.currency,
    reason: row.reason,
    detectedAt: row.detectedAt,
    expiresAt: row.expiresAt,
  };
}

function toDecisionSummary(decision: RecoveryDecisionRow): OpportunityDecisionSummaryResponse {
  return {
    score: decision.score,
    priority: decision.priority,
    confidence: decision.confidence,
    recommendedAction: decision.recommendedAction,
    evaluatedAt: decision.evaluatedAt.toISOString(),
  };
}

function toCurrencyBreakdowns(summaries: OpportunityStatusSummary[]): CurrencyBreakdown[] {
  const byCurrency = new Map<string, CurrencyBreakdown>();
  for (const summary of summaries) {
    let entry = byCurrency.get(summary.currency);
    if (entry === undefined) {
      entry = { currency: summary.currency, revenueAtRisk: 0, recoveredAmount: 0 };
      byCurrency.set(summary.currency, entry);
    }
    if (summary.status === 'OPEN') {
      entry.revenueAtRisk += summary.totalAmountAtRisk;
    }
    if (summary.status === 'RECOVERED') {
      entry.recoveredAmount += summary.totalAmountAtRisk;
    }
  }
  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * Internal read API for recovery opportunities. All queries honor the
 * merchantId filter so responses never cross tenant boundaries. Raw webhook
 * payloads and customer PII are never exposed — only detection evidence and
 * non-sensitive source-event fields.
 */
export const opportunityRoutes: FastifyPluginAsync = async (app) => {
  const repository = app.opportunities;

  app.get<{ Querystring: Record<string, unknown>; Reply: OpportunityListResponse }>(
    '/opportunities',
    async (request, reply) => {
      const query = parseWith(listOpportunitiesQuerySchema, request.query);
      let effectiveMerchantId: string | undefined = query.merchantId;
      if (app.config.AUTH_ENABLED) {
        const principal = requireAuthenticated(request.principal);
        if (query.merchantId !== undefined) {
          effectiveMerchantId = requireMerchantScope(principal, query.merchantId);
        } else {
          // When auth is enabled and caller omits merchantId, derive from principal.
          // requireMerchantScope will auto-derive for single membership or throw 400 for multi.
          effectiveMerchantId = requireMerchantScope(principal, undefined);
        }
      }
      const filters = {
        merchantId: effectiveMerchantId,
        status: query.status,
        type: query.type,
        ...(query.from !== undefined ? { detectedFrom: new Date(query.from) } : {}),
        ...(query.to !== undefined ? { detectedTo: new Date(query.to) } : {}),
      };

      const [rows, total] = await Promise.all([
        repository.list(filters),
        repository.count(filters),
      ]);

      // Attach latest stored decision per opportunity (additive field; absent
      // when an opportunity has not been evaluated yet).
      const decisionsByOpportunityId = new Map<string, RecoveryDecisionRow>();
      if (rows.length > 0) {
        const decisionRows = await app.decisions.findLatestByOpportunityIds(
          rows.map((row) => row.id)
        );
        for (const decision of decisionRows) {
          const existing = decisionsByOpportunityId.get(decision.opportunityId);
          if (existing === undefined || decision.evaluatedAt > existing.evaluatedAt) {
            decisionsByOpportunityId.set(decision.opportunityId, decision);
          }
        }
      }

      const body: OpportunityListResponse = {
        opportunities: rows.map((row) => {
          const summary = toSummaryResponse(row);
          const decision = decisionsByOpportunityId.get(row.id);
          return decision !== undefined
            ? { ...summary, decision: toDecisionSummary(decision) }
            : summary;
        }),
        total,
      };
      return reply.send(body);
    }
  );

  app.get<{ Querystring: Record<string, unknown>; Reply: OpportunitiesOverviewResponse }>(
    '/opportunities/overview',
    async (request, reply) => {
      const query = parseWith(
        listOpportunitiesQuerySchema.pick({ merchantId: true }),
        request.query
      );
      let merchantId: string | undefined = query.merchantId;
      if (app.config.AUTH_ENABLED) {
        const principal = requireAuthenticated(request.principal);
        // For overview, if auth enabled, validate or derive merchant scope
        if (query.merchantId !== undefined) {
          merchantId = requireMerchantScope(principal, query.merchantId);
        } else {
          // Try to derive; if single membership, use it; if multiple, throw 400 requiring explicit
          merchantId = requireMerchantScope(principal, undefined);
        }
      }

      const [summaries, failedPayments] = await Promise.all([
        repository.summarizeByStatusAndCurrency(merchantId),
        repository.countByType('FAILED_PAYMENT', merchantId),
      ]);

      const openCount = summaries
        .filter((summary) => summary.status === 'OPEN')
        .reduce((total, summary) => total + summary.count, 0);

      const body: OpportunitiesOverviewResponse = {
        openOpportunities: openCount,
        failedPayments,
        currencies: toCurrencyBreakdowns(summaries),
      };
      return reply.send(body);
    }
  );

  app.get<{ Params: { id: string }; Reply: OpportunityDetailResponse }>(
    '/opportunities/:id',
    async (request, reply) => {
      const { id } = request.params;
      const opportunity = await repository.findById(id);
      if (opportunity === null) {
        throw new NotFoundError('Recovery opportunity');
      }
      if (app.config.AUTH_ENABLED) {
        const principal = requireAuthenticated(request.principal);
        assertObjectAccess(principal, opportunity.merchantId, 'Recovery opportunity');
      }

      const sourceEvent = await findSourceEvent(app.db, opportunity.sourceEventId);
      let sourceEventSummary: SourceEventSummary | null = null;
      if (sourceEvent !== null) {
        const view = toEventView(sourceEvent);
        sourceEventSummary = {
          id: view.id,
          eventType: view.eventType,
          providerPaymentId: view.providerPaymentId,
          providerOrderId: view.providerOrderId,
          ...(view.amount !== null ? { amount: view.amount } : {}),
          ...(view.currency !== null ? { currency: view.currency } : {}),
          ...(view.status !== null ? { status: view.status } : {}),
          occurredAt: view.occurredAt.toISOString(),
        };
      }

      const body: OpportunityDetailResponse = {
        ...toSummaryResponse(opportunity),
        evidence: opportunity.evidence,
        resolvedAt: opportunity.resolvedAt,
        recoveryEventId: opportunity.recoveryEventId,
        sourceEvent: sourceEventSummary,
      };
      return reply.send(body);
    }
  );
};

async function findSourceEvent(db: AppDatabase, sourceEventId: string) {
  return db.paymentEvent.findById(sourceEventId);
}
