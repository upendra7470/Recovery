/**
 * Simulation Run — Domain types and store boundary.
 *
 * A SimulationRun is a persistent record of a completed or running simulation.
 * It stores configuration and aggregate results for analytics.
 */

export type SimulationRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface SimulationRunRow {
  id: string;
  seed: number;
  merchantCount: number;
  eventsPerMerchant: number;
  totalEvents: number;
  status: SimulationRunStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  processingDurationMs: number | null;
  processedEvents: number;
  successfulPayments: number;
  failedPayments: number;
  opportunitiesDetected: number;
  executionsAttempted: number;
  executionsBlocked: number;
  humanReviews: number;
  recoveriesVerified: number;
  revenueAtRisk: number;
  recoverableRevenue: number;
  recoveredRevenue: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewSimulationRunData {
  id: string;
  seed: number;
  merchantCount: number;
  eventsPerMerchant: number;
  totalEvents: number;
  status: SimulationRunStatus;
}

export interface SimulationRunStore {
  create(data: NewSimulationRunData): Promise<SimulationRunRow>;
  update(id: string, data: Partial<SimulationRunRow>): Promise<SimulationRunRow>;
  findById(id: string): Promise<SimulationRunRow | null>;
  listRecent(limit: number): Promise<SimulationRunRow[]>;
  deleteById(id: string): Promise<boolean>;
}
