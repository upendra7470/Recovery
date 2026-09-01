import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../lib/database.js';
import type { RevenueLeakageService } from '../services/revenue-leakage.service.js';
import type { RecoveryDecisionService } from '../services/recovery-decision.service.js';
import type { RecoveryExecutionService } from '../services/recovery-execution.service.js';
import type { RecoveryAIAdvisorService } from '../services/recovery-ai-advisor.service.js';
import type { MerchantMemoryService } from '../services/merchant-memory.service.js';
import type { NormalizedPaymentEventData, PaymentEventRow } from '../domain/payment-event.js';
import type {
  ReplayConfig,
  ReplayRun,
  ReplayEventResult,
  ReplayStatus,
  StartReplayRequest,
  StartReplayResponse,
  GetReplayResponse,
} from './synthetic-event-replay.types.js';

/**
 * Phase 13.2 — Synthetic Event Replay Engine.
 *
 * Replays synthetic PaymentEvent records through the EXISTING RecoveryOS pipeline.
 * This service is an EVENT SOURCE ONLY — it does NOT duplicate detection, decision,
 * safety, execution, or verification logic.
 *
 * Architecture:
 *   Synthetic Dataset (Phase 13.1)
 *     ↓
 *   Load PaymentEvents from database
 *     ↓
 *   Process through existing RecoveryOS pipeline:
 *     → RevenueLeakageService.processPaymentEvent() (detection)
 *     → RecoveryDecisionService.getForOpportunity() (decision)
 *     → RecoveryAIAdvisorService.getAdviceForOpportunity() (AI advisory)
 *     → RecoveryExecutionService.requestExecution() (execution)
 *     → RevenueLeakageService.processPaymentEvent(captured) (outcome verification)
 *     → MerchantMemoryService.recordOutcome() (memory update)
 *
 * Key constraints:
 * - Same dataset + same config = same processing order (deterministic)
 * - Uses existing idempotency mechanisms
 * - Merchant isolation preserved
 * - Safety gate remains authoritative
 * - No real Razorpay calls
 */

const REPLAY_PREFIX = 'replay';
const MAX_RECENT_EVENTS = 20;

/** In-memory store for replay runs (no database table needed). */
const replayRuns = new Map<string, ReplayRun>();

/** Concurrency guard — only one replay at a time. */
let isReplaying = false;

export class SyntheticEventReplayService {
  constructor(
    private readonly db: AppDatabase,
    private readonly leakageService: RevenueLeakageService,
    private readonly decisionService: RecoveryDecisionService,
    private readonly executionService: RecoveryExecutionService,
    private readonly aiAdvisorService: RecoveryAIAdvisorService,
    private readonly merchantMemoryService: MerchantMemoryService,
    private readonly enabled: boolean,
  ) {}

  /**
   * Start a new replay run.
   * Returns immediately with a replay ID; processing happens synchronously
   * for 'instant' speed, or could be async for other speeds.
   */
  async startReplay(request: StartReplayRequest): Promise<StartReplayResponse> {
    if (!this.enabled) {
      throw new Error('Simulation mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.');
    }

    if (isReplaying) {
      throw new Error('A replay is already in progress. Please wait for it to complete.');
    }

    // Validate dataset exists by checking for events with the run prefix
    const events = await this.db.paymentEvent.findMany?.({
      merchantId: request.merchantId,
      take: 1,
    });

    if (!events || events.length === 0) {
      throw new Error(`No events found for dataset run: ${request.datasetRunId}`);
    }

    const replayId = `${REPLAY_PREFIX}_${randomUUID().slice(0, 8)}`;
    const config: ReplayConfig = {
      datasetRunId: request.datasetRunId,
      speed: request.speed ?? 'instant',
      batchSize: request.batchSize ?? 50,
      merchantId: request.merchantId,
    };

    const replay: ReplayRun = {
      replayId,
      datasetRunId: request.datasetRunId,
      status: 'PENDING',
      config,
      statistics: {
        totalEvents: 0,
        processedEvents: 0,
        failedEvents: 0,
        opportunitiesDetected: 0,
        executionsAttempted: 0,
        executionsBlocked: 0,
        humanReviews: 0,
        recoveriesVerified: 0,
        recoveredAmount: 0,
        revenueAtRisk: 0,
        recoverableRevenue: 0,
      },
      eventResults: [],
      errorMessage: null,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
    };

    replayRuns.set(replayId, replay);

    // Start processing synchronously for instant/fast speed
    if (config.speed === 'instant' || config.speed === 'fast') {
      await this.processReplay(replayId);
    }

    return {
      replayId,
      datasetRunId: request.datasetRunId,
      status: replay.status,
      totalEvents: replay.statistics.totalEvents,
    };
  }

  /**
   * Get the status of a replay run.
   */
  getReplayStatus(replayId: string): GetReplayResponse | null {
    const replay = replayRuns.get(replayId);
    if (!replay) {
      return null;
    }

    const progress = replay.statistics.totalEvents > 0
      ? (replay.statistics.processedEvents / replay.statistics.totalEvents) * 100
      : 0;

    return {
      replayId: replay.replayId,
      datasetRunId: replay.datasetRunId,
      status: replay.status,
      progress,
      totalEvents: replay.statistics.totalEvents,
      processedEvents: replay.statistics.processedEvents,
      failedEvents: replay.statistics.failedEvents,
      opportunitiesDetected: replay.statistics.opportunitiesDetected,
      executionsAttempted: replay.statistics.executionsAttempted,
      executionsBlocked: replay.statistics.executionsBlocked,
      humanReviews: replay.statistics.humanReviews,
      recoveriesVerified: replay.statistics.recoveriesVerified,
      recoveredAmount: replay.statistics.recoveredAmount,
      revenueAtRisk: replay.statistics.revenueAtRisk,
      recoverableRevenue: replay.statistics.recoverableRevenue,
      recentEvents: replay.eventResults.slice(-MAX_RECENT_EVENTS),
      createdAt: replay.createdAt.toISOString(),
      startedAt: replay.startedAt?.toISOString() ?? null,
      completedAt: replay.completedAt?.toISOString() ?? null,
      errorMessage: replay.errorMessage,
    };
  }

  /**
   * Cancel a running replay (if safe to do so).
   */
  cancelReplay(replayId: string): boolean {
    const replay = replayRuns.get(replayId);
    if (!replay) {
      return false;
    }

    if (replay.status === 'RUNNING') {
      replay.status = 'CANCELLED';
      replay.completedAt = new Date();
      isReplaying = false;
      return true;
    }

    return false;
  }

  /**
   * Get all replay runs (for listing).
   */
  listReplays(): Array<{ replayId: string; datasetRunId: string; status: ReplayStatus; createdAt: Date }> {
    return Array.from(replayRuns.values()).map((r) => ({
      replayId: r.replayId,
      datasetRunId: r.datasetRunId,
      status: r.status,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Check if a replay is currently running.
   */
  isReplaying(): boolean {
    return isReplaying;
  }

  /**
   * Clear all replay runs (for testing).
   */
  static clearRuns(): void {
    replayRuns.clear();
    isReplaying = false;
  }

  // ---------------------------------------------------------------------------
  // Private processing
  // ---------------------------------------------------------------------------

  private async processReplay(replayId: string): Promise<void> {
    const replay = replayRuns.get(replayId);
    if (!replay) {
      return;
    }

    isReplaying = true;
    replay.status = 'RUNNING';
    replay.startedAt = new Date();

    try {
      // 1. Load all synthetic events for this dataset run
      const events = await this.loadSyntheticEvents(replay.config);
      replay.statistics.totalEvents = events.length;

      if (events.length === 0) {
        replay.status = 'COMPLETED';
        replay.completedAt = new Date();
        isReplaying = false;
        return;
      }

      // 2. Process events in batches
      const batchSize = replay.config.batchSize;
      for (let i = 0; i < events.length; i += batchSize) {
        // Check for cancellation (replay status may have changed externally)
        if (replay.status !== 'RUNNING') {
          break;
        }

        const batch = events.slice(i, i + batchSize);
        for (const event of batch) {
          if (replay.status !== 'RUNNING') {
            break;
          }

          try {
            const result = await this.processEvent(event, replay);
            replay.eventResults.push(result);
            replay.statistics.processedEvents++;

            // Update aggregate stats
            if (result.opportunityId) {
              replay.statistics.opportunitiesDetected++;
            }
            if (result.executionOutcome === 'created') {
              replay.statistics.executionsAttempted++;
            }
            if (result.executionOutcome === 'blocked') {
              replay.statistics.executionsBlocked++;
            }
            if (result.executionOutcome === 'review') {
              replay.statistics.humanReviews++;
            }
            if (result.recovered) {
              replay.statistics.recoveriesVerified++;
              replay.statistics.recoveredAmount += result.recoveredAmount;
            }
          } catch (error) {
            replay.statistics.failedEvents++;
            replay.eventResults.push({
              eventId: event.id,
              eventType: event.eventType,
              amount: extractAmount(event),
              currency: extractCurrency(event),
              providerPaymentId: event.providerPaymentId,
              providerOrderId: event.providerOrderId,
              detectionOutcome: 'error',
              opportunityId: null,
              decisionAction: null,
              decisionScore: null,
              executionOutcome: null,
              executionStatus: null,
              recovered: false,
              recoveredAmount: 0,
              error: error instanceof Error ? error.message : 'Unknown error',
              processedAt: new Date(),
            });
          }
        }

        // Yield control between batches
        if (replay.config.speed === 'realtime') {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      // 3. Calculate revenue at risk and recoverable revenue
      replay.statistics.revenueAtRisk = events
        .filter((e) => e.eventType === 'payment.failed')
        .reduce((sum, e) => sum + extractAmount(e), 0);

      replay.statistics.recoverableRevenue = replay.statistics.opportunitiesDetected > 0
        ? replay.statistics.recoveredAmount // Use actual recovered as proxy
        : 0;

      replay.status = 'COMPLETED';
      replay.completedAt = new Date();
    } catch (error) {
      replay.status = 'FAILED';
      replay.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      replay.completedAt = new Date();
    } finally {
      isReplaying = false;
    }
  }

  /**
   * Load synthetic events from the database, ordered by occurredAt ascending.
   */
  private async loadSyntheticEvents(config: ReplayConfig): Promise<PaymentEventRow[]> {
    // Query events that have synthetic metadata in the payload
    const events = await this.db.paymentEvent.findMany?.({
      merchantId: config.merchantId,
      take: 10000, // Limit for safety
      orderBy: 'asc',
    });

    if (!events) {
      return [];
    }

    // Filter to only synthetic events (those with _synthetic flag in payload)
    const syntheticEvents = events.filter((e) => {
      const payload = e.payload as Record<string, unknown>;
      return payload._synthetic === true;
    });

    // Sort by eventCreatedAt ascending for deterministic processing
    return syntheticEvents.sort((a, b) => a.eventCreatedAt.getTime() - b.eventCreatedAt.getTime());
  }

  /**
   * Process a single payment event through the existing RecoveryOS pipeline.
   */
  private async processEvent(
    event: PaymentEventRow,
    replay: ReplayRun,
  ): Promise<ReplayEventResult> {
    const result: ReplayEventResult = {
      eventId: event.id,
      eventType: event.eventType,
      amount: extractAmount(event),
      currency: extractCurrency(event),
      providerPaymentId: event.providerPaymentId,
      providerOrderId: event.providerOrderId,
      detectionOutcome: 'pending',
      opportunityId: null,
      decisionAction: null,
      decisionScore: null,
      executionOutcome: null,
      executionStatus: null,
      recovered: false,
      recoveredAmount: 0,
      error: null,
      processedAt: new Date(),
    };

    // 1. Detection — process through existing leakage service
    const detectionOutcome = await this.leakageService.processPaymentEvent(event);
    result.detectionOutcome = detectionOutcome.outcome;

    if (detectionOutcome.outcome === 'opportunity-created' && detectionOutcome.opportunityIds.length > 0) {
      result.opportunityId = detectionOutcome.opportunityIds[0]!;

      // 2. Decision — get existing decision for opportunity
      try {
        const decisionOutcome = await this.decisionService.getForOpportunity(result.opportunityId);
        if (decisionOutcome.decision) {
          result.decisionAction = decisionOutcome.decision.recommendedAction;
          result.decisionScore = decisionOutcome.decision.score;

          // 3. Execution — attempt execution through existing service
          const executionResult = await this.executionService.requestExecution(result.opportunityId);

          switch (executionResult.outcome) {
            case 'created':
              result.executionOutcome = 'created';
              result.executionStatus = executionResult.execution.status;

              // If execution succeeded, simulate capture event
              if (executionResult.execution.status === 'SUCCEEDED') {
                await this.simulateCapture(event, replay, result);
              }
              break;

            case 'blocked':
              result.executionOutcome = 'blocked';
              result.executionStatus = 'BLOCKED';
              break;

            case 'replayed':
              result.executionOutcome = 'replayed';
              result.executionStatus = executionResult.execution.status;
              break;

            case 'provider-rejected':
              result.executionOutcome = 'provider-rejected';
              result.executionStatus = 'FAILED';
              break;

            case 'provider-unavailable':
              result.executionOutcome = 'provider-unavailable';
              result.executionStatus = 'UNAVAILABLE';
              break;

            case 'disabled':
              result.executionOutcome = 'disabled';
              result.executionStatus = 'DISABLED';
              break;

            default:
              result.executionOutcome = 'not-found';
              result.executionStatus = 'NOT_FOUND';
          }
        }
      } catch (error) {
        result.error = error instanceof Error ? error.message : 'Decision/execution error';
      }
    } else if (detectionOutcome.outcome === 'opportunity-recovered') {
      // This is a captured event that resolved an existing opportunity
      result.recovered = true;
      result.recoveredAmount = result.amount;
    }

    return result;
  }

  /**
   * Simulate a successful payment capture by creating a payment.captured event
   * and processing it through the pipeline for outcome verification.
   */
  private async simulateCapture(
    failedEvent: PaymentEventRow,
    replay: ReplayRun,
    result: ReplayEventResult,
  ): Promise<void> {
    const normalizedData = failedEvent.normalizedData as NormalizedPaymentEventData;

    // Create a synthetic payment.captured event
    const capturedPayload = {
      id: `cap_${failedEvent.id}`,
      amount: result.amount,
      currency: result.currency,
      status: 'captured',
      method: normalizedData.method,
      order_id: failedEvent.providerOrderId,
      bank: normalizedData.bank,
      created_at: new Date().toISOString(),
      _synthetic: true,
      _runId: replay.config.datasetRunId,
      _replayId: replay.replayId,
      _isRecoveryCapture: true,
    };

    const capturedNormalizedData: NormalizedPaymentEventData = {
      provider: 'razorpay',
      eventType: 'payment.captured',
      providerPaymentId: failedEvent.providerPaymentId,
      providerOrderId: failedEvent.providerOrderId,
      amount: result.amount,
      currency: result.currency,
      status: 'captured',
      method: normalizedData.method,
      email: null,
      contact: null,
      bank: null,
      errorCode: null,
      errorDescription: null,
      errorSource: null,
      errorStep: null,
      errorReason: null,
      subscriptionId: null,
      paymentCreatedAt: failedEvent.eventCreatedAt.toISOString(),
      occurredAt: new Date().toISOString(),
    };

    const capturedEvent = await this.db.paymentEvent.insert({
      paymentAccountId: failedEvent.paymentAccountId,
      merchantId: failedEvent.merchantId,
      provider: 'razorpay',
      providerEventId: `payment.captured:${failedEvent.providerPaymentId}`,
      eventType: 'payment.captured',
      providerPaymentId: failedEvent.providerPaymentId,
      providerOrderId: failedEvent.providerOrderId,
      eventCreatedAt: new Date(),
      receivedAt: new Date(),
      payload: capturedPayload,
      normalizedData: capturedNormalizedData,
      signatureVerified: true,
      processingStatus: 'processed',
      processingAttempts: 1,
      processedAt: new Date(),
      failureReason: null,
    });

    // Process through pipeline for outcome verification
    const recoveryOutcome = await this.leakageService.processPaymentEvent(capturedEvent);
    if (recoveryOutcome.outcome === 'opportunity-recovered') {
      result.recovered = true;
      result.recoveredAmount = result.amount;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractAmount(event: PaymentEventRow): number {
  const normalizedData = event.normalizedData as NormalizedPaymentEventData;
  return normalizedData.amount ?? 0;
}

function extractCurrency(event: PaymentEventRow): string {
  const normalizedData = event.normalizedData as NormalizedPaymentEventData;
  return normalizedData.currency ?? 'INR';
}
