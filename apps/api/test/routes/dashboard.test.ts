/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-return */
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DashboardService } from '../../src/services/dashboard.service.js';
import type { RecoveryOpportunityRow, OpportunityStatusSummary, OpportunityFilters } from '../../src/domain/recovery-opportunity.js';
import type { RecoveryExecutionRow, ExecutionStatus } from '../../src/domain/recovery-execution.js';
import type { DecisionsOverviewMetrics } from '../../src/domain/recovery-decision.js';

// ---------------------------------------------------------------------------
// In-memory stores for testing
// ---------------------------------------------------------------------------

class InMemoryOpportunityStore {
  private rows: Map<string, RecoveryOpportunityRow> = new Map();

  async insert(data: any): Promise<RecoveryOpportunityRow> {
    const id = randomUUID();
    const now = new Date();
    const row: RecoveryOpportunityRow = {
      id,
      merchantId: data.merchantId ?? null,
      paymentAccountId: data.paymentAccountId ?? null,
      type: data.type ?? 'FAILED_PAYMENT',
      status: data.status ?? 'OPEN',
      sourceEventId: data.sourceEventId ?? randomUUID(),
      providerPaymentId: data.providerPaymentId ?? null,
      providerOrderId: data.providerOrderId ?? null,
      amountAtRisk: data.amountAtRisk ?? 50000,
      currency: data.currency ?? 'INR',
      reason: data.reason ?? 'Payment failed',
      evidence: data.evidence ?? {},
      recoveryEventId: data.recoveryEventId ?? null,
      detectedAt: data.detectedAt ?? now,
      expiresAt: data.expiresAt ?? null,
      resolvedAt: data.resolvedAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(id, row);
    return row;
  }

  async findBySourceEventAndType(): Promise<RecoveryOpportunityRow | null> { return null; }
  async findOpenByPaymentCorrelation(): Promise<RecoveryOpportunityRow[]> { return []; }
  async findById(id: string): Promise<RecoveryOpportunityRow | null> { return this.rows.get(id) ?? null; }

  async list(filters: OpportunityFilters): Promise<RecoveryOpportunityRow[]> {
    let rows = Array.from(this.rows.values());
    if (filters.merchantId !== undefined) rows = rows.filter((r) => r.merchantId === filters.merchantId);
    if (filters.status !== undefined) rows = rows.filter((r) => r.status === filters.status);
    return rows;
  }

  async count(filters: OpportunityFilters): Promise<number> {
    const rows = await this.list(filters);
    return rows.length;
  }

  async markRecovered(args: { id: string; recoveryEventId: string; resolvedAt: Date }): Promise<RecoveryOpportunityRow> {
    const row = this.rows.get(args.id);
    if (!row) throw new Error('Not found');
    row.status = 'RECOVERED';
    row.resolvedAt = args.resolvedAt;
    return row;
  }

  async summarizeByStatusAndCurrency(merchantId?: string): Promise<OpportunityStatusSummary[]> {
    let rows = Array.from(this.rows.values());
    if (merchantId !== undefined) rows = rows.filter((r) => r.merchantId === merchantId);

    const map = new Map<string, OpportunityStatusSummary>();
    for (const row of rows) {
      const key = `${row.status}:${row.currency}`;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        existing.totalAmountAtRisk += row.amountAtRisk;
      } else {
        map.set(key, {
          status: row.status,
          currency: row.currency,
          count: 1,
          totalAmountAtRisk: row.amountAtRisk,
        });
      }
    }
    return Array.from(map.values());
  }

  async countByType(): Promise<number> { return 0; }
  async outcomeStatsByType(): Promise<{ total: number; recovered: number }> { return { total: 0, recovered: 0 }; }

  get size() { return this.rows.size; }
}

class InMemoryExecutionStore {
  private rows: Map<string, RecoveryExecutionRow> = new Map();

  async insert(data: any): Promise<RecoveryExecutionRow> {
    const id = randomUUID();
    const now = new Date();
    const row: RecoveryExecutionRow = {
      id,
      merchantId: data.merchantId ?? null,
      opportunityId: data.opportunityId ?? randomUUID(),
      decisionId: data.decisionId ?? randomUUID(),
      action: data.action ?? 'RETRY',
      status: data.status ?? 'PENDING',
      origin: data.origin ?? 'AUTOMATED',
      attempt: data.attempt ?? 1,
      nextAttemptAt: data.nextAttemptAt ?? null,
      scheduledAt: data.scheduledAt ?? null,
      idempotencyKey: data.idempotencyKey ?? randomUUID(),
      provider: data.provider ?? null,
      providerPaymentId: data.providerPaymentId ?? null,
      requestedAt: data.requestedAt ?? now,
      failureCode: data.failureCode ?? null,
      failureReason: data.failureReason ?? null,
      startedAt: data.startedAt ?? null,
      completedAt: data.completedAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(id, row);
    return row;
  }

  async findByIdempotencyKey(): Promise<RecoveryExecutionRow | null> { return null; }
  async findById(id: string): Promise<RecoveryExecutionRow | null> { return this.rows.get(id) ?? null; }
  async updateStatus(): Promise<RecoveryExecutionRow> { return {} as any; }
  async transitionStatus(): Promise<RecoveryExecutionRow | null> { return null; }
  async setNextAttemptAt(): Promise<RecoveryExecutionRow> { return {} as any; }
  async findDuePending(): Promise<RecoveryExecutionRow[]> { return []; }
  async findStalePending(): Promise<RecoveryExecutionRow[]> { return []; }
  async findActiveByOpportunity(): Promise<RecoveryExecutionRow | null> { return null; }
  async findLatestByOpportunityAndAction(): Promise<RecoveryExecutionRow | null> { return null; }
  async countRetryAttempts(): Promise<number> { return 0; }

  async listRecent(args: { status?: ExecutionStatus; limit: number }): Promise<RecoveryExecutionRow[]> {
    let rows = Array.from(this.rows.values());
    if (args.status !== undefined) rows = rows.filter((r) => r.status === args.status);
    return rows
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, args.limit);
  }

  async listByOpportunity(): Promise<RecoveryExecutionRow[]> { return []; }

  async countByStatus(): Promise<{ status: ExecutionStatus; count: number }[]> {
    const counts = new Map<string, number>();
    for (const row of this.rows.values()) {
      counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([status, count]) => ({
      status: status as ExecutionStatus,
      count,
    }));
  }

  get size() { return this.rows.size; }
}

// ---------------------------------------------------------------------------
// Mock services
// ---------------------------------------------------------------------------

function createMockDecisionService() {
  return {
    overviewMetrics: async (_merchantId?: string): Promise<DecisionsOverviewMetrics> => ({
      criticalCount: 1,
      highCount: 2,
      recommendedRetries: 3,
      reviewRequired: 1,
      doNotRetry: 0,
      averageConfidence: 75,
    }),
  } as any;
}

function createMockOperationsService() {
  return {} as any;
}

function createMockMerchantMemoryService() {
  return {} as any;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEMO_MERCHANT_ID = '00000000-0000-4000-8000-000000000099';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 14 — Dashboard Service', () => {
  let oppStore: InMemoryOpportunityStore;
  let execStore: InMemoryExecutionStore;
  let dashboardService: DashboardService;

  beforeEach(() => {
    oppStore = new InMemoryOpportunityStore();
    execStore = new InMemoryExecutionStore();
    dashboardService = new DashboardService(
      oppStore as any,
      execStore as any,
      createMockDecisionService(),
      createMockOperationsService(),
      createMockMerchantMemoryService(),
    );
  });

  // -------------------------------------------------------------------------
  // A — Empty state
  // -------------------------------------------------------------------------
  describe('A — Empty state', () => {
    it('returns hasData=false when no data exists', async () => {
      const overview = await dashboardService.getOverview();
      expect(overview.hasData).toBe(false);
    });

    it('returns zero metrics when no data exists', async () => {
      const overview = await dashboardService.getOverview();
      expect(overview.revenue.atRisk).toBe(0);
      expect(overview.revenue.recovered).toBe(0);
      expect(overview.recovery.opportunities).toBe(0);
      expect(overview.recovery.executionsAttempted).toBe(0);
      expect(overview.payments.total).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // B — Revenue metrics
  // -------------------------------------------------------------------------
  describe('B — Revenue metrics', () => {
    it('computes atRisk from OPEN opportunities', async () => {
      await oppStore.insert({ merchantId: DEMO_MERCHANT_ID, status: 'OPEN', amountAtRisk: 100000, currency: 'INR' });
      await oppStore.insert({ merchantId: DEMO_MERCHANT_ID, status: 'OPEN', amountAtRisk: 50000, currency: 'INR' });

      const overview = await dashboardService.getOverview();
      expect(overview.revenue.atRisk).toBe(150000);
      expect(overview.revenue.recoverable).toBe(150000);
    });

    it('computes recovered from RECOVERED opportunities', async () => {
      await oppStore.insert({ merchantId: DEMO_MERCHANT_ID, status: 'RECOVERED', amountAtRisk: 80000, currency: 'INR' });

      const overview = await dashboardService.getOverview();
      expect(overview.revenue.recovered).toBe(80000);
    });

    it('computes recoveryRate correctly', async () => {
      await oppStore.insert({ merchantId: DEMO_MERCHANT_ID, status: 'OPEN', amountAtRisk: 100000, currency: 'INR' });
      await oppStore.insert({ merchantId: DEMO_MERCHANT_ID, status: 'RECOVERED', amountAtRisk: 50000, currency: 'INR' });

      const overview = await dashboardService.getOverview();
      // recovered(50000) / recoverable(100000) = 0.5
      expect(overview.revenue.recoveryRate).toBe(0.5);
    });

    it('returns recoveryRate=0 when no recoverable amount', async () => {
      const overview = await dashboardService.getOverview();
      expect(overview.revenue.recoveryRate).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // C — Recovery metrics
  // -------------------------------------------------------------------------
  describe('C — Recovery metrics', () => {
    it('counts opportunities by status', async () => {
      await oppStore.insert({ merchantId: DEMO_MERCHANT_ID, status: 'OPEN' });
      await oppStore.insert({ merchantId: DEMO_MERCHANT_ID, status: 'OPEN' });
      await oppStore.insert({ merchantId: DEMO_MERCHANT_ID, status: 'RECOVERED' });

      const overview = await dashboardService.getOverview();
      expect(overview.recovery.opportunities).toBe(3);
      expect(overview.recovery.verified).toBe(1);
    });

    it('counts executions by status', async () => {
      await execStore.insert({ status: 'SUCCEEDED' });
      await execStore.insert({ status: 'FAILED' });
      await execStore.insert({ status: 'BLOCKED' });
      await execStore.insert({ status: 'PENDING' });

      const overview = await dashboardService.getOverview();
      expect(overview.recovery.executionsAttempted).toBe(4);
      expect(overview.recovery.succeeded).toBe(1);
      expect(overview.recovery.failed).toBe(1);
      expect(overview.recovery.blocked).toBe(1);
      expect(overview.recovery.pending).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // D — Safety metrics
  // -------------------------------------------------------------------------
  describe('D — Safety metrics', () => {
    it('derives safety metrics from execution counts and decisions', async () => {
      await execStore.insert({ status: 'SUCCEEDED' });
      await execStore.insert({ status: 'BLOCKED' });

      const overview = await dashboardService.getOverview();
      expect(overview.safety.approved).toBeGreaterThanOrEqual(1);
      expect(overview.safety.blocked).toBe(1);
      expect(overview.safety.humanReview).toBe(1); // from mock decisionService
    });
  });

  // -------------------------------------------------------------------------
  // E — Payment metrics
  // -------------------------------------------------------------------------
  describe('E — Payment metrics', () => {
    it('derives payment metrics from opportunities', async () => {
      await oppStore.insert({ merchantId: DEMO_MERCHANT_ID, status: 'RECOVERED' });
      await oppStore.insert({ merchantId: DEMO_MERCHANT_ID, status: 'OPEN' });
      await oppStore.insert({ merchantId: DEMO_MERCHANT_ID, status: 'OPEN' });

      const overview = await dashboardService.getOverview();
      expect(overview.payments.total).toBe(3);
      expect(overview.payments.successful).toBe(1);
      expect(overview.payments.failed).toBe(2);
      expect(overview.payments.successRate).toBeCloseTo(1 / 3);
    });
  });

  // -------------------------------------------------------------------------
  // F — Activity feed
  // -------------------------------------------------------------------------
  describe('F — Activity feed', () => {
    it('includes recent executions in activity feed', async () => {
      await execStore.insert({ action: 'RETRY', status: 'SUCCEEDED' });
      await execStore.insert({ action: 'RETRY', status: 'FAILED' });

      const overview = await dashboardService.getOverview();
      expect(overview.recentActivity.length).toBeGreaterThanOrEqual(2);
      expect(overview.recentActivity.some((a) => a.type === 'execution')).toBe(true);
    });

    it('includes recent opportunities in activity feed', async () => {
      await oppStore.insert({ merchantId: DEMO_MERCHANT_ID, reason: 'Payment failed' });

      const overview = await dashboardService.getOverview();
      expect(overview.recentActivity.length).toBeGreaterThanOrEqual(1);
      expect(overview.recentActivity.some((a) => a.type === 'opportunity')).toBe(true);
    });

    it('limits activity feed to 15 items', async () => {
      for (let i = 0; i < 20; i++) {
        await execStore.insert({ action: 'RETRY', status: 'SUCCEEDED' });
      }

      const overview = await dashboardService.getOverview();
      expect(overview.recentActivity.length).toBeLessThanOrEqual(15);
    });
  });

  // -------------------------------------------------------------------------
  // G — Tenant scoping
  // -------------------------------------------------------------------------
  describe('G — Tenant scoping', () => {
    it('filters by merchantId when provided', async () => {
      const otherMerchant = '00000000-0000-4000-8000-000000000001';
      await oppStore.insert({ merchantId: DEMO_MERCHANT_ID, status: 'OPEN', amountAtRisk: 100000 });
      await oppStore.insert({ merchantId: otherMerchant, status: 'OPEN', amountAtRisk: 200000 });

      const overview = await dashboardService.getOverview(DEMO_MERCHANT_ID);
      expect(overview.revenue.atRisk).toBe(100000);
      expect(overview.recovery.opportunities).toBe(1);
    });

    it('returns all data when no merchantId filter', async () => {
      const otherMerchant = '00000000-0000-4000-8000-000000000001';
      await oppStore.insert({ merchantId: DEMO_MERCHANT_ID, status: 'OPEN', amountAtRisk: 100000 });
      await oppStore.insert({ merchantId: otherMerchant, status: 'OPEN', amountAtRisk: 200000 });

      const overview = await dashboardService.getOverview();
      expect(overview.revenue.atRisk).toBe(300000);
      expect(overview.recovery.opportunities).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // H — hasData flag
  // -------------------------------------------------------------------------
  describe('H — hasData flag', () => {
    it('returns hasData=true when opportunities exist', async () => {
      await oppStore.insert({ merchantId: DEMO_MERCHANT_ID });
      const overview = await dashboardService.getOverview();
      expect(overview.hasData).toBe(true);
    });

    it('returns hasData=true when executions exist', async () => {
      await execStore.insert({});
      const overview = await dashboardService.getOverview();
      expect(overview.hasData).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // I — Activity item structure
  // -------------------------------------------------------------------------
  describe('I — Activity item structure', () => {
    it('activity items have required fields', async () => {
      await oppStore.insert({ merchantId: DEMO_MERCHANT_ID, amountAtRisk: 50000, currency: 'INR', reason: 'Failed payment' });

      const overview = await dashboardService.getOverview();
      expect(overview.recentActivity.length).toBeGreaterThan(0);
      const item = overview.recentActivity[0]!;
      expect(['opportunity', 'execution', 'decision']).toContain(item.type);
      expect(item.action).toBeDefined();
      expect(item.status).toBeDefined();
      expect(item.timestamp).toBeDefined();
      expect(item.detail).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // J — Mixed currencies
  // -------------------------------------------------------------------------
  describe('J — Mixed currencies', () => {
    it('separates revenue by currency', async () => {
      await oppStore.insert({ merchantId: DEMO_MERCHANT_ID, status: 'OPEN', amountAtRisk: 100000, currency: 'INR' });
      await oppStore.insert({ merchantId: DEMO_MERCHANT_ID, status: 'OPEN', amountAtRisk: 5000, currency: 'USD' });

      const overview = await dashboardService.getOverview();
      // Only INR amounts should be in revenue metrics
      expect(overview.revenue.atRisk).toBe(100000);
    });
  });
});
