import type { AppDatabase } from '../lib/database.js';
import type { SimulationRunRow } from '../domain/simulation-run.js';

/**
 * Phase 13.3 — Simulation Analytics Service.
 *
 * Computes detailed analytics from persisted simulation run data.
 * All values come from actual database records — never fabricated.
 */

export interface SimulationAnalytics {
  runId: string;
  status: string;
  seed: number;

  dataset: {
    events: number;
    merchants: number;
    eventsPerMerchant: number;
  };

  payments: {
    total: number;
    successful: number;
    failed: number;
  };

  revenue: {
    atRisk: number;
    recoverable: number;
    recovered: number;
    recoveryRate: number;
  };

  recovery: {
    opportunitiesDetected: number;
    executionsAttempted: number;
    blocked: number;
    humanReview: number;
    recoveriesVerified: number;
  };

  performance: {
    durationMs: number | null;
    eventsPerSecond: number | null;
    startedAt: string | null;
    completedAt: string | null;
  };
}

export class SimulationAnalyticsService {
  constructor(private readonly db: AppDatabase) {}

  /**
   * Compute analytics for a completed simulation run.
   */
  async getAnalytics(runId: string): Promise<SimulationAnalytics | null> {
    const run = await this.db.simulationRun.findById(runId);
    if (!run) {
      return null;
    }

    return this.computeAnalytics(run);
  }

  /**
   * Compute analytics from a run row.
   */
  computeAnalytics(run: SimulationRunRow): SimulationAnalytics {
    const total = run.processedEvents || run.totalEvents;
    const successful = run.successfulPayments;
    const failed = run.failedPayments;

    const recoveryRate =
      run.revenueAtRisk > 0 ? run.recoveredRevenue / run.revenueAtRisk : 0;

    const durationMs = run.processingDurationMs ?? null;
    const eventsPerSecond =
      durationMs !== null && durationMs > 0
        ? (run.processedEvents / durationMs) * 1000
        : null;

    return {
      runId: run.id,
      status: run.status,
      seed: run.seed,

      dataset: {
        events: run.totalEvents,
        merchants: run.merchantCount,
        eventsPerMerchant: run.eventsPerMerchant,
      },

      payments: {
        total,
        successful,
        failed,
      },

      revenue: {
        atRisk: run.revenueAtRisk,
        recoverable: run.recoverableRevenue,
        recovered: run.recoveredRevenue,
        recoveryRate,
      },

      recovery: {
        opportunitiesDetected: run.opportunitiesDetected,
        executionsAttempted: run.executionsAttempted,
        blocked: run.executionsBlocked,
        humanReview: run.humanReviews,
        recoveriesVerified: run.recoveriesVerified,
      },

      performance: {
        durationMs,
        eventsPerSecond,
        startedAt: run.startedAt?.toISOString() ?? null,
        completedAt: run.completedAt?.toISOString() ?? null,
      },
    };
  }
}
