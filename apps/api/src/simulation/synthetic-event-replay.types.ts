/**
 * Phase 13.2 — Synthetic Event Replay Engine Types.
 *
 * Defines the structures for replaying synthetic payment events through
 * the existing RecoveryOS pipeline.
 */

/** Replay run status. */
export type ReplayStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/** Replay speed mode. */
export type ReplaySpeed = 'instant' | 'fast' | 'realtime';

/** Configuration for a replay run. */
export interface ReplayConfig {
  /** The dataset run ID to replay. */
  datasetRunId: string;
  /** Replay speed mode. */
  speed: ReplaySpeed;
  /** Batch size for processing events. */
  batchSize: number;
  /** Optional: limit to specific merchant ID. */
  merchantId?: string;
}

/** Result of processing a single event through the pipeline. */
export interface ReplayEventResult {
  /** The payment event ID. */
  eventId: string;
  /** Event type (payment.failed, payment.captured). */
  eventType: string;
  /** Amount in paise. */
  amount: number;
  /** Currency. */
  currency: string;
  /** Provider payment ID. */
  providerPaymentId: string | null;
  /** Provider order ID. */
  providerOrderId: string | null;
  /** Detection outcome. */
  detectionOutcome: string;
  /** Opportunity ID if created. */
  opportunityId: string | null;
  /** Decision action if determined. */
  decisionAction: string | null;
  /** Decision score if determined. */
  decisionScore: number | null;
  /** Execution outcome if attempted. */
  executionOutcome: string | null;
  /** Execution status if created. */
  executionStatus: string | null;
  /** Whether recovery was verified. */
  recovered: boolean;
  /** Recovered amount if verified. */
  recoveredAmount: number;
  /** Error message if failed. */
  error: string | null;
  /** Processing timestamp. */
  processedAt: Date;
}

/** Aggregate statistics for a replay run. */
export interface ReplayStatistics {
  /** Total events in the dataset. */
  totalEvents: number;
  /** Events processed so far. */
  processedEvents: number;
  /** Events that failed processing. */
  failedEvents: number;
  /** Opportunities detected. */
  opportunitiesDetected: number;
  /** Executions attempted. */
  executionsAttempted: number;
  /** Executions blocked by safety gate. */
  executionsBlocked: number;
  /** Human reviews required. */
  humanReviews: number;
  /** Recoveries verified. */
  recoveriesVerified: number;
  /** Total recovered amount in paise. */
  recoveredAmount: number;
  /** Revenue at risk (total failed payment amount). */
  revenueAtRisk: number;
  /** Recoverable revenue (opportunities detected). */
  recoverableRevenue: number;
}

/** Complete replay run state. */
export interface ReplayRun {
  /** Unique replay ID. */
  replayId: string;
  /** The dataset run ID being replayed. */
  datasetRunId: string;
  /** Current status. */
  status: ReplayStatus;
  /** Replay configuration. */
  config: ReplayConfig;
  /** Aggregate statistics. */
  statistics: ReplayStatistics;
  /** Individual event results (for live feed). */
  eventResults: ReplayEventResult[];
  /** Error message if failed. */
  errorMessage: string | null;
  /** When the replay was created. */
  createdAt: Date;
  /** When the replay started processing. */
  startedAt: Date | null;
  /** When the replay completed. */
  completedAt: Date | null;
}

/** Request to start a replay. */
export interface StartReplayRequest {
  /** The dataset run ID to replay. */
  datasetRunId: string;
  /** Optional: replay speed (default: instant). */
  speed?: ReplaySpeed;
  /** Optional: batch size (default: 50). */
  batchSize?: number;
  /** Optional: limit to specific merchant. */
  merchantId?: string;
}

/** Response from starting a replay. */
export interface StartReplayResponse {
  /** The replay ID. */
  replayId: string;
  /** The dataset run ID. */
  datasetRunId: string;
  /** Initial status. */
  status: ReplayStatus;
  /** Total events to process. */
  totalEvents: number;
}

/** Response from getting replay status. */
export interface GetReplayResponse {
  /** The replay ID. */
  replayId: string;
  /** The dataset run ID. */
  datasetRunId: string;
  /** Current status. */
  status: ReplayStatus;
  /** Progress percentage (0-100). */
  progress: number;
  /** Total events. */
  totalEvents: number;
  /** Events processed. */
  processedEvents: number;
  /** Events failed. */
  failedEvents: number;
  /** Opportunities detected. */
  opportunitiesDetected: number;
  /** Executions attempted. */
  executionsAttempted: number;
  /** Executions blocked. */
  executionsBlocked: number;
  /** Human reviews. */
  humanReviews: number;
  /** Recoveries verified. */
  recoveriesVerified: number;
  /** Recovered amount in paise. */
  recoveredAmount: number;
  /** Revenue at risk. */
  revenueAtRisk: number;
  /** Recoverable revenue. */
  recoverableRevenue: number;
  /** Recent event results (last 20). */
  recentEvents: ReplayEventResult[];
  /** When created. */
  createdAt: string;
  /** When started. */
  startedAt: string | null;
  /** When completed. */
  completedAt: string | null;
  /** Error message if failed. */
  errorMessage: string | null;
}
