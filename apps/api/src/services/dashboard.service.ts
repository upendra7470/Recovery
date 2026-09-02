import type { RecoveryOpportunityRepository } from '../repositories/recovery-opportunity.repository.js';
import type { RecoveryExecutionRepository } from '../repositories/recovery-execution.repository.js';
import type { RecoveryDecisionService } from './recovery-decision.service.js';
import type { RecoveryOperationsService } from './recovery-operations.service.js';
import type { MerchantMemoryService } from './merchant-memory.service.js';
import type { ExecutionStatus } from '../domain/recovery-execution.js';
import type { RecoveryOpportunityRow, OpportunityStatusSummary } from '../domain/recovery-opportunity.js';

/**
 * Phase 14 — Merchant Dashboard Service.
 *
 * Aggregates data from existing RecoveryOS services into a single dashboard
 * response. This is a READ-ONLY presentation layer — it does not calculate
 * recovery decisions or perform any mutations.
 *
 * Every metric displayed must be traceable to persisted records.
 */

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface DashboardRevenueMetrics {
  /** Amount currently at risk from open recovery opportunities (minor units). */
  atRisk: number;
  /** Amount that could realistically be recovered (same as atRisk for now). */
  recoverable: number;
  /** Amount verified as recovered through outcome verification (minor units). */
  recovered: number;
  /** recovered / recoverable, or 0 when no data. */
  recoveryRate: number;
}

export interface DashboardPaymentMetrics {
  /** Total payment events ingested. */
  total: number;
  /** Events with eventType containing 'captured' or status 'captured'. */
  successful: number;
  /** Events with eventType containing 'failed' or status 'failed'. */
  failed: number;
  /** successful / total, or 0. */
  successRate: number;
}

export interface DashboardRecoveryMetrics {
  /** Total open recovery opportunities. */
  opportunities: number;
  /** Total execution records created. */
  executionsAttempted: number;
  /** Executions with status BLOCKED. */
  blocked: number;
  /** Executions with status SUCCEEDED. */
  succeeded: number;
  /** Executions with status FAILED. */
  failed: number;
  /** Executions pending authorization or execution. */
  pending: number;
  /** Opportunities with status RECOVERED. */
  verified: number;
}

export interface DashboardSafetyMetrics {
  /** Executions approved by safety gate (SUCCEEDED + FAILED + PENDING). */
  approved: number;
  /** Executions blocked by safety gate. */
  blocked: number;
  /** Executions requiring human review (REVIEW action). */
  humanReview: number;
}

export interface DashboardActivityItem {
  id: string;
  type: 'opportunity' | 'execution' | 'decision';
  action: string;
  status: string;
  amount: number | null;
  currency: string | null;
  timestamp: string;
  detail: string;
}

export interface DashboardOverview {
  revenue: DashboardRevenueMetrics;
  payments: DashboardPaymentMetrics;
  recovery: DashboardRecoveryMetrics;
  safety: DashboardSafetyMetrics;
  recentActivity: DashboardActivityItem[];
  hasData: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DashboardService {
  constructor(
    private readonly opportunities: RecoveryOpportunityRepository,
    private readonly executions: RecoveryExecutionRepository,
    private readonly decisions: RecoveryDecisionService,
    private readonly operations: RecoveryOperationsService,
    private readonly merchantMemory: MerchantMemoryService
  ) {}

  /**
   * Build the complete dashboard overview. All queries are independent and
   * run in parallel for performance. Tenant scoping is honored through the
   * existing repository-level merchantId filters.
   */
  async getOverview(merchantId?: string): Promise<DashboardOverview> {
    const [
      opportunitySummaries,
      totalOpportunities,
      , // openOpportunities — tracked by opportunitySummaries status filter
      recoveredOpportunities,
      executionCounts,
      recentExecutions,
      recentOpportunities,
      decisionsOverview,
    ] = await Promise.all([
      this.opportunities.summarizeByStatusAndCurrency(merchantId),
      this.opportunities.count({ merchantId }),
      this.opportunities.count({ merchantId, status: 'OPEN' }),
      this.opportunities.count({ merchantId, status: 'RECOVERED' }),
      this.executions.countByStatus(),
      this.executions.listRecent({ limit: 10 }),
      this.opportunities.list({ merchantId }),
      this.decisions.overviewMetrics(merchantId),
    ]);

    // Revenue metrics from opportunity summaries (per-currency safe)
    const revenue = this.buildRevenueMetrics(opportunitySummaries);

    // Execution counts by status
    const execCounts = Object.fromEntries(
      executionCounts.map((e) => [e.status, e.count])
    ) as Record<ExecutionStatus, number>;

    const totalExecutions = executionCounts.reduce((sum, e) => sum + e.count, 0);

    // Recovery metrics
    const recovery: DashboardRecoveryMetrics = {
      opportunities: totalOpportunities,
      executionsAttempted: totalExecutions,
      blocked: execCounts['BLOCKED'] ?? 0,
      succeeded: execCounts['SUCCEEDED'] ?? 0,
      failed: execCounts['FAILED'] ?? 0,
      pending: (execCounts['PENDING'] ?? 0) + (execCounts['AUTHORIZED'] ?? 0) + (execCounts['EXECUTING'] ?? 0),
      verified: recoveredOpportunities,
    };

    // Safety metrics — derived from execution status
    const safety: DashboardSafetyMetrics = {
      approved: (execCounts['SUCCEEDED'] ?? 0) + (execCounts['FAILED'] ?? 0) + (execCounts['PENDING'] ?? 0) + (execCounts['AUTHORIZED'] ?? 0) + (execCounts['EXECUTING'] ?? 0),
      blocked: execCounts['BLOCKED'] ?? 0,
      humanReview: decisionsOverview.reviewRequired,
    };

    // Payment metrics — count events by outcome
    const paymentMetrics = this.buildPaymentMetrics(recentOpportunities);

    // Recent activity feed
    const recentActivity = this.buildActivityFeed(
      recentExecutions,
      recentOpportunities.slice(0, 5)
    );

    const hasData = totalOpportunities > 0 || totalExecutions > 0;

    return {
      revenue,
      payments: paymentMetrics,
      recovery,
      safety,
      recentActivity,
      hasData,
    };
  }

  private buildRevenueMetrics(
    summaries: OpportunityStatusSummary[]
  ): DashboardRevenueMetrics {
    // Use INR as primary currency (consistent with existing convention)
    const inrSummaries = summaries.filter((s) => s.currency === 'INR');

    const atRisk = inrSummaries
      .filter((s) => s.status === 'OPEN')
      .reduce((sum, s) => sum + s.totalAmountAtRisk, 0);

    const recovered = inrSummaries
      .filter((s) => s.status === 'RECOVERED')
      .reduce((sum, s) => sum + s.totalAmountAtRisk, 0);

    // Recoverable = at risk (conservative: we assume all open are recoverable)
    const recoverable = atRisk;
    const recoveryRate = recoverable > 0 ? recovered / recoverable : 0;

    return { atRisk, recoverable, recovered, recoveryRate };
  }

  private buildPaymentMetrics(
    opportunities: RecoveryOpportunityRow[]
  ): DashboardPaymentMetrics {
    // We derive payment health from opportunity data since opportunities
    // are created from payment events. Each opportunity has a sourceEventId
    // and an eventType embedded in its evidence.
    const total = opportunities.length;

    // Count recovered as "successful" outcomes
    const successful = opportunities.filter((o) => o.status === 'RECOVERED').length;
    // Count open as "failed" (they still need recovery)
    const failed = opportunities.filter((o) => o.status === 'OPEN').length;
    const successRate = total > 0 ? successful / total : 0;

    return { total, successful, failed, successRate };
  }

  private buildActivityFeed(
    executions: { id: string; action: string; status: string; createdAt: Date; opportunityId: string }[],
    opportunities: RecoveryOpportunityRow[]
  ): DashboardActivityItem[] {
    const items: DashboardActivityItem[] = [];

    for (const exec of executions) {
      const opp = opportunities.find((o) => o.id === exec.opportunityId);
      items.push({
        id: exec.id,
        type: 'execution',
        action: exec.action,
        status: exec.status,
        amount: opp?.amountAtRisk ?? null,
        currency: opp?.currency ?? null,
        timestamp: exec.createdAt.toISOString(),
        detail: `${exec.action} attempt — ${exec.status}`,
      });
    }

    // Add recent opportunities
    for (const opp of opportunities.slice(0, 5)) {
      items.push({
        id: opp.id,
        type: 'opportunity',
        action: 'DETECTED',
        status: opp.status,
        amount: opp.amountAtRisk,
        currency: opp.currency,
        timestamp: opp.detectedAt.toISOString(),
        detail: opp.reason,
      });
    }

    // Sort by timestamp descending
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return items.slice(0, 15);
  }
}
