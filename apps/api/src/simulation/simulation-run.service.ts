import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../lib/database.js';
import type { SyntheticDatasetService } from './synthetic-data.service.js';
import type { SyntheticEventReplayService } from './synthetic-event-replay.service.js';
import type { SimulationRunRow, SimulationRunStatus } from '../domain/simulation-run.js';

/**
 * Phase 13.3 — Simulation Run Service.
 *
 * Orchestrates a full simulation: generate dataset → replay events → persist results.
 * Reuses all existing Phase 13.1/13.2 infrastructure.
 */

export const MAX_EVENTS = 10_000;
const DEFAULT_MERCHANT_COUNT = 10;

export interface SimulationRunConfig {
  seed: number;
  events: number;
  merchantCount?: number;
}

export interface StartRunResponse {
  runId: string;
  status: SimulationRunStatus;
  seed: number;
  totalEvents: number;
  merchantCount: number;
}

export class SimulationRunService {
  constructor(
    private readonly db: AppDatabase,
    private readonly datasetService: SyntheticDatasetService,
    private readonly replayService: SyntheticEventReplayService,
  ) {}

  /**
   * Start a simulation run. Creates the DB record, generates data, replays, and persists results.
   */
  async startRun(config: SimulationRunConfig): Promise<StartRunResponse> {
    // Validate
    if (config.events < 1) {
      throw new SimulationValidationError('Event count must be at least 1.');
    }
    if (config.events > MAX_EVENTS) {
      throw new SimulationValidationError(
        `Event count exceeds maximum of ${MAX_EVENTS}. Received: ${config.events}.`,
      );
    }

    // Check for concurrent run
    const runningRuns = await this.db.simulationRun.listRecent(10);
    const hasRunning = runningRuns.some((r) => r.status === 'running' || r.status === 'pending');
    if (hasRunning) {
      throw new SimulationValidationError('A simulation is already in progress. Please wait for it to complete.');
    }

    const merchantCount = config.merchantCount ?? DEFAULT_MERCHANT_COUNT;
    const eventsPerMerchant = Math.ceil(config.events / merchantCount);
    const runId = randomUUID();

    // Create DB record
    await this.db.simulationRun.create({
      id: runId,
      seed: config.seed,
      merchantCount,
      eventsPerMerchant,
      totalEvents: config.events,
      status: 'running',
    });

    try {
      // Update startedAt
      await this.db.simulationRun.update(runId, { startedAt: new Date() });

      // Generate dataset config — distribute events across merchants
      const datasetConfig = this.datasetService.createConfig(config.seed, {
        merchantCount,
        customersPerMerchant: Math.max(5, Math.ceil(eventsPerMerchant / 10)),
        paymentsPerMerchant: eventsPerMerchant,
      });

      // Step 1: Generate dataset and persist payment events
      const persistResult = await this.datasetService.generateAndPersist(
        datasetConfig,
        DEMO_MERCHANT_ID,
        DEMO_PAYMENT_ACCOUNT_ID,
      );

      // Step 2: Replay through the existing pipeline
      const replayResult = await this.replayService.startReplay({
        datasetRunId: persistResult.runId,
        speed: 'instant',
        batchSize: 100,
        merchantId: DEMO_MERCHANT_ID,
      });

      // Step 3: Get final replay status for metrics
      const replayStatus = this.replayService.getReplayStatus(replayResult.replayId);

      // Step 4: Compute revenueAtRisk from failed payment volume
      const revenueAtRisk = persistResult.failedPaymentVolume;
      const recoveredRevenue = replayStatus?.recoveredAmount ?? 0;
      const recoverableRevenue = replayStatus?.recoverableRevenue ?? 0;

      // Step 5: Persist aggregate results
      const now = new Date();
      await this.db.simulationRun.update(runId, {
        status: 'completed',
        completedAt: now,
        processingDurationMs: replayStatus
          ? new Date(replayStatus.completedAt ?? now).getTime() - new Date(replayStatus.startedAt ?? now).getTime()
          : 0,
        processedEvents: replayStatus?.processedEvents ?? 0,
        successfulPayments: persistResult.successfulPayments,
        failedPayments: persistResult.failedPayments,
        opportunitiesDetected: replayStatus?.opportunitiesDetected ?? 0,
        executionsAttempted: replayStatus?.executionsAttempted ?? 0,
        executionsBlocked: replayStatus?.executionsBlocked ?? 0,
        humanReviews: replayStatus?.humanReviews ?? 0,
        recoveriesVerified: replayStatus?.recoveriesVerified ?? 0,
        revenueAtRisk,
        recoverableRevenue,
        recoveredRevenue,
      });

      return {
        runId,
        status: 'completed',
        seed: config.seed,
        totalEvents: config.events,
        merchantCount,
      };
    } catch (error) {
      await this.db.simulationRun.update(runId, {
        status: 'failed',
        completedAt: new Date(),
      });
      throw new SimulationRunError(
        `Simulation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get the status of a simulation run.
   */
  async getRunStatus(runId: string): Promise<SimulationRunRow | null> {
    return this.db.simulationRun.findById(runId);
  }

  /**
   * List recent simulation runs.
   */
  async listRuns(limit = 20): Promise<SimulationRunRow[]> {
    return this.db.simulationRun.listRecent(limit);
  }

  /**
   * Delete a simulation run.
   */
  async deleteRun(runId: string): Promise<boolean> {
    return this.db.simulationRun.deleteById(runId);
  }

  /**
   * Check if a simulation is currently running.
   */
  async isRunning(): Promise<boolean> {
    const recent = await this.db.simulationRun.listRecent(5);
    return recent.some((r) => r.status === 'running' || r.status === 'pending');
  }
}

const DEMO_MERCHANT_ID = '00000000-0000-4000-8000-000000000099';
const DEMO_PAYMENT_ACCOUNT_ID = '00000000-0000-4000-8000-000000000098';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class SimulationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulationValidationError';
  }
}

export class SimulationRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulationRunError';
  }
}
