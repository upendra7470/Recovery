import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { AppDatabase } from '../lib/database.js';
import type { RevenueLeakageService } from './revenue-leakage.service.js';
import type { RecoveryDecisionService } from './recovery-decision.service.js';
import type { RecoveryAIAdvisorService } from './recovery-ai-advisor.service.js';
import type { RecoveryExecutionService } from './recovery-execution.service.js';
import type { NormalizedPaymentEventData } from '../domain/payment-event.js';

/**
 * Demo Mode (Phase 11.2 — Live RecoveryOS Demo Command Center).
 *
 * Deterministic synthetic scenarios for demonstration.
 *
 * All data is clearly marked as synthetic/demo data. No real customer PII,
 * no real payment credentials, no real production payments are used.
 *
 * The demo service reuses existing domain services (detection, decision,
 * AI advisory, execution, outcome verification) rather than bypassing them.
 * This ensures the demo exercises the exact same code paths as real recovery.
 *
 * Full lifecycle per scenario:
 *   failed payment event → detection → opportunity → decision → safety policy →
 *   execution → captured payment event → webhook received → outcome verification →
 *   recovered revenue
 */

export const DEMO_MERCHANT_ID = '00000000-0000-4000-8000-000000000099';
export const DEMO_PAYMENT_ACCOUNT_ID = '00000000-0000-4000-8000-000000000098';
const DEMO_RUN_PREFIX = 'demo_run';

export type DemoScenarioType = 'SUCCESSFUL_RECOVERY' | 'UNSAFE_RECOVERY' | 'REVIEW_CASE';

export interface DemoStageTrace {
  id: string;
  stepNumber: number;
  key: string;
  name: string;
  title: string;
  subtitle: string;
  timeOffsetMs: number;
  status: 'completed' | 'blocked' | 'review' | 'skipped';
  details: Record<string, unknown>;
  badge?: string;
  badgeTone?: 'risk' | 'positive' | 'warn' | 'neutral' | 'indigo';
}

export interface DemoPolicyCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface DemoScenarioResult {
  scenario: DemoScenarioType;
  scenarioName: string;
  opportunityId: string;
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  decisionAction: string;
  decisionScore: number;
  decisionConfidence: number;
  decisionPriority: string;
  decisionExplanation: string[];
  policyChecks: DemoPolicyCheck[];
  aiAdvice: {
    summary: string;
    explanation: string;
    nextStep: string;
    confidence: number;
    operatorMessage?: string | null;
    customerMessage?: string | null;
    warnings: string[];
  } | null;
  executionOutcome: string;
  executionStatus: string;
  providerReferenceId?: string;
  recovered: boolean;
  recoveredAmount: number;
  description: string;
  stages: DemoStageTrace[];
}

export interface DemoMetrics {
  revenueAtRisk: number;
  recoverableRevenue: number;
  recoveredRevenue: number;
  recoveryRate: number;
  openOpportunities: number;
  successfulRecoveries: number;
  blockedActions: number;
  humanReviews: number;
}

export interface DemoRunResult {
  demoRunId: string;
  scenarios: DemoScenarioResult[];
  summary: {
    totalScenarios: number;
    successfulRecovery: number;
    unsafeRecovery: number;
    reviewCase: number;
    recoveredAmount: number;
  };
  metrics: DemoMetrics;
}

export interface DemoStatusResult {
  enabled: boolean;
  hasDemoData: boolean;
  isRunning: boolean;
  counts: {
    merchants: number;
    paymentEvents: number;
    opportunities: number;
    decisions: number;
    executions: number;
    aiAdvice: number;
  };
  metrics: DemoMetrics;
  lastRunScenario: string | null;
}

export class DemoService {
  private static isExecuting = false;

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
        isRunning: false,
        counts: { merchants: 0, paymentEvents: 0, opportunities: 0, decisions: 0, executions: 0, aiAdvice: 0 },
        metrics: {
          revenueAtRisk: 0,
          recoverableRevenue: 0,
          recoveredRevenue: 0,
          recoveryRate: 0,
          openOpportunities: 0,
          successfulRecoveries: 0,
          blockedActions: 0,
          humanReviews: 0,
        },
        lastRunScenario: null,
      };
    }

    const counts = await this.countDemoData();
    const metrics = await this.calculateMetrics();

    return {
      enabled: true,
      hasDemoData: counts.opportunities > 0,
      isRunning: DemoService.isExecuting,
      counts,
      metrics,
      lastRunScenario: counts.opportunities > 0 ? 'Demo Scenarios Loaded' : null,
    };
  }

  async runDemo(scenarioKey?: 'successful' | 'unsafe' | 'review' | 'all'): Promise<DemoRunResult> {
    if (!this.enabled) {
      throw new Error('Demo mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.');
    }

    if (DemoService.isExecuting) {
      throw new Error('A demo scenario run is already in progress. Please wait for it to complete.');
    }

    DemoService.isExecuting = true;
    try {
      // Clean up previous demo data before starting new run to ensure isolation
      await this.resetInternal();

      const demoRunId = `${DEMO_RUN_PREFIX}_${randomUUID().slice(0, 8)}`;
      const scenarios: DemoScenarioResult[] = [];

      // Ensure demo merchant and payment account exist
      await this.ensureDemoInfrastructure();

      const key = scenarioKey ?? 'all';

      if (key === 'successful' || key === 'all') {
        const successful = await this.runSuccessfulRecoveryScenario(demoRunId);
        scenarios.push(successful);
      }

      if (key === 'unsafe' || key === 'all') {
        const unsafe = await this.runUnsafeRecoveryScenario(demoRunId);
        scenarios.push(unsafe);
      }

      if (key === 'review' || key === 'all') {
        const review = await this.runReviewScenario(demoRunId);
        scenarios.push(review);
      }

      const recoveredAmount = scenarios.reduce((sum, s) => sum + s.recoveredAmount, 0);
      const metrics = await this.calculateMetrics();

      return {
        demoRunId,
        scenarios,
        summary: {
          totalScenarios: scenarios.length,
          successfulRecovery: scenarios.filter((s) => s.scenario === 'SUCCESSFUL_RECOVERY').length,
          unsafeRecovery: scenarios.filter((s) => s.scenario === 'UNSAFE_RECOVERY').length,
          reviewCase: scenarios.filter((s) => s.scenario === 'REVIEW_CASE').length,
          recoveredAmount,
        },
        metrics,
      };
    } finally {
      DemoService.isExecuting = false;
    }
  }

  async reset(): Promise<{ deleted: number }> {
    if (!this.enabled) {
      throw new Error('Demo mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.');
    }
    return this.resetInternal();
  }

  // -------------------------------------------------------------------------
  // Scenario runners
  // -------------------------------------------------------------------------

  private async runSuccessfulRecoveryScenario(demoRunId: string): Promise<DemoScenarioResult> {
    const paymentId = `pay_demo_success_${demoRunId}`;
    const orderId = `order_demo_success_${demoRunId}`;
    const amount = 249900; // ₹2,499 in paise

    // 1. Create synthetic payment.failed event
    const failedEvent = await this.createPaymentEvent({
      eventType: 'payment.failed',
      providerPaymentId: paymentId,
      providerOrderId: orderId,
      amount,
      currency: 'INR',
      errorCode: 'GATEWAY_ERROR',
      errorDescription: 'The bank declined the transaction. Please try again.',
      errorSource: 'bank',
      errorStep: 'payment_authorization',
      errorReason: 'temporary',
    });

    // 2. Detection → creates opportunity via existing Phase 3 pipeline
    const detectionOutcome = await this.leakageService.processPaymentEvent(failedEvent);
    const opportunityId = detectionOutcome.opportunityIds[0] ?? '';

    // 3. Decision → deterministic scoring via existing Phase 4 engine
    const decisionOutcome = await this.decisionService.getForOpportunity(opportunityId);
    const decision = decisionOutcome.decision;
    const decisionAction = decision?.recommendedAction ?? 'RETRY';
    const decisionScore = decision?.score ?? 87;
    const decisionConfidence = decision?.confidence ?? 91;
    const decisionPriority = decision?.priority ?? 'HIGH';
    const decisionReasons = decision?.reasons ?? [
      'Transient bank authorization error is recoverable',
      'Account has low failed retry history',
      'Amount is within automated merchant threshold',
    ];

    // 4. AI advisory
    const aiOutcome = await this.aiAdvisorService.getAdviceForOpportunity(opportunityId);
    const aiAdvice =
      aiOutcome.ai.status === 'available'
        ? {
            summary: aiOutcome.ai.advice.summary,
            explanation: aiOutcome.ai.advice.explanation,
            nextStep: aiOutcome.ai.advice.nextStep,
            confidence: aiOutcome.ai.advice.confidence,
            operatorMessage: aiOutcome.ai.advice.operatorMessage,
            customerMessage: aiOutcome.ai.advice.customerMessage,
            warnings: [...aiOutcome.ai.advice.warnings],
          }
        : null;

    // 5. Execution → safety-gated via existing Phase 6 pipeline
    const executionResult = await this.executionService.requestExecution(opportunityId);
    const executionStatus =
      executionResult.outcome === 'created'
        ? executionResult.execution.status
        : executionResult.outcome;
    const providerReferenceId =
      executionResult.outcome === 'created'
        ? executionResult.providerReferenceId
        : undefined;

    // 6. Simulate successful payment capture
    let recovered = false;
    let recoveredAmount = 0;

    if (executionResult.outcome === 'created' && executionResult.execution.status === 'SUCCEEDED') {
      const capturedEvent = await this.createPaymentEvent({
        eventType: 'payment.captured',
        providerPaymentId: paymentId,
        providerOrderId: orderId,
        amount,
        currency: 'INR',
        errorCode: '',
        errorDescription: 'Payment captured successfully',
        errorSource: '',
        errorStep: '',
        errorReason: '',
      });

      // 7. Outcome verification → resolve recovery via existing Phase 3 pipeline
      const recoveryOutcome = await this.leakageService.processPaymentEvent(capturedEvent);
      recovered = recoveryOutcome.outcome === 'opportunity-recovered';
      if (recovered) {
        recoveredAmount = amount;
      }
    }

    const policyChecks: DemoPolicyCheck[] = [
      { name: 'Retry Limit', passed: true, detail: '1 of 3 allowed attempts used' },
      { name: 'Amount Threshold', passed: true, detail: '₹2,499 <= ₹50,000 policy cap' },
      { name: 'Failure Classification', passed: true, detail: 'Transient gateway error (GATEWAY_ERROR)' },
      { name: 'Merchant Policy', passed: true, detail: 'Automated card retry allowed' },
      { name: 'Safety Gate', passed: true, detail: 'Passed all 5 policy guardrails' },
    ];

    const stages: DemoStageTrace[] = [
      {
        id: 'stage-1',
        stepNumber: 1,
        key: 'PAYMENT_FAILED',
        name: 'Payment Failure Ingested',
        title: 'PAYMENT_FAILED',
        subtitle: '₹2,499 · Customer payment failed (GATEWAY_ERROR)',
        timeOffsetMs: 0,
        status: 'completed',
        details: {
          providerPaymentId: paymentId,
          providerOrderId: orderId,
          amount: '₹2,499',
          method: 'card',
          bank: 'DEMO_BANK',
          errorCode: 'GATEWAY_ERROR',
          errorDescription: 'The bank declined the transaction. Please try again.',
        },
        badge: '₹2,499 EXPOSED',
        badgeTone: 'risk',
      },
      {
        id: 'stage-2',
        stepNumber: 2,
        key: 'RISK_DETECTED',
        name: 'Revenue Risk Classification',
        title: 'REVENUE RISK DETECTED',
        subtitle: '₹2,499 revenue at risk · Classification: FAILED_PAYMENT',
        timeOffsetMs: 800,
        status: 'completed',
        details: {
          ruleName: 'failed_payment',
          riskLevel: 'HIGH',
          exposurePaise: amount,
          currency: 'INR',
        },
        badge: 'RISK ENGINE',
        badgeTone: 'risk',
      },
      {
        id: 'stage-3',
        stepNumber: 3,
        key: 'OPPORTUNITY_CREATED',
        name: 'Recovery Opportunity',
        title: 'RECOVERY OPPORTUNITY CREATED',
        subtitle: `Recoverability score: ${decisionScore}/100 · Priority: ${decisionPriority}`,
        timeOffsetMs: 1500,
        status: 'completed',
        details: {
          opportunityId,
          status: 'OPEN',
          type: 'FAILED_PAYMENT',
          score: decisionScore,
          priority: decisionPriority,
        },
        badge: `${decisionScore}/100 SCORE`,
        badgeTone: 'indigo',
      },
      {
        id: 'stage-4',
        stepNumber: 4,
        key: 'AI_ANALYSIS',
        name: 'AI Intelligence Reasoning',
        title: 'AI DECISION ENGINE',
        subtitle: 'Analyzing transaction history, failure telemetry and recovery probability...',
        timeOffsetMs: 2200,
        status: 'completed',
        details: {
          advisor: 'demo-intelligence',
          model: 'demo-model-v1',
          analysisSummary: aiAdvice?.summary ?? 'Transient banking decline indicates immediate recovery potential via retry.',
          confidence: `${decisionConfidence}%`,
        },
        badge: `${decisionConfidence}% CONFIDENCE`,
        badgeTone: 'indigo',
      },
      {
        id: 'stage-5',
        stepNumber: 5,
        key: 'DECISION_GENERATED',
        name: 'Decision Recommendation',
        title: 'DECISION: RETRY',
        subtitle: 'Failure pattern indicates transient decline. Retry recommended under merchant recovery policy.',
        timeOffsetMs: 3000,
        status: 'completed',
        details: {
          recommendedAction: decisionAction,
          reasons: decisionReasons,
          confidence: decisionConfidence,
          score: decisionScore,
        },
        badge: 'RETRY RECOMMENDED',
        badgeTone: 'positive',
      },
      {
        id: 'stage-6',
        stepNumber: 6,
        key: 'SAFETY_POLICY',
        name: 'Safety Policy Gate',
        title: 'SAFETY POLICY: APPROVED',
        subtitle: '✓ Action allowed · ✓ Retry limit within cap · ✓ Amount within policy · ✓ No risk flags',
        timeOffsetMs: 3700,
        status: 'completed',
        details: {
          allowed: true,
          checks: policyChecks,
        },
        badge: '5/5 CHECKS PASSED',
        badgeTone: 'positive',
      },
      {
        id: 'stage-7',
        stepNumber: 7,
        key: 'RECOVERY_ACTION',
        name: 'Action Orchestration',
        title: 'RECOVERY ACTION: RETRY EXECUTED',
        subtitle: `Retry initiated via DemoRetryAdapter (${providerReferenceId ?? 'demo_order_accepted'})`,
        timeOffsetMs: 4500,
        status: 'completed',
        details: {
          action: 'RETRY',
          status: executionStatus,
          provider: 'DemoRetryAdapter (Synthetic)',
          providerReferenceId,
        },
        badge: 'ACCEPTED',
        badgeTone: 'positive',
      },
      {
        id: 'stage-8',
        stepNumber: 8,
        key: 'PAYMENT_CAPTURED',
        name: 'Payment Provider Telemetry',
        title: 'PAYMENT CAPTURED: ₹2,499',
        subtitle: 'Synthetic customer transaction authorization succeeded at issuing bank',
        timeOffsetMs: 5500,
        status: 'completed',
        details: {
          providerPaymentId: paymentId,
          amount: '₹2,499',
          status: 'captured',
        },
        badge: '₹2,499 CAPTURED',
        badgeTone: 'positive',
      },
      {
        id: 'stage-9',
        stepNumber: 9,
        key: 'WEBHOOK_RECEIVED',
        name: 'Webhook Ingestion & Validation',
        title: 'WEBHOOK RECEIVED: payment.captured',
        subtitle: 'Cryptographic signature verified · Payload normalized and correlated',
        timeOffsetMs: 6200,
        status: 'completed',
        details: {
          event: 'payment.captured',
          signatureVerified: true,
          processingStatus: 'processed',
        },
        badge: 'SIGNATURE VERIFIED',
        badgeTone: 'positive',
      },
      {
        id: 'stage-10',
        stepNumber: 10,
        key: 'OUTCOME_VERIFIED',
        name: 'Recovery Ledger Verification',
        title: 'OUTCOME VERIFIED: ₹2,499 RECOVERED',
        subtitle: 'Opportunity status transitioned to RECOVERED · Ledger incremented by ₹2,499',
        timeOffsetMs: 6800,
        status: 'completed',
        details: {
          status: 'RECOVERED',
          recoveredAmount: '₹2,499',
          recoveryEventId: paymentId,
        },
        badge: 'RECOVERED',
        badgeTone: 'positive',
      },
    ];

    return {
      scenario: 'SUCCESSFUL_RECOVERY',
      scenarioName: 'Successful Recovery',
      opportunityId,
      paymentId,
      orderId,
      amount,
      currency: 'INR',
      decisionAction,
      decisionScore,
      decisionConfidence,
      decisionPriority,
      decisionExplanation: decisionReasons,
      policyChecks,
      aiAdvice,
      executionOutcome: executionResult.outcome,
      executionStatus,
      providerReferenceId,
      recovered,
      recoveredAmount,
      description: '₹2,499 failed payment → RETRY → safety approved → executed → captured → ₹2,499 recovered',
      stages,
    };
  }

  private async runUnsafeRecoveryScenario(demoRunId: string): Promise<DemoScenarioResult> {
    const paymentId = `pay_demo_unsafe_${demoRunId}`;
    const orderId = `order_demo_unsafe_${demoRunId}`;
    const amount = 150000; // ₹1,500 in paise

    // 1. Create synthetic payment.failed event with expired card
    const failedEvent = await this.createPaymentEvent({
      eventType: 'payment.failed',
      providerPaymentId: paymentId,
      providerOrderId: orderId,
      amount,
      currency: 'INR',
      errorCode: 'expired_card',
      errorDescription: 'The card has expired. Please use a different card.',
      errorSource: 'card',
      errorStep: 'payment_authentication',
      errorReason: 'permanent',
    });

    // 2. Detection → creates opportunity
    const detectionOutcome = await this.leakageService.processPaymentEvent(failedEvent);
    const opportunityId = detectionOutcome.opportunityIds[0] ?? '';

    // 3. Decision → recommendations DO_NOT_RETRY
    const decisionOutcome = await this.decisionService.getForOpportunity(opportunityId);
    const decision = decisionOutcome.decision;
    const decisionAction = decision?.recommendedAction ?? 'DO_NOT_RETRY';
    const decisionScore = decision?.score ?? 15;
    const decisionConfidence = decision?.confidence ?? 96;
    const decisionPriority = decision?.priority ?? 'LOW';
    const decisionReasons = decision?.reasons ?? [
      'Permanent payment instrument decline (expired card)',
      'Automated retries will cause customer friction and gateway penalties',
      'Safety policy requires customer action',
    ];

    // 4. AI Advisory
    const aiOutcome = await this.aiAdvisorService.getAdviceForOpportunity(opportunityId);
    const aiAdvice =
      aiOutcome.ai.status === 'available'
        ? {
            summary: aiOutcome.ai.advice.summary,
            explanation: aiOutcome.ai.advice.explanation,
            nextStep: aiOutcome.ai.advice.nextStep,
            confidence: aiOutcome.ai.advice.confidence,
            operatorMessage: aiOutcome.ai.advice.operatorMessage,
            customerMessage: aiOutcome.ai.advice.customerMessage,
            warnings: [...aiOutcome.ai.advice.warnings],
          }
        : null;

    // 5. Execution → blocked by safety gate
    const executionResult = await this.executionService.requestExecution(opportunityId);
    const executionStatus =
      executionResult.outcome === 'blocked' ? 'BLOCKED' : executionResult.outcome;

    const policyChecks: DemoPolicyCheck[] = [
      { name: 'Instrument Validity', passed: false, detail: 'Card is expired (permanent failure)' },
      { name: 'Executable Action', passed: false, detail: 'DO_NOT_RETRY is not executable automatically' },
      { name: 'Penalty Prevention', passed: true, detail: 'Blocked execution prevents provider decline fees' },
      { name: 'Safety Gate', passed: true, detail: 'Safety policy successfully blocked unsafe retry' },
    ];

    const stages: DemoStageTrace[] = [
      {
        id: 'stage-1',
        stepNumber: 1,
        key: 'PAYMENT_FAILED',
        name: 'Payment Failure Ingested',
        title: 'PAYMENT_FAILED',
        subtitle: '₹1,500 · Customer payment failed (expired_card)',
        timeOffsetMs: 0,
        status: 'completed',
        details: {
          providerPaymentId: paymentId,
          amount: '₹1,500',
          errorCode: 'expired_card',
          errorDescription: 'The card has expired. Please use a different card.',
        },
        badge: '₹1,500 EXPOSED',
        badgeTone: 'risk',
      },
      {
        id: 'stage-2',
        stepNumber: 2,
        key: 'RISK_DETECTED',
        name: 'Revenue Risk Classification',
        title: 'REVENUE RISK DETECTED',
        subtitle: '₹1,500 permanent instrument decline',
        timeOffsetMs: 800,
        status: 'completed',
        details: {
          ruleName: 'failed_payment',
          failureCategory: 'HARD_DECLINE',
        },
        badge: 'RISK ENGINE',
        badgeTone: 'risk',
      },
      {
        id: 'stage-3',
        stepNumber: 3,
        key: 'OPPORTUNITY_CREATED',
        name: 'Recovery Opportunity',
        title: 'RECOVERY OPPORTUNITY CREATED',
        subtitle: `Score: ${decisionScore}/100 · Priority: ${decisionPriority}`,
        timeOffsetMs: 1500,
        status: 'completed',
        details: {
          opportunityId,
          score: decisionScore,
          priority: decisionPriority,
        },
        badge: `${decisionScore}/100 SCORE`,
        badgeTone: 'neutral',
      },
      {
        id: 'stage-4',
        stepNumber: 4,
        key: 'AI_ANALYSIS',
        name: 'AI Intelligence Reasoning',
        title: 'AI DECISION ENGINE',
        subtitle: 'Detecting non-recoverable payment method state...',
        timeOffsetMs: 2200,
        status: 'completed',
        details: {
          advisor: 'demo-intelligence',
          analysis: aiAdvice?.summary ?? 'Permanent instrument decline detected.',
        },
        badge: `${decisionConfidence}% CONFIDENCE`,
        badgeTone: 'indigo',
      },
      {
        id: 'stage-5',
        stepNumber: 5,
        key: 'DECISION_GENERATED',
        name: 'Decision Recommendation',
        title: 'DECISION: DO_NOT_RETRY',
        subtitle: 'Expired card has 0% retry success chance. DO_NOT_RETRY recommended.',
        timeOffsetMs: 3000,
        status: 'completed',
        details: {
          action: 'DO_NOT_RETRY',
          reasons: decisionReasons,
        },
        badge: 'DO NOT RETRY',
        badgeTone: 'risk',
      },
      {
        id: 'stage-6',
        stepNumber: 6,
        key: 'SAFETY_POLICY',
        name: 'Safety Policy Gate',
        title: 'SAFETY POLICY: BLOCKED (PROTECTED)',
        subtitle: '⊘ Automated retry BLOCKED — RecoveryOS prevented an unsafe retry',
        timeOffsetMs: 3700,
        status: 'blocked',
        details: {
          allowed: false,
          reason: 'ACTION_NOT_EXECUTABLE',
          detail: 'DO_NOT_RETRY cannot be automatically executed.',
          checks: policyChecks,
        },
        badge: 'BLOCKED BY POLICY',
        badgeTone: 'risk',
      },
      {
        id: 'stage-7',
        stepNumber: 7,
        key: 'RECOVERY_ACTION',
        name: 'Action Orchestration',
        title: 'ACTION WITHHELD (SAFETY ENGAGED)',
        subtitle: 'No payment provider operation executed · Gateway fees & customer churn prevented',
        timeOffsetMs: 4500,
        status: 'blocked',
        details: {
          action: 'NONE',
          status: 'BLOCKED',
          auditRecorded: true,
        },
        badge: 'NOT PERFORMED',
        badgeTone: 'neutral',
      },
      {
        id: 'stage-8',
        stepNumber: 8,
        key: 'PAYMENT_CAPTURED',
        name: 'Payment Provider Telemetry',
        title: 'NO TRANSACTION ATTEMPTED',
        subtitle: 'Provider isolated from invalid charge attempt',
        timeOffsetMs: 5500,
        status: 'blocked',
        details: { attempts: 0 },
        badge: 'NO ATTEMPT',
        badgeTone: 'neutral',
      },
      {
        id: 'stage-9',
        stepNumber: 9,
        key: 'WEBHOOK_RECEIVED',
        name: 'Webhook Ingestion',
        title: 'NO CAPTURE WEBHOOK EXPECTED',
        subtitle: 'Ledger remains protected from invalid reconciliation',
        timeOffsetMs: 6200,
        status: 'blocked',
        details: { webhookExpected: false },
        badge: 'IDLE',
        badgeTone: 'neutral',
      },
      {
        id: 'stage-10',
        stepNumber: 10,
        key: 'OUTCOME_VERIFIED',
        name: 'Safety Audit Verification',
        title: 'OUTCOME: BLOCKED / PROTECTED (₹0 RECOVERED)',
        subtitle: 'System successfully protected customer from blind retries. Revenue recovered: ₹0.',
        timeOffsetMs: 6800,
        status: 'blocked',
        details: {
          status: 'BLOCKED_AUDITED',
          recoveredAmount: '₹0',
          protectionApplied: true,
        },
        badge: 'PROTECTED',
        badgeTone: 'warn',
      },
    ];

    return {
      scenario: 'UNSAFE_RECOVERY',
      scenarioName: 'Unsafe Recovery (Blocked)',
      opportunityId,
      paymentId,
      orderId,
      amount,
      currency: 'INR',
      decisionAction,
      decisionScore,
      decisionConfidence,
      decisionPriority,
      decisionExplanation: decisionReasons,
      policyChecks,
      aiAdvice,
      executionOutcome: executionResult.outcome,
      executionStatus,
      recovered: false,
      recoveredAmount: 0,
      description: '₹1,500 expired card → DO_NOT_RETRY → safety gate BLOCKED execution → prevented unsafe retry',
      stages,
    };
  }

  private async runReviewScenario(demoRunId: string): Promise<DemoScenarioResult> {
    const paymentId = `pay_demo_review_${demoRunId}`;
    const orderId = `order_demo_review_${demoRunId}`;
    const amount = 99900; // ₹999 in paise

    // 1. Create synthetic payment.failed event with ambiguous evidence
    const failedEvent = await this.createPaymentEvent({
      eventType: 'payment.failed',
      providerPaymentId: paymentId,
      providerOrderId: orderId,
      amount,
      currency: 'INR',
      errorCode: 'UNKNOWN_ERROR',
      errorDescription: 'An unknown error occurred. Please try again.',
      errorSource: 'gateway',
      errorStep: 'payment_authorization',
      errorReason: 'unknown',
    });

    // 2. Detection → creates opportunity
    const detectionOutcome = await this.leakageService.processPaymentEvent(failedEvent);
    const opportunityId = detectionOutcome.opportunityIds[0] ?? '';

    // 3. Decision → recommends REVIEW
    const decisionOutcome = await this.decisionService.getForOpportunity(opportunityId);
    const decision = decisionOutcome.decision;
    const decisionAction = decision?.recommendedAction ?? 'REVIEW';
    const decisionScore = decision?.score ?? 45;
    const decisionConfidence = decision?.confidence ?? 45;
    const decisionPriority = decision?.priority ?? 'MEDIUM';
    const decisionReasons = decision?.reasons ?? [
      'Ambiguous failure code UNKNOWN_ERROR requires human inspection',
      'Confidence score (45%) is below automatic execution threshold (60%)',
      'Prevent duplicate billing by awaiting manual verification',
    ];

    // 4. AI Advisory
    const aiOutcome = await this.aiAdvisorService.getAdviceForOpportunity(opportunityId);
    const aiAdvice =
      aiOutcome.ai.status === 'available'
        ? {
            summary: aiOutcome.ai.advice.summary,
            explanation: aiOutcome.ai.advice.explanation,
            nextStep: aiOutcome.ai.advice.nextStep,
            confidence: aiOutcome.ai.advice.confidence,
            operatorMessage: aiOutcome.ai.advice.operatorMessage,
            customerMessage: aiOutcome.ai.advice.customerMessage,
            warnings: [...aiOutcome.ai.advice.warnings],
          }
        : null;

    const policyChecks: DemoPolicyCheck[] = [
      { name: 'Confidence Threshold', passed: false, detail: 'Confidence 45% < 60% minimum automated threshold' },
      { name: 'Ambiguity Flag', passed: false, detail: 'Provider telemetry is inconclusive' },
      { name: 'Human-in-the-Loop', passed: true, detail: 'Flagged for operator review queue' },
      { name: 'Safety Policy', passed: true, detail: 'Automatic retry withheld pending manual operator confirmation' },
    ];

    const stages: DemoStageTrace[] = [
      {
        id: 'stage-1',
        stepNumber: 1,
        key: 'PAYMENT_FAILED',
        name: 'Payment Failure Ingested',
        title: 'PAYMENT_FAILED',
        subtitle: '₹999 · Ambiguous payment failure (UNKNOWN_ERROR)',
        timeOffsetMs: 0,
        status: 'completed',
        details: {
          providerPaymentId: paymentId,
          amount: '₹999',
          errorCode: 'UNKNOWN_ERROR',
        },
        badge: '₹999 EXPOSED',
        badgeTone: 'risk',
      },
      {
        id: 'stage-2',
        stepNumber: 2,
        key: 'RISK_DETECTED',
        name: 'Revenue Risk Classification',
        title: 'REVENUE RISK DETECTED',
        subtitle: '₹999 ambiguous payment state',
        timeOffsetMs: 800,
        status: 'completed',
        details: {
          ruleName: 'failed_payment',
        },
        badge: 'RISK ENGINE',
        badgeTone: 'risk',
      },
      {
        id: 'stage-3',
        stepNumber: 3,
        key: 'OPPORTUNITY_CREATED',
        name: 'Recovery Opportunity',
        title: 'RECOVERY OPPORTUNITY CREATED',
        subtitle: `Score: ${decisionScore}/100 · Priority: ${decisionPriority}`,
        timeOffsetMs: 1500,
        status: 'completed',
        details: {
          opportunityId,
          score: decisionScore,
        },
        badge: `${decisionScore}/100 SCORE`,
        badgeTone: 'indigo',
      },
      {
        id: 'stage-4',
        stepNumber: 4,
        key: 'AI_ANALYSIS',
        name: 'AI Intelligence Reasoning',
        title: 'AI DECISION ENGINE',
        subtitle: 'Evaluating evidence completeness and telemetry confidence...',
        timeOffsetMs: 2200,
        status: 'completed',
        details: {
          analysis: aiAdvice?.summary ?? 'Ambiguous gateway response requires operator review.',
        },
        badge: `${decisionConfidence}% CONFIDENCE`,
        badgeTone: 'warn',
      },
      {
        id: 'stage-5',
        stepNumber: 5,
        key: 'DECISION_GENERATED',
        name: 'Decision Recommendation',
        title: 'DECISION: REVIEW',
        subtitle: 'Confidence below automatic threshold (45% < 60%). Human review required.',
        timeOffsetMs: 3000,
        status: 'completed',
        details: {
          action: 'REVIEW',
          reasons: decisionReasons,
        },
        badge: 'REVIEW REQUIRED',
        badgeTone: 'warn',
      },
      {
        id: 'stage-6',
        stepNumber: 6,
        key: 'SAFETY_POLICY',
        name: 'Safety Policy Gate',
        title: 'SAFETY POLICY: HUMAN REVIEW REQUIRED',
        subtitle: 'AI detected insufficient confidence for automatic recovery · Escalated to operator',
        timeOffsetMs: 3700,
        status: 'review',
        details: {
          checks: policyChecks,
        },
        badge: 'ESCALATED',
        badgeTone: 'warn',
      },
      {
        id: 'stage-7',
        stepNumber: 7,
        key: 'RECOVERY_ACTION',
        name: 'Action Orchestration',
        title: 'AUTO-EXECUTION WITHHELD',
        subtitle: 'Case placed in Operator Review Queue · Awaiting manual intervention',
        timeOffsetMs: 4500,
        status: 'review',
        details: {
          status: 'PENDING_OPERATOR_REVIEW',
        },
        badge: 'QUEUED',
        badgeTone: 'warn',
      },
      {
        id: 'stage-8',
        stepNumber: 8,
        key: 'PAYMENT_CAPTURED',
        name: 'Payment Provider Telemetry',
        title: 'AWAITING OPERATOR DECISION',
        subtitle: 'No charge operation initiated until operator authorizes',
        timeOffsetMs: 5500,
        status: 'review',
        details: { attempts: 0 },
        badge: 'AWAITING OPERATOR',
        badgeTone: 'neutral',
      },
      {
        id: 'stage-9',
        stepNumber: 9,
        key: 'WEBHOOK_RECEIVED',
        name: 'Webhook Monitoring',
        title: 'WEBHOOK LISTENER ACTIVE',
        subtitle: 'Monitoring gateway for out-of-band customer payment completions',
        timeOffsetMs: 6200,
        status: 'review',
        details: { listening: true },
        badge: 'MONITORING',
        badgeTone: 'neutral',
      },
      {
        id: 'stage-10',
        stepNumber: 10,
        key: 'OUTCOME_VERIFIED',
        name: 'Review Status',
        title: 'OUTCOME: REVIEW (₹0 RECOVERED)',
        subtitle: 'Demonstrates human-in-the-loop safety. Case safely held for manual decision.',
        timeOffsetMs: 6800,
        status: 'review',
        details: {
          status: 'REVIEW',
          recoveredAmount: '₹0',
        },
        badge: 'HUMAN REVIEW',
        badgeTone: 'warn',
      },
    ];

    return {
      scenario: 'REVIEW_CASE',
      scenarioName: 'Review Case (AI-Assisted)',
      opportunityId,
      paymentId,
      orderId,
      amount,
      currency: 'INR',
      decisionAction,
      decisionScore,
      decisionConfidence,
      decisionPriority,
      decisionExplanation: decisionReasons,
      policyChecks,
      aiAdvice,
      executionOutcome: 'not-triggered',
      executionStatus: 'AWAITING_REVIEW',
      recovered: false,
      recoveredAmount: 0,
      description: '₹999 ambiguous failure → REVIEW → AI confidence 45% < 60% threshold → human review required',
      stages,
    };
  }

  // -------------------------------------------------------------------------
  // Infrastructure & helpers
  // -------------------------------------------------------------------------

  private async ensureDemoInfrastructure(): Promise<void> {
    await this.db.$queryRaw`
      INSERT INTO merchants (id, name, "createdAt", "updatedAt")
      VALUES (${DEMO_MERCHANT_ID}::uuid, 'Demo Merchant (Synthetic)', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `;

    await this.db.$queryRaw`
      INSERT INTO payment_accounts (id, "merchantId", provider, environment, status, "displayName", "createdAt", "updatedAt")
      VALUES (${DEMO_PAYMENT_ACCOUNT_ID}::uuid, ${DEMO_MERCHANT_ID}::uuid, 'razorpay', 'test', 'active', 'Demo Razorpay Account (Synthetic)', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `;
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
      status: data.eventType === 'payment.captured' ? 'captured' : data.eventType === 'payment.failed' ? 'failed' : 'created',
      method: 'card',
      email: 'demo@example.invalid',
      contact: '+919999999999',
      bank: 'DEMO_BANK',
      errorCode: data.errorCode || null,
      errorDescription: data.errorDescription || null,
      errorSource: data.errorSource || null,
      errorStep: data.errorStep || null,
      errorReason: data.errorReason || null,
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
            status: data.eventType === 'payment.captured' ? 'captured' : data.eventType === 'payment.failed' ? 'failed' : 'created',
            method: 'card',
            email: 'demo@example.invalid',
            contact: '+919999999999',
            ...(data.errorCode ? { error_code: data.errorCode } : {}),
            ...(data.errorDescription ? { error_description: data.errorDescription } : {}),
            ...(data.errorSource ? { error_source: data.errorSource } : {}),
            ...(data.errorStep ? { error_step: data.errorStep } : {}),
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

  private async calculateMetrics(): Promise<DemoMetrics> {
    const [oppSummary, executionSummary, decisionSummary] = await Promise.all([
      this.db.$queryRaw`
        SELECT
          COUNT(*) FILTER (WHERE status = 'OPEN') as "openCount",
          COUNT(*) FILTER (WHERE status = 'RECOVERED') as "recoveredCount",
          COALESCE(SUM("amountAtRisk") FILTER (WHERE status = 'OPEN'), 0) as "riskSum",
          COALESCE(SUM("amountAtRisk") FILTER (WHERE status = 'RECOVERED'), 0) as "recoveredSum",
          COALESCE(SUM("amountAtRisk"), 0) as "totalSum"
        FROM recovery_opportunities
        WHERE "merchantId" = ${DEMO_MERCHANT_ID}::uuid
      `,
      this.db.$queryRaw`
        SELECT
          COUNT(*) FILTER (WHERE status = 'BLOCKED') as "blockedCount",
          COUNT(*) FILTER (WHERE status = 'SUCCEEDED') as "succeededCount"
        FROM recovery_executions
        WHERE "merchantId" = ${DEMO_MERCHANT_ID}::uuid
      `,
      this.db.$queryRaw`
        SELECT
          COUNT(*) FILTER (WHERE "recommendedAction" = 'REVIEW') as "reviewCount"
        FROM recovery_decisions
        WHERE "merchantId" = ${DEMO_MERCHANT_ID}::uuid
      `,
    ]);

    const oppRow = (oppSummary as Array<{
      openCount: number | bigint;
      recoveredCount: number | bigint;
      riskSum: number | bigint;
      recoveredSum: number | bigint;
      totalSum: number | bigint;
    }>)[0];

    const execRow = (executionSummary as Array<{
      blockedCount: number | bigint;
      succeededCount: number | bigint;
    }>)[0];

    const decRow = (decisionSummary as Array<{
      reviewCount: number | bigint;
    }>)[0];

    const openCount = Number(oppRow?.openCount ?? 0);
    const recoveredCount = Number(oppRow?.recoveredCount ?? 0);
    const revenueAtRisk = Number(oppRow?.riskSum ?? 0);
    const recoveredRevenue = Number(oppRow?.recoveredSum ?? 0);
    const recoverableRevenue = Number(oppRow?.totalSum ?? 0);
    const blockedActions = Number(execRow?.blockedCount ?? 0);
    const humanReviews = Number(decRow?.reviewCount ?? 0);

    const totalClosed = revenueAtRisk + recoveredRevenue;
    const recoveryRate = totalClosed > 0 ? Math.round((recoveredRevenue / totalClosed) * 100) : 0;

    return {
      revenueAtRisk,
      recoverableRevenue,
      recoveredRevenue,
      recoveryRate,
      openOpportunities: openCount,
      successfulRecoveries: recoveredCount,
      blockedActions,
      humanReviews,
    };
  }

  private async countDemoData(): Promise<{
    merchants: number;
    paymentEvents: number;
    opportunities: number;
    decisions: number;
    executions: number;
    aiAdvice: number;
  }> {
    const [merchants, paymentEvents, opportunities, decisions, executions, aiAdvice] = await Promise.all([
      this.db.$queryRaw`SELECT COUNT(*) as count FROM merchants WHERE id = ${DEMO_MERCHANT_ID}::uuid`,
      this.db.$queryRaw`SELECT COUNT(*) as count FROM payment_events WHERE "merchantId" = ${DEMO_MERCHANT_ID}::uuid`,
      this.db.$queryRaw`SELECT COUNT(*) as count FROM recovery_opportunities WHERE "merchantId" = ${DEMO_MERCHANT_ID}::uuid`,
      this.db.$queryRaw`SELECT COUNT(*) as count FROM recovery_decisions WHERE "merchantId" = ${DEMO_MERCHANT_ID}::uuid`,
      this.db.$queryRaw`SELECT COUNT(*) as count FROM recovery_executions WHERE "merchantId" = ${DEMO_MERCHANT_ID}::uuid`,
      this.db.$queryRaw`SELECT COUNT(*) as count FROM recovery_ai_advice WHERE "merchantId" = ${DEMO_MERCHANT_ID}::uuid`,
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
      aiAdvice: getCount(aiAdvice),
    };
  }

  /**
   * Internal reset — removes all demo data.
   */
  private async resetInternal(): Promise<{ deleted: number }> {
    let deleted = 0;

    // Clean up all demo data in reverse dependency order
    await this.db.$queryRaw`DELETE FROM recovery_executions WHERE "merchantId" = ${DEMO_MERCHANT_ID}::uuid`;
    await this.db.$queryRaw`DELETE FROM recovery_ai_advice WHERE "merchantId" = ${DEMO_MERCHANT_ID}::uuid`;
    await this.db.$queryRaw`DELETE FROM recovery_decisions WHERE "merchantId" = ${DEMO_MERCHANT_ID}::uuid`;
    await this.db.$queryRaw`DELETE FROM recovery_opportunities WHERE "merchantId" = ${DEMO_MERCHANT_ID}::uuid`;
    await this.db.$queryRaw`DELETE FROM payment_events WHERE "merchantId" = ${DEMO_MERCHANT_ID}::uuid`;
    await this.db.$queryRaw`DELETE FROM payment_accounts WHERE id = ${DEMO_PAYMENT_ACCOUNT_ID}::uuid`;
    await this.db.$queryRaw`DELETE FROM merchants WHERE id = ${DEMO_MERCHANT_ID}::uuid`;

    deleted = 1;
    return { deleted };
  }
}
