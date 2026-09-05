/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { JudgeModeService } from '../../src/services/judge-mode.service.js';
import { JudgeModeError } from '../../src/services/judge-mode.service.js';
import type { PaymentEventRow, NewPaymentEventData, PaymentAccountLookupStore, AccountReference } from '../../src/domain/payment-event.js';
import type { SimulationRunRow, SimulationRunStore, NewSimulationRunData } from '../../src/domain/simulation-run.js';

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

class InMemoryPaymentEventStore {
  private rows: Map<string, PaymentEventRow> = new Map();
  async insert(data: NewPaymentEventData): Promise<PaymentEventRow> {
    const id = randomUUID();
    const now = new Date();
    const row: PaymentEventRow = {
      id, paymentAccountId: data.paymentAccountId, merchantId: data.merchantId,
      provider: data.provider, providerEventId: data.providerEventId, eventType: data.eventType,
      providerPaymentId: data.providerPaymentId, providerOrderId: data.providerOrderId,
      eventCreatedAt: data.eventCreatedAt, receivedAt: data.receivedAt,
      payload: data.payload, normalizedData: data.normalizedData,
      signatureVerified: data.signatureVerified, processingStatus: data.processingStatus,
      processingAttempts: data.processingAttempts, processedAt: data.processedAt,
      failureReason: data.failureReason, createdAt: now, updatedAt: now,
    };
    this.rows.set(id, row);
    return row;
  }
  async findByProviderEventId(): Promise<PaymentEventRow | null> { return null; }
  async findById(id: string): Promise<PaymentEventRow | null> { return this.rows.get(id) ?? null; }
  async findRelatedByOrderOrPayment(): Promise<PaymentEventRow[]> { return []; }
  async findMany(): Promise<PaymentEventRow[]> { return []; }
  async countByMerchant(): Promise<number> { return 0; }
  async deleteByMerchant(): Promise<number> { return 0; }
}

class InMemoryPaymentAccountStore implements PaymentAccountLookupStore {
  async findActiveByExternalId(): Promise<AccountReference | null> { return null; }
  async findById(): Promise<AccountReference | null> { return null; }
  async upsertById(args: { id: string; merchantId: string }): Promise<AccountReference> { return { id: args.id, merchantId: args.merchantId }; }
  async countByMerchant(): Promise<number> { return 0; }
  async deleteByMerchant(): Promise<number> { return 0; }
}

class InMemorySimulationRunStore implements SimulationRunStore {
  private rows: Map<string, SimulationRunRow> = new Map();
  async create(data: NewSimulationRunData): Promise<SimulationRunRow> {
    const now = new Date();
    const row: SimulationRunRow = {
      id: data.id, seed: data.seed, merchantCount: data.merchantCount,
      eventsPerMerchant: data.eventsPerMerchant, totalEvents: data.totalEvents,
      status: data.status, startedAt: null, completedAt: null, processingDurationMs: null,
      processedEvents: 0, successfulPayments: 0, failedPayments: 0,
      opportunitiesDetected: 0, executionsAttempted: 0, executionsBlocked: 0,
      humanReviews: 0, recoveriesVerified: 0, revenueAtRisk: 0,
      recoverableRevenue: 0, recoveredRevenue: 0, createdAt: now, updatedAt: now,
    };
    this.rows.set(row.id, row);
    return row;
  }
  async update(id: string, data: Partial<SimulationRunRow>): Promise<SimulationRunRow> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`Run ${id} not found`);
    Object.assign(row, data, { updatedAt: new Date() });
    return row;
  }
  async findById(id: string): Promise<SimulationRunRow | null> { return this.rows.get(id) ?? null; }
  async listRecent(limit: number = 20): Promise<SimulationRunRow[]> {
    return Array.from(this.rows.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  }
  async deleteById(id: string): Promise<boolean> { return this.rows.delete(id); }
}

// ---------------------------------------------------------------------------
// Mock AppDatabase
// ---------------------------------------------------------------------------

function createMockDb(runStore: InMemorySimulationRunStore, eventStore: InMemoryPaymentEventStore) {
  return {
    $queryRaw: async () => [{ ok: 1 }],
    simulationRun: runStore,
    paymentEvent: eventStore,
    paymentAccount: new InMemoryPaymentAccountStore(),
    recoveryOpportunity: {
      insert: async (data: any) => ({ id: randomUUID(), ...data, status: 'OPEN', createdAt: new Date(), updatedAt: new Date() }),
      findBySourceEventAndType: async () => null,
      findOpenByPaymentCorrelation: async () => [],
      findById: async () => null,
      list: async () => [],
      count: async () => 0,
      markRecovered: async (args: any) => ({ ...args, status: 'RECOVERED' }),
      summarizeByStatusAndCurrency: async () => [],
      countByType: async () => 0,
      outcomeStatsByType: async () => ({ total: 0, recovered: 0 }),
    },
    recoveryDecision: {
      upsert: async (data: any) => ({ id: randomUUID(), ...data }),
      findById: async () => null,
      findByOpportunityAndEngineVersion: async () => null,
      findLatestByOpportunityIds: async () => [],
      listAll: async () => [],
      countByPriority: async () => 0,
      countByRecommendedAction: async () => 0,
      averageConfidence: async () => 0,
    },
    recoveryAIAdvice: {
      upsert: async (data: any) => ({ id: randomUUID(), ...data }),
      findByDecision: async () => null,
      findByDecisionId: async () => null,
    },
    recoveryExecution: {
      insert: async (data: any) => ({ id: randomUUID(), ...data }),
      findByIdempotencyKey: async () => null,
      findById: async () => null,
      updateStatus: async () => ({} as any),
      transitionStatus: async () => ({} as any),
      setNextAttemptAt: async () => ({} as any),
      listByOpportunity: async () => [],
      findLatestByOpportunityAndAction: async () => null,
      findActiveByOpportunity: async () => null,
      findDuePending: async () => [],
      findStalePending: async () => [],
      listRecent: async () => [],
      listAll: async () => [],
      countByStatus: async () => [],
      countRetryAttempts: async () => 0,
    },
    auth: {
      findUserByEmail: async () => null,
      createUser: async () => ({} as any),
      findMembershipsByUser: async () => [],
      findMembership: async () => null,
      createMembership: async () => ({} as any),
      createSession: async () => ({} as any),
      findActiveSessionByTokenHash: async () => null,
      revokeSession: async () => {},
    },
    merchantStrategyMemory: {
      upsert: async () => ({ id: randomUUID(), sampleCount: 0 }),
      updateMetrics: async () => ({} as any),
      findById: async () => null,
      findByMerchantAndStrategy: async () => null,
      listByMerchant: async () => [],
      getOverview: async () => ({
        merchantId: '', totalOutcomes: 0, totalRecovered: 0, totalAmountRecovered: 0,
        recoveryRate: 0, bestStrategy: null, bestStrategySuccessRate: 0,
        strategies: [], failurePatterns: [], confidence: 'NO_DATA', lastObservedAt: null,
      }),
      getEvidenceForAI: async () => ({
        merchantId: '', strategyPerformance: [], overallRecoveryRate: 0,
        totalOutcomes: 0, confidenceLevel: 'NO_DATA',
      }),
      deleteByMerchant: async () => 0,
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 15 — Judge Mode Service', () => {
  let runStore: InMemorySimulationRunStore;
  let eventStore: InMemoryPaymentEventStore;
  let mockDb: ReturnType<typeof createMockDb>;
  let judgeService: JudgeModeService;

  beforeEach(() => {
    runStore = new InMemorySimulationRunStore();
    eventStore = new InMemoryPaymentEventStore();
    mockDb = createMockDb(runStore, eventStore);
    judgeService = new JudgeModeService(
      mockDb,
      {} as any, // leakageService
      {} as any, // decisionService
      {} as any, // executionService
      {} as any, // aiAdvisorService
      {} as any, // merchantMemoryService
    );
  });

  // -------------------------------------------------------------------------
  // A — Scenario validation
  // -------------------------------------------------------------------------
  describe('A — Scenario validation', () => {
    it('rejects invalid scenario', async () => {
      await expect(
        judgeService.startScenario({ scenario: 'nonexistent' })
      ).rejects.toThrow(JudgeModeError);
    });

    it('rejects invalid scenario with helpful message', async () => {
      try {
        await judgeService.startScenario({ scenario: 'bad' });
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(JudgeModeError);
        expect((e as JudgeModeError).message).toContain('Invalid scenario');
        expect((e as JudgeModeError).message).toContain('payment-failure-storm');
      }
    });

    it('accepts valid scenario ids', async () => {
      // These should not throw validation errors (may fail at pipeline level, but validation passes)
      const validIds = ['payment-failure-storm', 'gateway-degradation', 'mixed-recovery', 'recovery-stress'];
      for (const id of validIds) {
        // The startRun will fail because pipeline services are mocked, but validation should pass
        try {
          await judgeService.startScenario({ scenario: id, events: 1 });
        } catch (e) {
          // Pipeline errors are expected with mocks; validation errors are not
          expect(e).not.toBeInstanceOf(JudgeModeError);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // B — Start scenario
  // -------------------------------------------------------------------------
  describe('B — Start scenario', () => {
    it('validates scenario ID before starting', async () => {
      await expect(
        judgeService.startScenario({ scenario: 'invalid-scenario', events: 5 })
      ).rejects.toThrow(JudgeModeError);
    });

    it('delegates to SimulationRunService for event validation', async () => {
      // Event count validation is handled by SimulationRunService
      await expect(
        judgeService.startScenario({ scenario: 'mixed-recovery', events: 0 })
      ).rejects.toThrow();
    });

    it('maps scenario defaults correctly', async () => {
      const { getJudgeScenario } = await import('../../src/simulation/judge-scenarios.js');

      const storm = getJudgeScenario('payment-failure-storm');
      expect(storm).toBeDefined();
      expect(storm!.defaultEvents).toBe(1000);
      expect(storm!.defaultSeed).toBe(42);

      const stress = getJudgeScenario('recovery-stress');
      expect(stress).toBeDefined();
      expect(stress!.defaultEvents).toBe(10000);
    });
  });

  // -------------------------------------------------------------------------
  // C — Get run status
  // -------------------------------------------------------------------------
  describe('C — Get run status', () => {
    it('returns null for non-existent run', async () => {
      const status = await judgeService.getRunStatus(randomUUID());
      expect(status).toBeNull();
    });

    it('returns status for existing run', async () => {
      const run = await runStore.create({
        id: randomUUID(), seed: 42, merchantCount: 5,
        eventsPerMerchant: 200, totalEvents: 1000, status: 'completed',
      });

      const status = await judgeService.getRunStatus(run.id);
      expect(status).not.toBeNull();
      expect(status!.runId).toBe(run.id);
      expect(status!.status).toBe('completed');
    });

    it('computes progress correctly', async () => {
      const run = await runStore.create({
        id: randomUUID(), seed: 42, merchantCount: 5,
        eventsPerMerchant: 200, totalEvents: 1000, status: 'running',
      });
      await runStore.update(run.id, { processedEvents: 500 });

      const status = await judgeService.getRunStatus(run.id);
      expect(status!.progress).toBe(50);
    });

    it('computes recovery rate correctly', async () => {
      const run = await runStore.create({
        id: randomUUID(), seed: 42, merchantCount: 5,
        eventsPerMerchant: 200, totalEvents: 1000, status: 'completed',
      });
      await runStore.update(run.id, {
        recoverableRevenue: 100000,
        recoveredRevenue: 50000,
      });

      const status = await judgeService.getRunStatus(run.id);
      expect(status!.recoveryRate).toBe(0.5);
    });

    it('returns zero recovery rate when no recoverable revenue', async () => {
      const run = await runStore.create({
        id: randomUUID(), seed: 42, merchantCount: 5,
        eventsPerMerchant: 200, totalEvents: 1000, status: 'completed',
      });

      const status = await judgeService.getRunStatus(run.id);
      expect(status!.recoveryRate).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // D — List runs
  // -------------------------------------------------------------------------
  describe('D — List runs', () => {
    it('lists recent runs', async () => {
      await runStore.create({
        id: randomUUID(), seed: 42, merchantCount: 5,
        eventsPerMerchant: 200, totalEvents: 1000, status: 'completed',
      });
      await runStore.create({
        id: randomUUID(), seed: 77, merchantCount: 5,
        eventsPerMerchant: 200, totalEvents: 1000, status: 'running',
      });

      const runs = await judgeService.listRuns();
      expect(runs.length).toBe(2);
    });

    it('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        await runStore.create({
          id: randomUUID(), seed: i, merchantCount: 5,
          eventsPerMerchant: 200, totalEvents: 1000, status: 'completed',
        });
      }

      const runs = await judgeService.listRuns(3);
      expect(runs.length).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // E — Delete run
  // -------------------------------------------------------------------------
  describe('E — Delete run', () => {
    it('deletes existing run', async () => {
      const run = await runStore.create({
        id: randomUUID(), seed: 42, merchantCount: 5,
        eventsPerMerchant: 200, totalEvents: 1000, status: 'completed',
      });

      const deleted = await judgeService.deleteRun(run.id);
      expect(deleted).toBe(true);

      const status = await judgeService.getRunStatus(run.id);
      expect(status).toBeNull();
    });

    it('returns false for non-existent run', async () => {
      const deleted = await judgeService.deleteRun(randomUUID());
      expect(deleted).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // F — Scenarios configuration
  // -------------------------------------------------------------------------
  describe('F — Scenarios configuration', () => {
    it('all scenarios have required fields', async () => {
      const { JUDGE_SCENARIOS } = await import('../../src/simulation/judge-scenarios.js');
      for (const scenario of JUDGE_SCENARIOS) {
        expect(scenario.id).toBeDefined();
        expect(scenario.name).toBeDefined();
        expect(scenario.description).toBeDefined();
        expect(scenario.defaultEvents).toBeGreaterThan(0);
        expect(scenario.defaultMerchantCount).toBeGreaterThan(0);
        expect(scenario.defaultSeed).toBeGreaterThanOrEqual(0);
      }
    });

    it('has exactly 4 scenarios', async () => {
      const { JUDGE_SCENARIOS } = await import('../../src/simulation/judge-scenarios.js');
      expect(JUDGE_SCENARIOS.length).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // G — isRunning
  // -------------------------------------------------------------------------
  describe('G — isRunning', () => {
    it('returns false when no runs exist', async () => {
      const running = await judgeService.isRunning();
      expect(running).toBe(false);
    });

    it('returns true when a run is in progress', async () => {
      await runStore.create({
        id: randomUUID(), seed: 42, merchantCount: 5,
        eventsPerMerchant: 200, totalEvents: 1000, status: 'running',
      });

      const running = await judgeService.isRunning();
      expect(running).toBe(true);
    });
  });
});
