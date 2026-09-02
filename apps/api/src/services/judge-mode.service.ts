import type { AppDatabase } from '../lib/database.js';
import type { SimulationRunRow } from '../domain/simulation-run.js';
import { SyntheticDatasetService } from '../simulation/synthetic-data.service.js';
import { SyntheticEventReplayService } from '../simulation/synthetic-event-replay.service.js';
import { SimulationRunService } from '../simulation/simulation-run.service.js';
import { SimulationAnalyticsService } from './simulation-analytics.service.js';
import {
  getJudgeScenario,
  isValidJudgeScenarioId,
  type JudgeScenarioId,
} from '../simulation/judge-scenarios.js';
import type { RevenueLeakageService } from './revenue-leakage.service.js';
import type { RecoveryDecisionService } from './recovery-decision.service.js';
import type { RecoveryExecutionService } from './recovery-execution.service.js';
import type { RecoveryAIAdvisorService } from './recovery-ai-advisor.service.js';
import type { MerchantMemoryService } from './merchant-memory.service.js';

/**
 * Phase 15 — Judge Mode Service.
 *
 * Thin orchestrator over existing SimulationRunService with scenario presets.
 * Does NOT implement recovery logic — delegates entirely to existing pipeline.
 */

export interface JudgeStartRequest {
  scenario: string;
  seed?: number;
  events?: number;
  merchantCount?: number;
}

export interface JudgeStartResponse {
  runId: string;
  scenario: JudgeScenarioId;
  status: SimulationRunRow['status'];
  seed: number;
  totalEvents: number;
  merchantCount: number;
}

export interface JudgeStatusResponse {
  runId: string;
  scenario: JudgeScenarioId;
  status: SimulationRunRow['status'];
  progress: number;
  totalEvents: number;
  processedEvents: number;
  failedEvents: number;
  revenueAtRisk: number;
  recoverableRevenue: number;
  recoveredRevenue: number;
  recoveryRate: number;
  opportunitiesDetected: number;
  executionsAttempted: number;
  executionsBlocked: number;
  humanReviews: number;
  recoveriesVerified: number;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  recentEvents: unknown[];
}

export class JudgeModeService {
  private readonly runService: SimulationRunService;
  private readonly replayService: SyntheticEventReplayService;
  private readonly analyticsService: SimulationAnalyticsService;

  constructor(
    private readonly db: AppDatabase,
    private readonly leakageService: RevenueLeakageService,
    private readonly decisionService: RecoveryDecisionService,
    private readonly executionService: RecoveryExecutionService,
    private readonly aiAdvisorService: RecoveryAIAdvisorService,
    private readonly merchantMemoryService: MerchantMemoryService,
  ) {
    const datasetService = new SyntheticDatasetService(
      db.paymentEvent,
      db.paymentAccount,
    );
    this.replayService = new SyntheticEventReplayService(
      db,
      leakageService,
      decisionService,
      executionService,
      aiAdvisorService,
      merchantMemoryService,
      true, // enabled (DEMO_MODE)
    );
    this.runService = new SimulationRunService(db, datasetService, this.replayService);
    this.analyticsService = new SimulationAnalyticsService(db);
  }

  /**
   * Start a judge scenario. Maps scenario config to SimulationRunConfig
   * and delegates to the existing SimulationRunService.
   */
  async startScenario(request: JudgeStartRequest): Promise<JudgeStartResponse> {
    if (!isValidJudgeScenarioId(request.scenario)) {
      throw new JudgeModeError(
        `Invalid scenario: ${request.scenario}. Valid scenarios: payment-failure-storm, gateway-degradation, mixed-recovery, recovery-stress`,
      );
    }

    const scenario = getJudgeScenario(request.scenario);
    if (scenario === undefined) {
      throw new JudgeModeError(`Scenario configuration not found: ${request.scenario}`);
    }

    const result = await this.runService.startRun({
      seed: request.seed ?? scenario.defaultSeed,
      events: request.events ?? scenario.defaultEvents,
      merchantCount: request.merchantCount ?? scenario.defaultMerchantCount,
    });

    return {
      runId: result.runId,
      scenario: request.scenario,
      status: result.status,
      seed: result.seed,
      totalEvents: result.totalEvents,
      merchantCount: result.merchantCount,
    };
  }

  /**
   * Get judge run status. Combines DB record with replay event data.
   */
  async getRunStatus(runId: string): Promise<JudgeStatusResponse | null> {
    const run = await this.runService.getRunStatus(runId);
    if (run === null) {
      return null;
    }

    const progress = run.totalEvents > 0
      ? Math.round((run.processedEvents / run.totalEvents) * 100)
      : 0;

    const recoveryRate = run.recoverableRevenue > 0
      ? run.recoveredRevenue / run.recoverableRevenue
      : 0;

    const recentEvents = this.getRecentEvents();

    return {
      runId: run.id,
      scenario: 'mixed-recovery',
      status: run.status,
      progress,
      totalEvents: run.totalEvents,
      processedEvents: run.processedEvents,
      failedEvents: run.failedPayments,
      revenueAtRisk: run.revenueAtRisk,
      recoverableRevenue: run.recoverableRevenue,
      recoveredRevenue: run.recoveredRevenue,
      recoveryRate,
      opportunitiesDetected: run.opportunitiesDetected,
      executionsAttempted: run.executionsAttempted,
      executionsBlocked: run.executionsBlocked,
      humanReviews: run.humanReviews,
      recoveriesVerified: run.recoveriesVerified,
      durationMs: run.processingDurationMs,
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      createdAt: run.createdAt.toISOString(),
      recentEvents,
    };
  }

  /**
   * List recent judge runs.
   */
  async listRuns(limit?: number): Promise<SimulationRunRow[]> {
    return this.runService.listRuns(limit);
  }

  /**
   * Get analytics for a completed run.
   */
  async getAnalytics(runId: string) {
    return this.analyticsService.getAnalytics(runId);
  }

  /**
   * Delete a judge run.
   */
  async deleteRun(runId: string): Promise<boolean> {
    return this.runService.deleteRun(runId);
  }

  /**
   * Check if a scenario is currently running.
   */
  async isRunning(): Promise<boolean> {
    return this.runService.isRunning();
  }

  /**
   * Best-effort extraction of recent events from the replay service.
   */
  private getRecentEvents(): unknown[] {
    try {
      const replays = this.replayService.listReplays();
      if (replays.length === 0) return [];
      const latest = replays[replays.length - 1];
      if (!latest) return [];
      const status = this.replayService.getReplayStatus(latest.replayId);
      return status?.recentEvents ?? [];
    } catch {
      return [];
    }
  }
}

export class JudgeModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JudgeModeError';
  }
}
