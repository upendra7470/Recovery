import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { AppDatabase } from '../lib/database.js';
import type { RevenueLeakageService } from './revenue-leakage.service.js';
import type { RecoveryDecisionService } from './recovery-decision.service.js';
import type { RecoveryAIAdvisorService } from './recovery-ai-advisor.service.js';
import type { RecoveryExecutionService } from './recovery-execution.service.js';
import type { NormalizedPaymentEventData } from '../domain/payment-event.js';

/**
 * Demo Mode (Phase 11) — deterministic synthetic scenarios for demonstration.
 *
 * All data is clearly marked as synthetic/demo data. No real customer PII,
 * no real payment credentials, no real production payments are used.
 *
 * The demo service reuses existing domain services (detection, decision,
 * AI advisory, execution) rather than bypassing them. This ensures the
 * demo exercises the exact same code paths as real recovery scenarios.
 */

const DEMO_MERCHANT_ID = '00000000-0000-4000-8000-000000000099';
const DEMO_PAYMENT_ACCOUNT_ID = '00000000-0000-4000-8000-000000000098';
const DEMO_RUN_PREFIX = 'demo_run';

export interface DemoScenarioResult {
  scenario: string;
  opportunityId: string;
  decisionAction: string;
  executionOutcome: string;
  description: string;
}

export interface DemoRunResult {
  demoRunId: string;
  scenarios: DemoScenarioResult[];
  summary: {
    totalScenarios: number;
    successfulRecovery: number;
    unsafeRecovery: number;
    reviewCase: number;
  };
}

export interface DemoStatusResult {
  enabled: boolean;
  hasDemoData: boolean;
  counts: {
    merchants: number;
    paymentEvents: number;
    opportunities: number;
    decisions: number;
    executions: number;
  };
}

export class DemoService {
  constructor(
    private readonly db: AppDatabase,
    private readonly leakageService: RevenueLeakageService,
    private readonly decisionService: RecoveryDecisionService,
    private readonly aiAdvisorService: RecoveryAIAdvisorService,
    private readonly executionService: RecoveryExecutionService,
    private readonly enabled: boolean
  ) {}

  async getStatus(): Promise<DemoStatusResult> {
    if (!this.enabled) {
      return {
        enabled: false,
        hasDemoData: false,
        counts: { merchants: 0, paymentEvents: 0, opportunities: 0, decisions: 0, executions: 0 },
      };
    }

    const counts = await this.countDemoData();
    return {
      enabled: true,
      hasDemoData: counts.opportunities > 0,
      counts,
    };
  }

  async runDemo(): Promise<DemoRunResult> {
    if (!this.enabled) {
      throw new Error('Demo mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.');
    }

    const demoRunId = `${DEMO_RUN_PREFIX}_${randomUUID().slice(0, 8)}`;
    const scenarios: DemoScenarioResult[] = [];

    // Scenario 1: Successful Recovery
    const successful = await this.runSuccessfulRecoveryScenario(demoRunId);
    scenarios.push(successful);

    // Scenario 2: Unsafe Recovery (DO_NOT_RETRY)
    const unsafe = await this.runUnsafeRecoveryScenario(demoRunId);
    scenarios.push(unsafe);

    // Scenario 3: Review / AI-Assisted Case
    const review = await this.runReviewScenario(demoRunId);
    scenarios.push(review);

    return {
      demoRunId,
      scenarios,
      summary: {
        totalScenarios: scenarios.length,
        successfulRecovery: 1,
        unsafeRecovery: 1,
        reviewCase: 1,
      },
    };
  }

  async reset(): Promise<{ deleted: number }> {
    if (!this.enabled) {
      throw new Error('Demo mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.');
    }

    let deleted = 0;

    // Delete demo data in reverse dependency order
    // We need to find demo data by merchant ID
    const demoOpportunities = await this.db.recoveryOpportunity.list({ merchantId: DEMO_MERCHANT_ID });

    for (const opp of demoOpportunities) {
      // Delete executions for this opportunity
      const execs = await this.db.recoveryExecution.listByOpportunity(opp.id);
      for (const exec of execs) {
        await this.db.recoveryExecution.updateStatus({
          id: exec.id,
          status: 'CANCELLED',
          completedAt: new Date(),
          failureCode: 'DEMO_RESET',
          failureReason: 'Demo data reset',
        });
        deleted++;
      }
    }

    // Delete payment events for demo merchant
    // Note: We can't directly delete, but we can mark them
    // For a proper reset, we'd need to add delete methods to stores

    return { deleted };
  }

  private async runSuccessfulRecoveryScenario(demoRunId: string): Promise<DemoScenarioResult> {
    const paymentId = `pay_demo_success_${demoRunId}`;
    const orderId = `order_demo_success_${demoRunId}`;

    // Create synthetic payment failed event
    const failedEvent = await this.createPaymentEvent({
      eventType: 'payment.failed',
      providerPaymentId: paymentId,
      providerOrderId: orderId,
      amount: 249900, // ₹2,499 in paise
      currency: 'INR',
      errorCode: 'GATEWAY_ERROR',
      errorDescription: 'The bank declined the transaction. Please try again.',
      errorSource: 'bank',
      errorStep: 'payment_authorization',
      errorReason: 'temporary',
    });

    // Run detection to create opportunity
    const detectionOutcome = await this.leakageService.processPaymentEvent(failedEvent);
    const opportunityId = detectionOutcome.opportunityIds[0] ?? '';

    // Get decision (lazy evaluation)
    const decisionOutcome = await this.decisionService.getForOpportunity(opportunityId);
    const decisionAction = decisionOutcome.decision?.recommendedAction ?? 'UNKNOWN';

    // Get AI advice (if enabled)
    await this.aiAdvisorService.getAdviceForOpportunity(opportunityId);

    // Request execution
    const executionResult = await this.executionService.requestExecution(opportunityId);

    return {
      scenario: 'SUCCESSFUL_RECOVERY',
      opportunityId,
      decisionAction,
      executionOutcome: executionResult.outcome,
      description: `₹2,499 failed payment → OPEN opportunity → ${decisionAction} decision → execution ${executionResult.outcome}`,
    };
  }

  private async runUnsafeRecoveryScenario(demoRunId: string): Promise<DemoScenarioResult> {
    const paymentId = `pay_demo_unsafe_${demoRunId}`;
    const orderId = `order_demo_unsafe_${demoRunId}`;

    // Create synthetic payment failed event with non-recoverable failure
    const failedEvent = await this.createPaymentEvent({
      eventType: 'payment.failed',
      providerPaymentId: paymentId,
      providerOrderId: orderId,
      amount: 150000, // ₹1,500 in paise
      currency: 'INR',
      errorCode: 'CARD_EXPIRED',
      errorDescription: 'The card has expired. Please use a different card.',
      errorSource: 'card',
      errorStep: 'payment_authentication',
      errorReason: 'permanent',
    });

    // Run detection to create opportunity
    const detectionOutcome = await this.leakageService.processPaymentEvent(failedEvent);
    const opportunityId = detectionOutcome.opportunityIds[0] ?? '';

    // Get decision (should recommend DO_NOT_RETRY)
    const decisionOutcome = await this.decisionService.getForOpportunity(opportunityId);
    const decisionAction = decisionOutcome.decision?.recommendedAction ?? 'UNKNOWN';

    // Request execution (should be blocked)
    const executionResult = await this.executionService.requestExecution(opportunityId);

    return {
      scenario: 'UNSAFE_RECOVERY',
      opportunityId,
      decisionAction,
      executionOutcome: executionResult.outcome,
      description: `₹1,500 expired card → OPEN opportunity → ${decisionAction} decision → execution ${executionResult.outcome} (safety gate blocks)`,
    };
  }

  private async runReviewScenario(demoRunId: string): Promise<DemoScenarioResult> {
    const paymentId = `pay_demo_review_${demoRunId}`;
    const orderId = `order_demo_review_${demoRunId}`;

    // Create synthetic payment failed event with ambiguous evidence
    const failedEvent = await this.createPaymentEvent({
      eventType: 'payment.failed',
      providerPaymentId: paymentId,
      providerOrderId: orderId,
      amount: 99900, // ₹999 in paise
      currency: 'INR',
      errorCode: 'UNKNOWN_ERROR',
      errorDescription: 'An unknown error occurred. Please try again.',
      errorSource: 'gateway',
      errorStep: 'payment_authorization',
      errorReason: 'unknown',
    });

    // Run detection to create opportunity
    const detectionOutcome = await this.leakageService.processPaymentEvent(failedEvent);
    const opportunityId = detectionOutcome.opportunityIds[0] ?? '';

    // Get decision (should recommend REVIEW)
    const decisionOutcome = await this.decisionService.getForOpportunity(opportunityId);
    const decisionAction = decisionOutcome.decision?.recommendedAction ?? 'UNKNOWN';

    // Get AI advice (should explain the situation)
    await this.aiAdvisorService.getAdviceForOpportunity(opportunityId);

    return {
      scenario: 'REVIEW_CASE',
      opportunityId,
      decisionAction,
      executionOutcome: 'not-triggered',
      description: `₹999 ambiguous failure → OPEN opportunity → ${decisionAction} decision → AI explains situation`,
    };
  }

  private async createPaymentEvent(data: {
    eventType: string;
    providerPaymentId: string;
    providerOrderId: string;
    amount: number;
    currency: string;
    errorCode: string;
    errorDescription: string;
    errorSource: string;
    errorStep: string;
    errorReason: string;
  }) {
    const providerEventId = `${data.eventType}:${data.providerPaymentId}`;
    const now = new Date();

    const normalizedData: NormalizedPaymentEventData = {
      provider: 'razorpay',
      eventType: data.eventType,
      providerPaymentId: data.providerPaymentId,
      providerOrderId: data.providerOrderId,
      amount: data.amount,
      currency: data.currency,
      status: data.eventType === 'payment.failed' ? 'failed' : 'created',
      method: 'card',
      email: 'demo@example.com',
      contact: '+919999999999',
      bank: 'DEMO_BANK',
      errorCode: data.errorCode,
      errorDescription: data.errorDescription,
      errorSource: data.errorSource,
      errorStep: data.errorStep,
      errorReason: data.errorReason,
      subscriptionId: null,
      paymentCreatedAt: now.toISOString(),
      occurredAt: now.toISOString(),
    };

    const payload: Prisma.InputJsonValue = {
      event: data.eventType,
      payload: {
        payment: {
          entity: {
            id: data.providerPaymentId,
            order_id: data.providerOrderId,
            amount: data.amount,
            currency: data.currency,
            status: data.eventType === 'payment.failed' ? 'failed' : 'created',
            method: 'card',
            email: 'demo@example.com',
            contact: '+919999999999',
            error_code: data.errorCode,
            error_description: data.errorDescription,
            error_source: data.errorSource,
            error_step: data.errorStep,
            created_at: Math.floor(now.getTime() / 1000),
          },
        },
      },
    };

    return this.db.paymentEvent.insert({
      paymentAccountId: DEMO_PAYMENT_ACCOUNT_ID,
      merchantId: DEMO_MERCHANT_ID,
      provider: 'razorpay',
      providerEventId,
      eventType: data.eventType,
      providerPaymentId: data.providerPaymentId,
      providerOrderId: data.providerOrderId,
      eventCreatedAt: now,
      receivedAt: now,
      payload,
      normalizedData,
      signatureVerified: true,
      processingStatus: 'processed',
      processingAttempts: 1,
      processedAt: now,
      failureReason: null,
    });
  }

  private async countDemoData(): Promise<{
    merchants: number;
    paymentEvents: number;
    opportunities: number;
    decisions: number;
    executions: number;
  }> {
    const [merchants, paymentEvents, opportunities, decisions, executions] = await Promise.all([
      this.db.$queryRaw`SELECT COUNT(*) as count FROM merchants WHERE id = ${DEMO_MERCHANT_ID}`,
      this.db.$queryRaw`SELECT COUNT(*) as count FROM payment_events WHERE merchant_id = ${DEMO_MERCHANT_ID}`,
      this.db.$queryRaw`SELECT COUNT(*) as count FROM recovery_opportunities WHERE merchant_id = ${DEMO_MERCHANT_ID}`,
      this.db.$queryRaw`SELECT COUNT(*) as count FROM recovery_decisions WHERE merchant_id = ${DEMO_MERCHANT_ID}`,
      this.db.$queryRaw`SELECT COUNT(*) as count FROM recovery_executions WHERE merchant_id = ${DEMO_MERCHANT_ID}`,
    ]);

    const getCount = (result: unknown): number => {
      const rows = result as Array<{ count: number | bigint }>;
      return Number(rows[0]?.count ?? 0);
    };

    return {
      merchants: getCount(merchants),
      paymentEvents: getCount(paymentEvents),
      opportunities: getCount(opportunities),
      decisions: getCount(decisions),
      executions: getCount(executions),
    };
  }
}
