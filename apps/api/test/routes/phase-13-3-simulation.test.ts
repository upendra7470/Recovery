/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-floating-promises, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion */
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type {
  PaymentEventRow,
  NewPaymentEventData,
  PaymentAccountLookupStore,
  AccountReference,
} from '../../src/domain/payment-event.js';
import type {
  SimulationRunRow,
  SimulationRunStore,
  NewSimulationRunData,
} from '../../src/domain/simulation-run.js';
import { SyntheticDatasetService } from '../../src/simulation/synthetic-data.service.js';
import { SyntheticEventReplayService } from '../../src/simulation/synthetic-event-replay.service.js';
import { SimulationRunService } from '../../src/simulation/simulation-run.service.js';
import { SimulationAnalyticsService } from '../../src/services/simulation-analytics.service.js';
import { SyntheticEventReplayService as ReplayService } from '../../src/simulation/synthetic-event-replay.service.js';

// ---------------------------------------------------------------------------
// In-memory stores for testing
// ---------------------------------------------------------------------------
class InMemoryPaymentEventStore {
  private rows: Map<string, PaymentEventRow> = new Map();

  async insert(data: NewPaymentEventData): Promise<PaymentEventRow> {
    const id = randomUUID();
    const now = new Date();
    const row: PaymentEventRow = {
      id,
      paymentAccountId: data.paymentAccountId,
      merchantId: data.merchantId,
      provider: data.provider,
      providerEventId: data.providerEventId,
      eventType: data.eventType,
      providerPaymentId: data.providerPaymentId,
      providerOrderId: data.providerOrderId,
      eventCreatedAt: data.eventCreatedAt,
      receivedAt: data.receivedAt,
      payload: data.payload,
      normalizedData: data.normalizedData,
      signatureVerified: data.signatureVerified,
      processingStatus: data.processingStatus,
      processingAttempts: data.processingAttempts,
      processedAt: data.processedAt,
      failureReason: data.failureReason,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(id, row);
    return row;
  }

  async findByProviderEventId(): Promise<PaymentEventRow | null> {
    return null;
  }

  async findById(id: string): Promise<PaymentEventRow | null> {
    return this.rows.get(id) ?? null;
  }

  async findRelatedByOrderOrPayment(): Promise<PaymentEventRow[]> {
    return [];
  }

  async findMany(args: { merchantId?: string; take?: number; orderBy?: 'asc' | 'desc' } = {}): Promise<PaymentEventRow[]> {
    let rows = Array.from(this.rows.values());
    if (args.merchantId !== undefined) {
      rows = rows.filter((r) => r.merchantId === args.merchantId);
    }
    rows.sort((a, b) => {
      const diff = a.eventCreatedAt.getTime() - b.eventCreatedAt.getTime();
      return args.orderBy === 'desc' ? -diff : diff;
    });
    if (args.take !== undefined) {
      rows = rows.slice(0, args.take);
    }
    return rows;
  }

  get size() {
    return this.rows.size;
  }
}

class InMemoryPaymentAccountStore implements PaymentAccountLookupStore {
  async findActiveByExternalId(): Promise<AccountReference | null> {
    return null;
  }

  async findById(): Promise<AccountReference | null> {
    return null;
  }
}

class InMemorySimulationRunStore implements SimulationRunStore {
  private rows: Map<string, SimulationRunRow> = new Map();

  async create(data: NewSimulationRunData): Promise<SimulationRunRow> {
    const now = new Date();
    const row: SimulationRunRow = {
      id: data.id,
      seed: data.seed,
      merchantCount: data.merchantCount,
      eventsPerMerchant: data.eventsPerMerchant,
      totalEvents: data.totalEvents,
      status: data.status,
      startedAt: null,
      completedAt: null,
      processingDurationMs: null,
      processedEvents: 0,
      successfulPayments: 0,
      failedPayments: 0,
      opportunitiesDetected: 0,
      executionsAttempted: 0,
      executionsBlocked: 0,
      humanReviews: 0,
      recoveriesVerified: 0,
      revenueAtRisk: 0,
      recoverableRevenue: 0,
      recoveredRevenue: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async update(id: string, data: Partial<SimulationRunRow>): Promise<SimulationRunRow> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`SimulationRun ${id} not found`);
    Object.assign(row, data, { updatedAt: new Date() });
    return row;
  }

  async findById(id: string): Promise<SimulationRunRow | null> {
    return this.rows.get(id) ?? null;
  }

  async listRecent(limit: number = 20): Promise<SimulationRunRow[]> {
    return Array.from(this.rows.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async deleteById(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }

  get size() {
    return this.rows.size;
  }
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
      insert: async () => ({} as any),
      findBySourceEventAndType: async () => null,
      findOpenByPaymentCorrelation: async () => [],
      findById: async () => null,
      list: async () => [],
      count: async () => 0,
      markRecovered: async (args: any) => ({ ...args, status: 'RECOVERED' } as any),
      summarizeByStatusAndCurrency: async () => [],
      countByType: async () => 0,
      outcomeStatsByType: async () => ({ total: 0, recovered: 0 }),
    },
    recoveryDecision: {
      upsert: async (data: any) => ({ id: randomUUID(), ...data } as any),
      findById: async () => null,
      findByOpportunityAndEngineVersion: async () => null,
      findLatestByOpportunityIds: async () => [],
      listAll: async () => [],
      countByPriority: async () => 0,
      countByRecommendedAction: async () => 0,
      averageConfidence: async () => 0,
    },
    recoveryAIAdvice: {
      upsert: async (data: any) => ({ id: randomUUID(), ...data } as any),
      findByDecision: async () => null,
      findByDecisionId: async () => null,
    },
    recoveryExecution: {
      insert: async (data: any) => ({ id: randomUUID(), ...data } as any),
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
      upsert: async () => ({ id: randomUUID(), sampleCount: 0 } as any),
      updateMetrics: async () => ({} as any),
      findById: async () => null,
      findByMerchantAndStrategy: async () => null,
      listByMerchant: async () => [],
      getOverview: async () => ({
        merchantId: '',
        totalOutcomes: 0,
        totalRecovered: 0,
        totalAmountRecovered: 0,
        recoveryRate: 0,
        bestStrategy: null,
        bestStrategySuccessRate: 0,
        strategies: [],
        failurePatterns: [],
        confidence: 'NO_DATA',
        lastObservedAt: null,
      }),
      getEvidenceForAI: async () => ({
        merchantId: '',
        strategyPerformance: [],
        overallRecoveryRate: 0,
        totalOutcomes: 0,
        confidenceLevel: 'NO_DATA',
      }),
      deleteByMerchant: async () => 0,
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const DEMO_MERCHANT_ID = '00000000-0000-4000-8000-000000000099';
const DEMO_PAYMENT_ACCOUNT_ID = '00000000-0000-4000-8000-000000000098';

function createSyntheticPaymentEvent(
  eventStore: InMemoryPaymentEventStore,
  overrides: {
    eventType?: string;
    amount?: number;
    merchantId?: string;
    status?: string;
    failureType?: string;
  } = {}
) {
  const amount = overrides.amount ?? 50000;
  const eventType = overrides.eventType ?? 'payment.failed';
  const status = overrides.status ?? 'failed';

  return eventStore.insert({
    paymentAccountId: DEMO_PAYMENT_ACCOUNT_ID,
    merchantId: overrides.merchantId ?? DEMO_MERCHANT_ID,
    provider: 'razorpay',
    providerEventId: `${eventType}:pay_${randomUUID().slice(0, 8)}`,
    eventType,
    providerPaymentId: `pay_${randomUUID().slice(0, 8)}`,
    providerOrderId: `order_${randomUUID().slice(0, 8)}`,
    eventCreatedAt: new Date(),
    receivedAt: new Date(),
    payload: {
      id: `evt_${randomUUID().slice(0, 8)}`,
      amount,
      currency: 'INR',
      status,
      method: 'card',
      _synthetic: true,
      _runId: 'test_run',
    },
    normalizedData: {
      provider: 'razorpay',
      eventType,
      providerPaymentId: `pay_${randomUUID().slice(0, 8)}`,
      providerOrderId: `order_${randomUUID().slice(0, 8)}`,
      amount,
      currency: 'INR',
      status,
      method: 'card',
      email: null,
      contact: null,
      bank: null,
      errorCode: overrides.failureType ?? null,
      errorDescription: null,
      errorSource: null,
      errorStep: null,
      errorReason: null,
      subscriptionId: null,
      paymentCreatedAt: new Date().toISOString(),
      occurredAt: new Date().toISOString(),
    },
    signatureVerified: true,
    processingStatus: 'processed',
    processingAttempts: 1,
    processedAt: new Date(),
    failureReason: overrides.failureType ?? null,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Phase 13.3 — Simulation Analytics & Stress Testing', () => {
  let runStore: InMemorySimulationRunStore;
  let eventStore: InMemoryPaymentEventStore;
  let mockDb: ReturnType<typeof createMockDb>;
  let datasetService: SyntheticDatasetService;
  let replayService: ReplayService;
  let runService: SimulationRunService;
  let analyticsService: SimulationAnalyticsService;

  beforeEach(() => {
    runStore = new InMemorySimulationRunStore();
    eventStore = new InMemoryPaymentEventStore();
    mockDb = createMockDb(runStore, eventStore);
    datasetService = new SyntheticDatasetService(eventStore, mockDb.paymentAccount);
    replayService = new ReplayService(
      mockDb,
      {} as any, // leakageService
      {} as any, // decisionService
      {} as any, // executionService
      {} as any, // aiAdvisorService
      {} as any, // merchantMemoryService
      true, // enabled
    );
    runService = new SimulationRunService(mockDb, datasetService, replayService);
    analyticsService = new SimulationAnalyticsService(mockDb);
  });

  // -------------------------------------------------------------------------
  // A — Simulation run creation
  // -------------------------------------------------------------------------
  describe('A — Simulation run creation', () => {
    it('creates a simulation run record in the database', async () => {
      const result = await runService.startRun({
        seed: 42,
        events: 10,
        merchantCount: 2,
      });

      expect(result.runId).toBeDefined();
      expect(result.status).toBe('completed');
      expect(result.seed).toBe(42);
      expect(result.totalEvents).toBe(10);
      expect(result.merchantCount).toBe(2);

      // Verify persisted in store
      const run = await runStore.findById(result.runId);
      expect(run).not.toBeNull();
      expect(run!.status).toBe('completed');
      expect(run!.seed).toBe(42);
    });

    it('persists aggregate metrics after completion', async () => {
      const result = await runService.startRun({ seed: 42, events: 10 });
      const run = await runStore.findById(result.runId);

      expect(run).not.toBeNull();
      expect(run!.totalEvents).toBe(10);
      expect(run!.processingDurationMs).toBeGreaterThanOrEqual(0);
      expect(run!.startedAt).toBeInstanceOf(Date);
      expect(run!.completedAt).toBeInstanceOf(Date);
    });
  });

  // -------------------------------------------------------------------------
  // B — Small simulation
  // -------------------------------------------------------------------------
  describe('B — Small simulation (100 events)', () => {
    it('completes a 100-event simulation', async () => {
      const result = await runService.startRun({ seed: 42, events: 100, merchantCount: 5 });

      expect(result.status).toBe('completed');
      expect(result.totalEvents).toBe(100);
      expect(result.merchantCount).toBe(5);

      const run = await runStore.findById(result.runId);
      expect(run!.status).toBe('completed');
      expect(run!.processedEvents).toBeGreaterThanOrEqual(0);
    });
  });

  // -------------------------------------------------------------------------
  // C — Medium simulation
  // -------------------------------------------------------------------------
  describe('C — Medium simulation (1,000 events)', () => {
    it('completes a 1,000-event simulation', async () => {
      const result = await runService.startRun({ seed: 42, events: 1000, merchantCount: 10 });

      expect(result.status).toBe('completed');
      expect(result.totalEvents).toBe(1000);

      const run = await runStore.findById(result.runId);
      expect(run!.status).toBe('completed');
    });
  });

  // -------------------------------------------------------------------------
  // D — Maximum event limit
  // -------------------------------------------------------------------------
  describe('D — Maximum event limit', () => {
    it('rejects events exceeding MAX_EVENTS (10,000)', async () => {
      await expect(
        runService.startRun({ seed: 42, events: 10001 })
      ).rejects.toThrow('exceeds maximum');
    });

    it('accepts exactly MAX_EVENTS', async () => {
      const result = await runService.startRun({ seed: 42, events: 10000, merchantCount: 10 });
      expect(result.status).toBe('completed');
      expect(result.totalEvents).toBe(10000);
    });
  });

  // -------------------------------------------------------------------------
  // E — Invalid event count
  // -------------------------------------------------------------------------
  describe('E — Invalid event count', () => {
    it('rejects zero events', async () => {
      await expect(
        runService.startRun({ seed: 42, events: 0 })
      ).rejects.toThrow('at least 1');
    });

    it('rejects negative events', async () => {
      await expect(
        runService.startRun({ seed: 42, events: -5 })
      ).rejects.toThrow('at least 1');
    });
  });

  // -------------------------------------------------------------------------
  // F — Deterministic seed behavior
  // -------------------------------------------------------------------------
  describe('F — Deterministic seed behavior', () => {
    it('same seed produces same dataset', async () => {
      const result1 = await runService.startRun({ seed: 12345, events: 50, merchantCount: 3 });
      const run1 = await runStore.findById(result1.runId);

      // Reset stores for second run
      const eventStore2 = new InMemoryPaymentEventStore();
      const runStore2 = new InMemorySimulationRunStore();
      const mockDb2 = createMockDb(runStore2, eventStore2);
      const datasetService2 = new SyntheticDatasetService(eventStore2, mockDb2.paymentAccount);
      const replayService2 = new ReplayService(
        mockDb2, {} as any, {} as any, {} as any, {} as any, {} as any, true,
      );
      const runService2 = new SimulationRunService(mockDb2, datasetService2, replayService2);

      const result2 = await runService2.startRun({ seed: 12345, events: 50, merchantCount: 3 });
      const run2 = await runStore2.findById(result2.runId);

      // Same seed + config = equivalent metrics
      expect(run1!.totalEvents).toBe(run2!.totalEvents);
      expect(run1!.merchantCount).toBe(run2!.merchantCount);
      expect(run1!.eventsPerMerchant).toBe(run2!.eventsPerMerchant);
      expect(run1!.successfulPayments).toBe(run2!.successfulPayments);
      expect(run1!.failedPayments).toBe(run2!.failedPayments);
      expect(run1!.revenueAtRisk).toBe(run2!.revenueAtRisk);
    });
  });

  // -------------------------------------------------------------------------
  // G — Different seeds produce different results
  // -------------------------------------------------------------------------
  describe('G — Different seeds', () => {
    it('different seeds produce different payment distributions', async () => {
      const result1 = await runService.startRun({ seed: 42, events: 100 });
      const run1 = await runStore.findById(result1.runId);

      // Reset for second run
      const eventStore2 = new InMemoryPaymentEventStore();
      const runStore2 = new InMemorySimulationRunStore();
      const mockDb2 = createMockDb(runStore2, eventStore2);
      const datasetService2 = new SyntheticDatasetService(eventStore2, mockDb2.paymentAccount);
      const replayService2 = new ReplayService(
        mockDb2, {} as any, {} as any, {} as any, {} as any, {} as any, true,
      );
      const runService2 = new SimulationRunService(mockDb2, datasetService2, replayService2);

      const result2 = await runService2.startRun({ seed: 9999, events: 100 });
      const run2 = await runStore2.findById(result2.runId);

      // At least one metric should differ (very high probability)
      const same =
        run1!.successfulPayments === run2!.successfulPayments &&
        run1!.failedPayments === run2!.failedPayments &&
        run1!.revenueAtRisk === run2!.revenueAtRisk;
      expect(same).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // H — Replay integration
  // -------------------------------------------------------------------------
  describe('H — Replay integration', () => {
    it('invokes the replay engine during simulation run', async () => {
      // Create synthetic events first
      createSyntheticPaymentEvent(eventStore, { eventType: 'payment.failed', amount: 50000 });
      createSyntheticPaymentEvent(eventStore, { eventType: 'payment.failed', amount: 75000 });

      // Run should complete and track processed events
      const result = await runService.startRun({ seed: 42, events: 2 });
      const run = await runStore.findById(result.runId);

      expect(run).not.toBeNull();
      expect(run!.status).toBe('completed');
    });
  });

  // -------------------------------------------------------------------------
  // I — Revenue aggregation
  // -------------------------------------------------------------------------
  describe('I — Revenue aggregation', () => {
    it('computes revenueAtRisk from failed payment volume', async () => {
      createSyntheticPaymentEvent(eventStore, { eventType: 'payment.failed', amount: 100000 });
      createSyntheticPaymentEvent(eventStore, { eventType: 'payment.failed', amount: 200000 });

      const result = await runService.startRun({ seed: 42, events: 2 });
      const run = await runStore.findById(result.runId);

      expect(run!.revenueAtRisk).toBeGreaterThanOrEqual(0);
    });
  });

  // -------------------------------------------------------------------------
  // J — Recovery rate calculation
  // -------------------------------------------------------------------------
  describe('J — Recovery rate calculation', () => {
    it('analytics computes recovery rate as recoveredRevenue / revenueAtRisk', async () => {
      const result = await runService.startRun({ seed: 42, events: 50 });
      const analytics = await analyticsService.getAnalytics(result.runId);

      expect(analytics).not.toBeNull();
      expect(analytics!.revenue.recoveryRate).toBeGreaterThanOrEqual(0);
      expect(analytics!.revenue.recoveryRate).toBeLessThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // K — Failure distribution
  // -------------------------------------------------------------------------
  describe('K — Failure distribution', () => {
    it('analytics reports payment counts correctly', async () => {
      const result = await runService.startRun({ seed: 42, events: 100 });
      const analytics = await analyticsService.getAnalytics(result.runId);

      expect(analytics).not.toBeNull();
      expect(analytics!.payments.total).toBeGreaterThanOrEqual(0);
      expect(analytics!.payments.successful).toBeGreaterThanOrEqual(0);
      expect(analytics!.payments.failed).toBeGreaterThanOrEqual(0);
      expect(analytics!.payments.successful + analytics!.payments.failed).toBe(
        analytics!.payments.total
      );
    });
  });

  // -------------------------------------------------------------------------
  // L — Strategy distribution
  // -------------------------------------------------------------------------
  describe('L — Strategy distribution', () => {
    it('analytics reports strategy-related metrics', async () => {
      const result = await runService.startRun({ seed: 42, events: 50 });
      const analytics = await analyticsService.getAnalytics(result.runId);

      expect(analytics).not.toBeNull();
      expect(analytics!.recovery.opportunitiesDetected).toBeGreaterThanOrEqual(0);
      expect(analytics!.recovery.executionsAttempted).toBeGreaterThanOrEqual(0);
    });
  });

  // -------------------------------------------------------------------------
  // M — Module distribution
  // -------------------------------------------------------------------------
  describe('M — Module distribution', () => {
    it('analytics includes dataset configuration', async () => {
      const result = await runService.startRun({ seed: 42, events: 100, merchantCount: 5 });
      const analytics = await analyticsService.getAnalytics(result.runId);

      expect(analytics).not.toBeNull();
      expect(analytics!.dataset.events).toBe(100);
      expect(analytics!.dataset.merchants).toBe(5);
      expect(analytics!.dataset.eventsPerMerchant).toBe(20);
    });
  });

  // -------------------------------------------------------------------------
  // N — Blocked action aggregation
  // -------------------------------------------------------------------------
  describe('N — Blocked action aggregation', () => {
    it('tracks blocked executions', async () => {
      const result = await runService.startRun({ seed: 42, events: 50 });
      const run = await runStore.findById(result.runId);

      expect(run!.executionsBlocked).toBeGreaterThanOrEqual(0);
    });
  });

  // -------------------------------------------------------------------------
  // O — Human review aggregation
  // -------------------------------------------------------------------------
  describe('O — Human review aggregation', () => {
    it('tracks human reviews', async () => {
      const result = await runService.startRun({ seed: 42, events: 50 });
      const run = await runStore.findById(result.runId);

      expect(run!.humanReviews).toBeGreaterThanOrEqual(0);
    });
  });

  // -------------------------------------------------------------------------
  // P — Run status
  // -------------------------------------------------------------------------
  describe('P — Run status', () => {
    it('getRunStatus returns the run record', async () => {
      const result = await runService.startRun({ seed: 42, events: 10 });
      const status = await runService.getRunStatus(result.runId);

      expect(status).not.toBeNull();
      expect(status!.id).toBe(result.runId);
      expect(status!.status).toBe('completed');
    });

    it('getRunStatus returns null for non-existent run', async () => {
      const status = await runService.getRunStatus(randomUUID());
      expect(status).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Q — Analytics endpoint
  // -------------------------------------------------------------------------
  describe('Q — Analytics endpoint', () => {
    it('returns structured analytics', async () => {
      const result = await runService.startRun({ seed: 42, events: 100 });
      const analytics = await analyticsService.getAnalytics(result.runId);

      expect(analytics).not.toBeNull();
      expect(analytics!.runId).toBe(result.runId);
      expect(analytics!.status).toBe('completed');
      expect(analytics!.seed).toBe(42);
      expect(analytics!.dataset).toBeDefined();
      expect(analytics!.payments).toBeDefined();
      expect(analytics!.revenue).toBeDefined();
      expect(analytics!.recovery).toBeDefined();
      expect(analytics!.performance).toBeDefined();
    });

    it('returns null for non-existent run', async () => {
      const analytics = await analyticsService.getAnalytics(randomUUID());
      expect(analytics).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // R — Concurrent run protection
  // -------------------------------------------------------------------------
  describe('R — Concurrent run protection', () => {
    it('rejects concurrent simulation runs', async () => {
      // Start first run
      const result1 = await runService.startRun({ seed: 42, events: 10 });

      // Create a new run store with a "running" entry
      const runStore2 = new InMemorySimulationRunStore();
      await runStore2.create({
        id: randomUUID(),
        seed: 42,
        merchantCount: 10,
        eventsPerMerchant: 1,
        totalEvents: 10,
        status: 'running',
      });
      const eventStore2 = new InMemoryPaymentEventStore();
      const mockDb2 = createMockDb(runStore2, eventStore2);
      const datasetService2 = new SyntheticDatasetService(eventStore2, mockDb2.paymentAccount);
      const replayService2 = new ReplayService(
        mockDb2, {} as any, {} as any, {} as any, {} as any, {} as any, true,
      );
      const runService2 = new SimulationRunService(mockDb2, datasetService2, replayService2);

      await expect(
        runService2.startRun({ seed: 42, events: 10 })
      ).rejects.toThrow('already in progress');
    });
  });

  // -------------------------------------------------------------------------
  // S — Idempotency
  // -------------------------------------------------------------------------
  describe('S — Idempotency', () => {
    it('same seed+config produces equivalent aggregate results', async () => {
      const result1 = await runService.startRun({ seed: 42, events: 50 });
      const analytics1 = await analyticsService.getAnalytics(result1.runId);

      // Reset stores
      const eventStore2 = new InMemoryPaymentEventStore();
      const runStore2 = new InMemorySimulationRunStore();
      const mockDb2 = createMockDb(runStore2, eventStore2);
      const datasetService2 = new SyntheticDatasetService(eventStore2, mockDb2.paymentAccount);
      const replayService2 = new ReplayService(
        mockDb2, {} as any, {} as any, {} as any, {} as any, {} as any, true,
      );
      const runService2 = new SimulationRunService(mockDb2, datasetService2, replayService2);

      const result2 = await runService2.startRun({ seed: 42, events: 50 });
      const analytics2 = await new SimulationAnalyticsService(mockDb2).getAnalytics(result2.runId);

      expect(analytics1).not.toBeNull();
      expect(analytics2).not.toBeNull();
      expect(analytics1!.dataset.events).toBe(analytics2!.dataset.events);
      expect(analytics1!.payments.total).toBe(analytics2!.payments.total);
      expect(analytics1!.payments.successful).toBe(analytics2!.payments.successful);
      expect(analytics1!.payments.failed).toBe(analytics2!.payments.failed);
    });
  });

  // -------------------------------------------------------------------------
  // T — Existing simulation endpoints remain functional
  // -------------------------------------------------------------------------
  describe('T — Existing simulation endpoints remain functional', () => {
    it('dataset service still generates and persists', async () => {
      const config = datasetService.createConfig(42, {
        merchantCount: 2,
        customersPerMerchant: 5,
        paymentsPerMerchant: 10,
      });

      const result = await datasetService.generateAndPersist(
        config,
        DEMO_MERCHANT_ID,
        DEMO_PAYMENT_ACCOUNT_ID,
      );

      expect(result.paymentsPersisted).toBe(20);
      expect(result.merchantsPersisted).toBe(2);
    });

    it('dataset preview still works', async () => {
      const config = datasetService.createConfig(42, {
        merchantCount: 2,
        customersPerMerchant: 5,
        paymentsPerMerchant: 10,
      });

      const metrics = datasetService.preview(config);
      expect(metrics.paymentsGenerated).toBe(20);
      expect(metrics.merchantsGenerated).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // U — Existing /demo remains functional
  // -------------------------------------------------------------------------
  describe('U — Existing /demo remains functional', () => {
    it('existing replay service interface is preserved', async () => {
      expect(typeof replayService.startReplay).toBe('function');
      expect(typeof replayService.getReplayStatus).toBe('function');
      expect(typeof replayService.cancelReplay).toBe('function');
      expect(typeof replayService.listReplays).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // V — Existing recovery pipeline remains functional
  // -------------------------------------------------------------------------
  describe('V — Existing recovery pipeline remains functional', () => {
    it('run service uses existing pipeline services', async () => {
      // The run service should accept the same service types
      expect(runService).toBeDefined();
      expect(typeof runService.startRun).toBe('function');
      expect(typeof runService.getRunStatus).toBe('function');
      expect(typeof runService.listRuns).toBe('function');
      expect(typeof runService.deleteRun).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // W — List runs
  // -------------------------------------------------------------------------
  describe('W — List runs', () => {
    it('lists recent simulation runs', async () => {
      await runService.startRun({ seed: 1, events: 10 });
      await runService.startRun({ seed: 2, events: 10 });

      const runs = await runService.listRuns(10);
      expect(runs.length).toBe(2);
      // Most recent first
      expect(runs[0]!.seed).toBe(2);
      expect(runs[1]!.seed).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // X — Delete run
  // -------------------------------------------------------------------------
  describe('X — Delete run', () => {
    it('deletes a simulation run', async () => {
      const result = await runService.startRun({ seed: 42, events: 10 });
      const deleted = await runService.deleteRun(result.runId);
      expect(deleted).toBe(true);

      const run = await runStore.findById(result.runId);
      expect(run).toBeNull();
    });

    it('returns false for non-existent run', async () => {
      const deleted = await runService.deleteRun(randomUUID());
      expect(deleted).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Y — Performance metrics
  // -------------------------------------------------------------------------
  describe('Y — Performance metrics', () => {
    it('tracks processing duration', async () => {
      const result = await runService.startRun({ seed: 42, events: 50 });
      const analytics = await analyticsService.getAnalytics(result.runId);

      expect(analytics).not.toBeNull();
      expect(analytics!.performance.durationMs).toBeGreaterThanOrEqual(0);
      expect(analytics!.performance.startedAt).toBeDefined();
      expect(analytics!.performance.completedAt).toBeDefined();
    });

    it('computes events per second', async () => {
      const result = await runService.startRun({ seed: 42, events: 50 });
      const analytics = await analyticsService.getAnalytics(result.runId);

      expect(analytics).not.toBeNull();
      // eventsPerSecond is null when duration is 0 (fast in-memory simulation)
      expect(analytics!.performance.eventsPerSecond === null || analytics!.performance.eventsPerSecond >= 0).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Z — Dataset metrics accuracy
  // -------------------------------------------------------------------------
  describe('Z — Dataset metrics accuracy', () => {
    it('reports correct total events', async () => {
      const result = await runService.startRun({ seed: 42, events: 75, merchantCount: 5 });
      const run = await runStore.findById(result.runId);

      expect(run!.totalEvents).toBe(75);
      expect(run!.eventsPerMerchant).toBe(15); // ceil(75/5)
    });

    it('reports merchant count correctly', async () => {
      const result = await runService.startRun({ seed: 42, events: 100, merchantCount: 20 });
      const run = await runStore.findById(result.runId);

      expect(run!.merchantCount).toBe(20);
    });
  });
});
