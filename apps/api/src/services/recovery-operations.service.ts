import type { AILogger } from './recovery-ai-advisor.service.js';
import type {
  ExecutionReconciliation,
  ExecutionStatus,
  RecoveryExecutionRow,
} from '../domain/recovery-execution.js';
import { describeReconciliation } from '../domain/recovery-execution.js';
import type { RecoveryDecisionService } from './recovery-decision.service.js';
import type { RecoveryExecutionRepository } from '../repositories/recovery-execution.repository.js';
import type { RecoveryOpportunityRepository } from '../repositories/recovery-opportunity.repository.js';

export interface OperationsOverview {
  automationEnabled: boolean;
  providerConfigured: boolean;
  countsByStatus: Record<ExecutionStatus, number>;
  dueCount: number;
}

export interface OperationsExecutionSummary extends RecoveryExecutionRow {
  /** Webhook-confirmed outcome vs provider acceptance — never conflated. */
  reconciliation: ExecutionReconciliation;
  opportunityStatus: string | null;
}

export interface OperationsExecutionDetail {
  execution: OperationsExecutionSummary;
  opportunity: {
    id: string;
    status: string;
    amountAtRisk: number;
    currency: string;
    providerPaymentId: string | null;
    providerOrderId: string | null;
  } | null;
  decision: {
    id: string;
    engineVersion: string;
    score: number;
    priority: string;
    confidence: number;
    recommendedAction: string;
  } | null;
}

export interface RecoveryOperationsConfig {
  automationEnabled: boolean;
  providerConfigured: boolean;
  defaultListLimit: number;
}

/**
 * Read/monitoring surface for recovery operations (Phase 7). Purely
 * observational: nothing here mutates executions. Tenant scoping is honored
 * via the optional merchantId filter, consistent with Phases 4–6.
 */
export class RecoveryOperationsService {
  constructor(
    private readonly executions: RecoveryExecutionRepository,
    private readonly opportunities: RecoveryOpportunityRepository,
    private readonly decisions: RecoveryDecisionService,
    private readonly config: RecoveryOperationsConfig,
    private readonly logger?: AILogger
  ) {}

  async overview(): Promise<OperationsOverview> {
    const [counts, due] = await Promise.all([
      this.executions.countByStatus(),
      this.executions.findDuePending({ dueBefore: new Date(), limit: 1 }),
    ]);
    const countsByStatus = Object.fromEntries(
      counts.map((entry) => [entry.status, entry.count])
    ) as Record<ExecutionStatus, number>;
    return {
      automationEnabled: this.config.automationEnabled,
      providerConfigured: this.config.providerConfigured,
      countsByStatus,
      dueCount: due.length,
    };
  }

  async listExecutions(filters: {
    status?: ExecutionStatus;
    merchantId?: string;
    limit?: number;
  }): Promise<OperationsExecutionSummary[]> {
    const rows = await this.executions.listRecent({
      status: filters.status,
      limit: filters.limit ?? this.config.defaultListLimit,
    });
    const scoped = this.applyTenantScope(rows, filters.merchantId);
    return Promise.all(scoped.map((row) => this.toSummary(row)));
  }

  async getExecutionDetail(id: string): Promise<OperationsExecutionDetail | null> {
    const row = await this.executions.findById(id);
    if (row === null) {
      return null;
    }
    const summary = await this.toSummary(row);
    const opportunity =
      (await this.opportunities.findById(row.opportunityId)) ?? null;
    const decision = row.decisionId
      ? await this.decisions.findDecisionById(row.decisionId)
      : null;

    return {
      execution: summary,
      opportunity:
        opportunity === null
          ? null
          : {
              id: opportunity.id,
              status: opportunity.status,
              amountAtRisk: opportunity.amountAtRisk,
              currency: opportunity.currency,
              providerPaymentId: opportunity.providerPaymentId,
              providerOrderId: opportunity.providerOrderId,
            },
      decision:
        decision === null
          ? null
          : {
              id: decision.id,
              engineVersion: decision.engineVersion,
              score: decision.score,
              priority: decision.priority,
              confidence: decision.confidence,
              recommendedAction: decision.recommendedAction,
            },
    };
  }

  private async toSummary(row: RecoveryExecutionRow): Promise<OperationsExecutionSummary> {
    const opportunity = await this.opportunities.findById(row.opportunityId);
    const opportunityStatus = opportunity?.status ?? null;
    return {
      ...row,
      reconciliation: describeReconciliation(row.status, opportunityStatus ?? 'OPEN'),
      opportunityStatus,
    };
  }

  /**
   * Merchant scoping: when a merchantId filter is supplied, only rows whose
   * attribution matches exactly (including the null == null local-dev case)
   * are returned — mirroring the Phase 3 resolution semantics.
   */
  private applyTenantScope(
    rows: readonly RecoveryExecutionRow[],
    merchantId?: string
  ): readonly RecoveryExecutionRow[] {
    if (merchantId === undefined) {
      return rows;
    }
    return rows.filter((row) => row.merchantId === merchantId);
  }
}
