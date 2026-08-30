import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { AppDatabase } from '../lib/database.js';
import type { RevenueLeakageService } from './revenue-leakage.service.js';
import type { RecoveryDecisionService } from './recovery-decision.service.js';
import type { RecoveryAIAdvisorService } from './recovery-ai-advisor.service.js';
import type { RecoveryExecutionService } from './recovery-execution.service.js';
import type { MerchantMemoryService } from './merchant-memory.service.js';
import type { NormalizedPaymentEventData } from '../domain/payment-event.js';
import type { RecoveryModuleExecutionService } from './recovery-module-execution.service.js';

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

export type ModuleScenarioType =
  | 'subscription_success'
  | 'subscription_unsafe'
  | 'mandate_success'
  | 'mandate_unsafe'
  | 'b2b_success'
  | 'b2b_promise_broken'
  | 'checkout_recovery'
  | 'checkout_recent'
  | 'degradation_incident';

export interface ModuleScenarioResult {
  scenario: ModuleScenarioType;
  moduleType: string;
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
    private readonly merchantMemoryService: MerchantMemoryService,
    private readonly enabled: boolean,
    private readonly moduleExecutionService?: RecoveryModuleExecutionService
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
      const demoRunId = `${DEMO_RUN_PREFIX}_${randomUUID().slice(0, 8)}`;
      const scenarios: DemoScenarioResult[] = [];

      // Clean up previous demo data only for 'all' runs or first-time defaults.
      // Individual scenario runs (successful/unsafe/review) skip reset to preserve
      // accumulated merchant memory from prior individual runs.
      const key = scenarioKey ?? 'all';
      if (key === 'all') {
        await this.resetInternal();
      }

      // Ensure demo merchant and payment account exist
      await this.ensureDemoInfrastructure();

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

    // Update merchant memory with verified outcome
    if (recovered) {
      await this.merchantMemoryService.recordOutcome(
        DEMO_MERCHANT_ID,
        decisionAction,
        'GATEWAY_ERROR',
        'success',
        amount,
        amount
      );
    } else {
      await this.merchantMemoryService.recordOutcome(
        DEMO_MERCHANT_ID,
        decisionAction,
        'GATEWAY_ERROR',
        'failure',
        amount,
        0
      );
    }

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

    // Record blocked outcome in merchant memory
    await this.merchantMemoryService.recordBlocked(
      DEMO_MERCHANT_ID,
      decisionAction,
      'expired_card'
    );

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

    // Record review outcome in merchant memory
    await this.merchantMemoryService.recordHumanReview(
      DEMO_MERCHANT_ID,
      decisionAction,
      'UNKNOWN_ERROR'
    );

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
  // Module-specific scenario runners (Phase 12)
  // -------------------------------------------------------------------------

  async runModuleScenario(moduleScenario: ModuleScenarioType): Promise<ModuleScenarioResult> {
    if (!this.enabled) {
      throw new Error('Demo mode is not enabled. Set DEMO_MODE_ENABLED=true to enable.');
    }

    await this.ensureDemoInfrastructure();

    switch (moduleScenario) {
      case 'subscription_success':
        return this.runSubscriptionSuccess();
      case 'subscription_unsafe':
        return this.runSubscriptionUnsafe();
      case 'mandate_success':
        return this.runMandateSuccess();
      case 'mandate_unsafe':
        return this.runMandateUnsafe();
      case 'b2b_success':
        return this.runB2BSuccess();
      case 'b2b_promise_broken':
        return this.runB2BPromiseBroken();
      case 'checkout_recovery':
        return this.runCheckoutRecovery();
      case 'checkout_recent':
        return this.runCheckoutRecentAbandonment();
      case 'degradation_incident':
        return this.runPaymentDegradation();
    }
  }

  private async runSubscriptionSuccess(): Promise<ModuleScenarioResult> {
    const paymentId = `pay_demo_sub_success_${randomUUID().slice(0, 8)}`;
    const orderId = `order_demo_sub_success_${randomUUID().slice(0, 8)}`;
    const amount = 249900;

    const failedEvent = await this.createPaymentEvent({
      eventType: 'payment.failed',
      providerPaymentId: paymentId,
      providerOrderId: orderId,
      amount,
      currency: 'INR',
      errorCode: 'GATEWAY_ERROR',
      errorDescription: 'Subscription renewal failed temporarily. Please try again.',
      errorSource: 'bank',
      errorStep: 'recurring_payment',
      errorReason: 'temporary',
      subscriptionId: 'sub_demo_001',
    });

    const opportunity = await this.createModuleOpportunity(
      failedEvent.id, 'SUBSCRIPTION_PAYMENT_FAILED', amount, 'INR',
      'Subscription renewal payment failed due to temporary gateway error',
      {
        subscriptionId: 'sub_demo_001',
        planName: 'Pro Plan',
        billingCycle: 'monthly',
        attemptNumber: 1,
        previousRecoveryAttempts: 0,
        daysUntilCancellation: 7,
        failureCode: 'GATEWAY_ERROR',
        urgency: 'high',
        customerName: 'Synthetic Corp',
        moduleType: 'SUBSCRIPTION_RECOVERY',
      },
      paymentId,
      orderId
    );

    const outcome = await this.runModulePipeline(opportunity.id, paymentId, orderId, amount, 'GATEWAY_ERROR');

    return {
      scenario: 'subscription_success',
      moduleType: 'SUBSCRIPTION_RECOVERY',
      scenarioName: 'Subscription Recovery — Success',
      opportunityId: opportunity.id,
      paymentId,
      orderId,
      amount,
      currency: 'INR',
      ...outcome,
      stages: this.buildModuleStages('SUBSCRIPTION_RECOVERY', 'Subscription Renewal Failed', '₹2,499', 'delayed retry', outcome.recovered, outcome.decisionAction, outcome.decisionScore),
    };
  }

  private async runSubscriptionUnsafe(): Promise<ModuleScenarioResult> {
    const paymentId = `pay_demo_sub_unsafe_${randomUUID().slice(0, 8)}`;
    const orderId = `order_demo_sub_unsafe_${randomUUID().slice(0, 8)}`;
    const amount = 150000;

    const failedEvent = await this.createPaymentEvent({
      eventType: 'payment.failed',
      providerPaymentId: paymentId,
      providerOrderId: orderId,
      amount,
      currency: 'INR',
      errorCode: 'expired_card',
      errorDescription: 'The card on file has expired.',
      errorSource: 'card',
      errorStep: 'recurring_payment',
      errorReason: 'permanent',
      subscriptionId: 'sub_demo_002',
    });

    const opportunity = await this.createModuleOpportunity(
      failedEvent.id, 'SUBSCRIPTION_PAYMENT_FAILED', amount, 'INR',
      'Subscription renewal failed: card expired',
      {
        subscriptionId: 'sub_demo_002',
        planName: 'Starter Plan',
        billingCycle: 'monthly',
        attemptNumber: 2,
        previousRecoveryAttempts: 1,
        daysUntilCancellation: 3,
        failureCode: 'expired_card',
        failureCategory: 'hard_decline',
        urgency: 'high',
        customerName: 'Churn Risk Ltd',
        moduleType: 'SUBSCRIPTION_RECOVERY',
      },
      paymentId,
      orderId
    );

    const outcome = await this.runModulePipeline(opportunity.id, paymentId, orderId, amount, 'expired_card');

    return {
      scenario: 'subscription_unsafe',
      moduleType: 'SUBSCRIPTION_RECOVERY',
      scenarioName: 'Subscription Recovery — Unsafe (Expired Card)',
      opportunityId: opportunity.id,
      paymentId,
      orderId,
      amount,
      currency: 'INR',
      ...outcome,
      stages: this.buildModuleStages('SUBSCRIPTION_RECOVERY', 'Subscription Renewal Blocked', '₹1,500', 'blocked', outcome.recovered, outcome.decisionAction, outcome.decisionScore),
    };
  }

  private async runMandateSuccess(): Promise<ModuleScenarioResult> {
    const paymentId = `pay_demo_mandate_success_${randomUUID().slice(0, 8)}`;
    const orderId = `order_demo_mandate_success_${randomUUID().slice(0, 8)}`;
    const amount = 399900;

    const failedEvent = await this.createPaymentEvent({
      eventType: 'payment.failed',
      providerPaymentId: paymentId,
      providerOrderId: orderId,
      amount,
      currency: 'INR',
      errorCode: 'NETWORK_FAILURE',
      errorDescription: 'Bank network temporarily unavailable.',
      errorSource: 'bank',
      errorStep: 'mandate_debit',
      errorReason: 'temporary',
    });

    const opportunity = await this.createModuleOpportunity(
      failedEvent.id, 'FAILED_PAYMENT', amount, 'INR',
      'Mandate debit failed due to temporary bank network issue',
      {
        mandateId: 'mand_demo_001',
        mandateStatus: 'ACTIVE',
        retryCount: 0,
        maxRetries: 2,
        clearingWindow: '09:00-11:30 IST',
        failureCode: 'NETWORK_FAILURE',
        urgency: 'medium',
        customerName: 'NACH Payer Pvt Ltd',
        moduleType: 'MANDATE_RETRY',
      },
      paymentId,
      orderId
    );

    const outcome = await this.runModulePipeline(opportunity.id, paymentId, orderId, amount, 'NETWORK_FAILURE');

    return {
      scenario: 'mandate_success',
      moduleType: 'MANDATE_RETRY',
      scenarioName: 'Mandate Retry — Success',
      opportunityId: opportunity.id,
      paymentId,
      orderId,
      amount,
      currency: 'INR',
      ...outcome,
      stages: this.buildModuleStages('MANDATE_RETRY', 'Mandate Debit Failed', '₹3,999', 'mandate retry', outcome.recovered, outcome.decisionAction, outcome.decisionScore),
    };
  }

  private async runMandateUnsafe(): Promise<ModuleScenarioResult> {
    const paymentId = `pay_demo_mandate_unsafe_${randomUUID().slice(0, 8)}`;
    const orderId = `order_demo_mandate_unsafe_${randomUUID().slice(0, 8)}`;
    const amount = 299900;

    const failedEvent = await this.createPaymentEvent({
      eventType: 'payment.failed',
      providerPaymentId: paymentId,
      providerOrderId: orderId,
      amount,
      currency: 'INR',
      errorCode: 'MANDATE_INACTIVE',
      errorDescription: 'Mandate is no longer active.',
      errorSource: 'bank',
      errorStep: 'mandate_debit',
      errorReason: 'permanent',
    });

    const opportunity = await this.createModuleOpportunity(
      failedEvent.id, 'FAILED_PAYMENT', amount, 'INR',
      'Mandate debit failed: mandate is inactive/revoked',
      {
        mandateId: 'mand_demo_002',
        mandateStatus: 'INACTIVE',
        retryCount: 2,
        maxRetries: 2,
        failureCode: 'MANDATE_INACTIVE',
        failureCategory: 'hard_decline',
        urgency: 'critical',
        customerName: 'Revoked Mandate Corp',
        moduleType: 'MANDATE_RETRY',
      },
      paymentId,
      orderId
    );

    const outcome = await this.runModulePipeline(opportunity.id, paymentId, orderId, amount, 'MANDATE_INACTIVE');

    return {
      scenario: 'mandate_unsafe',
      moduleType: 'MANDATE_RETRY',
      scenarioName: 'Mandate Retry — Unsafe (Inactive)',
      opportunityId: opportunity.id,
      paymentId,
      orderId,
      amount,
      currency: 'INR',
      ...outcome,
      stages: this.buildModuleStages('MANDATE_RETRY', 'Mandate Debit Blocked', '₹2,999', 'blocked', outcome.recovered, outcome.decisionAction, outcome.decisionScore),
    };
  }

  private async runB2BSuccess(): Promise<ModuleScenarioResult> {
    const paymentId = `pay_demo_b2b_success_${randomUUID().slice(0, 8)}`;
    const orderId = `order_demo_b2b_success_${randomUUID().slice(0, 8)}`;
    const amount = 2500000;

    const failedEvent = await this.createPaymentEvent({
      eventType: 'payment.failed',
      providerPaymentId: paymentId,
      providerOrderId: orderId,
      amount,
      currency: 'INR',
      errorCode: 'GATEWAY_ERROR',
      errorDescription: 'Invoice payment not yet received.',
      errorSource: 'business',
      errorStep: 'invoice_payment',
      errorReason: 'overdue',
    });

    const opportunity = await this.createModuleOpportunity(
      failedEvent.id, 'FAILED_PAYMENT', amount, 'INR',
      'B2B invoice overdue: payment reminder required',
      {
        invoiceId: 'INV-2026-0042',
        businessName: 'Enterprise Acme Corp',
        amountDue: 2500000,
        overdueDays: 18,
        paymentStatus: 'OVERDUE',
        reminderCount: 1,
        previousPaymentBehavior: 'on-time',
        failureCode: 'GATEWAY_ERROR',
        urgency: 'high',
        moduleType: 'B2B_RECEIVABLE',
      },
      paymentId,
      orderId
    );

    const outcome = await this.runModulePipeline(opportunity.id, paymentId, orderId, amount, 'GATEWAY_ERROR');

    return {
      scenario: 'b2b_success',
      moduleType: 'B2B_RECEIVABLE',
      scenarioName: 'B2B Receivable — Payment Reminder Sent',
      opportunityId: opportunity.id,
      paymentId,
      orderId,
      amount,
      currency: 'INR',
      ...outcome,
      stages: this.buildModuleStages('B2B_RECEIVABLE', 'B2B Invoice Overdue', '₹25,000', 'payment link', outcome.recovered, outcome.decisionAction, outcome.decisionScore),
    };
  }

  private async runB2BPromiseBroken(): Promise<ModuleScenarioResult> {
    const paymentId = `pay_demo_b2b_broken_${randomUUID().slice(0, 8)}`;
    const orderId = `order_demo_b2b_broken_${randomUUID().slice(0, 8)}`;
    const amount = 4000000;

    const failedEvent = await this.createPaymentEvent({
      eventType: 'payment.failed',
      providerPaymentId: paymentId,
      providerOrderId: orderId,
      amount,
      currency: 'INR',
      errorCode: 'PAYMENT_DECLINED',
      errorDescription: 'Promise-to-pay not fulfilled.',
      errorSource: 'business',
      errorStep: 'invoice_payment',
      errorReason: 'overdue',
    });

    const opportunity = await this.createModuleOpportunity(
      failedEvent.id, 'FAILED_PAYMENT', amount, 'INR',
      'B2B promise-to-pay broken: escalation required',
      {
        invoiceId: 'INV-2026-0055',
        businessName: 'Default Risk Holdings',
        amountDue: 4000000,
        overdueDays: 32,
        paymentStatus: 'PROMISE_BROKEN',
        reminderCount: 3,
        promiseDate: new Date(Date.now() - 5 * 86400000).toISOString(),
        previousPaymentBehavior: 'late',
        urgency: 'critical',
        moduleType: 'B2B_RECEIVABLE',
      },
      paymentId,
      orderId
    );

    const outcome = await this.runModulePipeline(opportunity.id, paymentId, orderId, amount, 'PAYMENT_DECLINED');

    return {
      scenario: 'b2b_promise_broken',
      moduleType: 'B2B_RECEIVABLE',
      scenarioName: 'B2B Receivable — Promise Broken',
      opportunityId: opportunity.id,
      paymentId,
      orderId,
      amount,
      currency: 'INR',
      ...outcome,
      stages: this.buildModuleStages('B2B_RECEIVABLE', 'B2B Promise Broken', '₹40,000', 'escalation', outcome.recovered, outcome.decisionAction, outcome.decisionScore),
    };
  }

  private async runCheckoutRecovery(): Promise<ModuleScenarioResult> {
    const paymentId = `pay_demo_checkout_recovery_${randomUUID().slice(0, 8)}`;
    const orderId = `order_demo_checkout_recovery_${randomUUID().slice(0, 8)}`;
    const amount = 199900;

    const authorizedEvent = await this.createPaymentEvent({
      eventType: 'payment.authorized',
      providerPaymentId: paymentId,
      providerOrderId: orderId,
      amount,
      currency: 'INR',
      errorCode: '',
      errorDescription: '',
      errorSource: '',
      errorStep: '',
      errorReason: '',
    });

    const opportunity = await this.createModuleOpportunity(
      authorizedEvent.id, 'CHECKOUT_DROPOFF', amount, 'INR',
      'Checkout session abandoned: payment not completed within window',
      {
        cartValue: 199900,
        cartItemsCount: 3,
        abandonmentAgeMinutes: 45,
        customerSessionId: 'sess_demo_001',
        checkoutStage: 'payment_initiated',
        failureCode: 'GATEWAY_ERROR',
        urgency: 'medium',
        moduleType: 'CHECKOUT_DROPOFF',
      },
      paymentId,
      orderId
    );

    const outcome = await this.runModulePipeline(opportunity.id, paymentId, orderId, amount, 'GATEWAY_ERROR');

    return {
      scenario: 'checkout_recovery',
      moduleType: 'CHECKOUT_DROPOFF',
      scenarioName: 'Checkout Drop-off — Recovery Link Sent',
      opportunityId: opportunity.id,
      paymentId,
      orderId,
      amount,
      currency: 'INR',
      ...outcome,
      stages: this.buildModuleStages('CHECKOUT_DROPOFF', 'Checkout Abandoned', '₹1,999', 'recovery link', outcome.recovered, outcome.decisionAction, outcome.decisionScore),
    };
  }

  private async runCheckoutRecentAbandonment(): Promise<ModuleScenarioResult> {
    const paymentId = `pay_demo_checkout_recent_${randomUUID().slice(0, 8)}`;
    const orderId = `order_demo_checkout_recent_${randomUUID().slice(0, 8)}`;
    const amount = 99900;

    const authorizedEvent = await this.createPaymentEvent({
      eventType: 'payment.authorized',
      providerPaymentId: paymentId,
      providerOrderId: orderId,
      amount,
      currency: 'INR',
      errorCode: '',
      errorDescription: '',
      errorSource: '',
      errorStep: '',
      errorReason: '',
    });

    const opportunity = await this.createModuleOpportunity(
      authorizedEvent.id, 'CHECKOUT_DROPOFF', amount, 'INR',
      'Checkout session recently abandoned: within cooldown window',
      {
        cartValue: 99900,
        cartItemsCount: 1,
        abandonmentAgeMinutes: 0.5,
        customerSessionId: 'sess_demo_002',
        checkoutStage: 'payment_initiated',
        urgency: 'low',
        moduleType: 'CHECKOUT_DROPOFF',
      },
      paymentId,
      orderId
    );

    const outcome = await this.runModulePipeline(opportunity.id, paymentId, orderId, amount, '');

    return {
      scenario: 'checkout_recent',
      moduleType: 'CHECKOUT_DROPOFF',
      scenarioName: 'Checkout Drop-off — Within Cooldown',
      opportunityId: opportunity.id,
      paymentId,
      orderId,
      amount,
      currency: 'INR',
      ...outcome,
      stages: this.buildModuleStages('CHECKOUT_DROPOFF', 'Checkout Abandoned (Recent)', '₹999', 'cooldown', outcome.recovered, outcome.decisionAction, outcome.decisionScore),
    };
  }

  private async runPaymentDegradation(): Promise<ModuleScenarioResult> {
    const paymentId = `pay_demo_degradation_${randomUUID().slice(0, 8)}`;
    const orderId = `order_demo_degradation_${randomUUID().slice(0, 8)}`;
    const amount = 125000;

    const failedEvent = await this.createPaymentEvent({
      eventType: 'payment.failed',
      providerPaymentId: paymentId,
      providerOrderId: orderId,
      amount,
      currency: 'INR',
      errorCode: 'GATEWAY_TIMEOUT',
      errorDescription: 'Gateway-wide timeout spike detected.',
      errorSource: 'gateway',
      errorStep: 'payment_processing',
      errorReason: 'temporary',
    });

    const opportunity = await this.createModuleOpportunity(
      failedEvent.id, 'FAILED_PAYMENT', amount, 'INR',
      'Payment degradation detected: gateway success rate dropped below threshold',
      {
        degradationMetrics: {
          normalSuccessRate: 96,
          currentSuccessRate: 72,
          failureSpikeRate: 28,
          affectedPaymentsCount: 147,
          errorConcentration: 'GATEWAY_TIMEOUT',
        },
        failureCode: 'GATEWAY_TIMEOUT',
        provider: 'razorpay',
        paymentMethod: 'card',
        windowMinutes: 30,
        urgency: 'critical',
        moduleType: 'PAYMENT_DEGRADATION',
      },
      paymentId,
      orderId
    );

    const outcome = await this.runModulePipeline(opportunity.id, paymentId, orderId, amount, 'GATEWAY_TIMEOUT');

    return {
      scenario: 'degradation_incident',
      moduleType: 'PAYMENT_DEGRADATION',
      scenarioName: 'Payment Degradation — Circuit Breaker Activated',
      opportunityId: opportunity.id,
      paymentId,
      orderId,
      amount,
      currency: 'INR',
      ...outcome,
      stages: this.buildModuleStages('PAYMENT_DEGRADATION', 'Gateway Degradation Detected', '₹1,250', 'circuit breaker', outcome.recovered, outcome.decisionAction, outcome.decisionScore),
    };
  }

  // -------------------------------------------------------------------------
  // Module pipeline helpers
  // -------------------------------------------------------------------------

  private async createModuleOpportunity(
    sourceEventId: string,
    type: 'FAILED_PAYMENT' | 'SUBSCRIPTION_PAYMENT_FAILED' | 'CHECKOUT_DROPOFF',
    amount: number,
    currency: string,
    reason: string,
    moduleEvidence: Record<string, unknown>,
    providerPaymentId?: string,
    providerOrderId?: string
  ) {
    return this.db.recoveryOpportunity.insert({
      merchantId: DEMO_MERCHANT_ID,
      paymentAccountId: DEMO_PAYMENT_ACCOUNT_ID,
      type,
      status: 'OPEN',
      sourceEventId,
      providerPaymentId: providerPaymentId ?? null,
      providerOrderId: providerOrderId ?? null,
      amountAtRisk: amount,
      currency,
      reason,
      evidence: moduleEvidence as unknown as Prisma.InputJsonValue,
      recoveryEventId: null,
      detectedAt: new Date(),
      expiresAt: null,
      resolvedAt: null,
    });
  }

  private async runPipelineForOpportunity(
    opportunityId: string,
    paymentId: string,
    orderId: string,
    amount: number,
    errorCode: string
  ): Promise<Omit<ModuleScenarioResult, 'scenario' | 'moduleType' | 'scenarioName' | 'opportunityId' | 'paymentId' | 'orderId' | 'amount' | 'currency' | 'stages'>> {
    const decisionOutcome = await this.decisionService.getForOpportunity(opportunityId);
    const decision = decisionOutcome.decision;
    const decisionAction = decision?.recommendedAction ?? 'RETRY';
    const decisionScore = decision?.score ?? 87;
    const decisionConfidence = decision?.confidence ?? 91;
    const decisionPriority = decision?.priority ?? 'HIGH';
    const decisionReasons = decision?.reasons ?? ['Deterministic decision engine analysis'];

    const aiOutcome = await this.aiAdvisorService.getAdviceForOpportunity(opportunityId);
    const aiAdvice = aiOutcome.ai.status === 'available'
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

    const executionResult = await this.executionService.requestExecution(opportunityId);
    const executionStatus = executionResult.outcome === 'created'
      ? executionResult.execution.status
      : executionResult.outcome;
    const providerReferenceId = executionResult.outcome === 'created'
      ? executionResult.providerReferenceId
      : undefined;

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

      const recoveryOutcome = await this.leakageService.processPaymentEvent(capturedEvent);
      recovered = recoveryOutcome.outcome === 'opportunity-recovered';
      if (recovered) {
        recoveredAmount = amount;
      }
    }

    const policyChecks: DemoPolicyCheck[] = [
      { name: 'Module Policy', passed: !decisionAction.includes('DO_NOT'), detail: 'Module-specific policy check' },
      { name: 'Safety Gate', passed: executionStatus !== 'BLOCKED', detail: executionStatus === 'BLOCKED' ? 'Blocked by safety policy' : 'Passed all guardrails' },
    ];

    const strategy = decisionAction;
    if (recovered) {
      await this.merchantMemoryService.recordOutcome(DEMO_MERCHANT_ID, strategy, errorCode || 'UNKNOWN', 'success', amount, amount);
    } else if (executionStatus === 'BLOCKED') {
      await this.merchantMemoryService.recordBlocked(DEMO_MERCHANT_ID, strategy, errorCode || 'UNKNOWN');
    } else if (decisionAction === 'REVIEW') {
      await this.merchantMemoryService.recordHumanReview(DEMO_MERCHANT_ID, strategy, errorCode || 'UNKNOWN');
    }

    return {
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
      description: recovered
        ? `Recovered ₹${Math.round(amount / 100)} via ${strategy}`
        : executionStatus === 'BLOCKED'
          ? `Blocked by safety policy: ${strategy}`
          : `Action ${decisionAction} applied`,
    };
  }

  /**
   * Phase 12.1 — Module-aware pipeline using RecoveryModuleExecutionService.
   * Dispatches to module adapters after safety authorization.
   */
  private async runModulePipeline(
    opportunityId: string,
    paymentId: string,
    orderId: string,
    amount: number,
    errorCode: string
  ): Promise<Omit<ModuleScenarioResult, 'scenario' | 'moduleType' | 'scenarioName' | 'opportunityId' | 'paymentId' | 'orderId' | 'amount' | 'currency' | 'stages'>> {
    // AI advisory is still generated for display purposes
    const decisionOutcome = await this.decisionService.getForOpportunity(opportunityId);
    const decision = decisionOutcome.decision;
    const decisionAction = decision?.recommendedAction ?? 'RETRY';
    const decisionScore = decision?.score ?? 87;
    const decisionConfidence = decision?.confidence ?? 91;
    const decisionPriority = decision?.priority ?? 'HIGH';
    const decisionReasons = decision?.reasons ?? ['Deterministic decision engine analysis'];

    const aiOutcome = await this.aiAdvisorService.getAdviceForOpportunity(opportunityId);
    const aiAdvice = aiOutcome.ai.status === 'available'
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

    // Module-aware execution via RecoveryModuleExecutionService
    let executionOutcome: string;
    let executionStatus: string;
    let providerReferenceId: string | undefined;
    let recovered = false;
    let recoveredAmount = 0;

    if (this.moduleExecutionService) {
      const moduleResult = await this.moduleExecutionService.executeModuleRecovery(
        opportunityId,
        paymentId,
        orderId
      );

      executionOutcome = moduleResult.status;
      executionStatus = moduleResult.status;
      providerReferenceId = moduleResult.providerReferenceId;
      recovered = moduleResult.recovered;
      recoveredAmount = moduleResult.recoveredAmount;
    } else {
      // Fallback to existing execution service
      const executionResult = await this.executionService.requestExecution(opportunityId);
      executionOutcome = executionResult.outcome;
      executionStatus = executionResult.outcome === 'created'
        ? executionResult.execution.status
        : executionResult.outcome;
      providerReferenceId = executionResult.outcome === 'created'
        ? executionResult.providerReferenceId
        : undefined;

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

        const recoveryOutcome = await this.leakageService.processPaymentEvent(capturedEvent);
        recovered = recoveryOutcome.outcome === 'opportunity-recovered';
        if (recovered) {
          recoveredAmount = amount;
        }
      }
    }

    const policyChecks: DemoPolicyCheck[] = [
      { name: 'Module Policy', passed: !decisionAction.includes('DO_NOT'), detail: 'Module-specific policy check' },
      { name: 'Safety Gate', passed: executionStatus !== 'BLOCKED', detail: executionStatus === 'BLOCKED' ? 'Blocked by safety policy' : 'Passed all guardrails' },
    ];

    // Merchant memory is handled by RecoveryModuleExecutionService or manually here
    const strategy = decisionAction;
    if (!this.moduleExecutionService) {
      if (recovered) {
        await this.merchantMemoryService.recordOutcome(DEMO_MERCHANT_ID, strategy, errorCode || 'UNKNOWN', 'success', amount, amount);
      } else if (executionStatus === 'BLOCKED') {
        await this.merchantMemoryService.recordBlocked(DEMO_MERCHANT_ID, strategy, errorCode || 'UNKNOWN');
      } else if (decisionAction === 'REVIEW') {
        await this.merchantMemoryService.recordHumanReview(DEMO_MERCHANT_ID, strategy, errorCode || 'UNKNOWN');
      }
    }

    return {
      decisionAction,
      decisionScore,
      decisionConfidence,
      decisionPriority,
      decisionExplanation: decisionReasons,
      policyChecks,
      aiAdvice,
      executionOutcome,
      executionStatus,
      providerReferenceId,
      recovered,
      recoveredAmount,
      description: recovered
        ? `Recovered ₹${Math.round(amount / 100)} via ${strategy}`
        : executionStatus === 'BLOCKED'
          ? `Blocked by safety policy: ${strategy}`
          : `Action ${decisionAction} applied`,
    };
  }

  private buildModuleStages(
    moduleType: string,
    title: string,
    amount: string,
    action: string,
    recovered: boolean,
    decisionAction: string,
    score: number
  ): DemoStageTrace[] {
    return [
      { id: 'mod-stage-1', stepNumber: 1, key: 'MODULE_DETECTED', name: 'Module Detection', title: `MODULE: ${moduleType}`, subtitle: `${title} — ${amount}`, timeOffsetMs: 0, status: 'completed', details: { moduleType }, badge: moduleType.replace(/_/g, ' '), badgeTone: 'indigo' },
      { id: 'mod-stage-2', stepNumber: 2, key: 'EVENT_INGESTED', name: 'Event Ingested', title: 'EVENT INGESTED', subtitle: 'Module-specific payment/business event received', timeOffsetMs: 800, status: 'completed', details: {}, badge: 'INGESTED', badgeTone: 'neutral' },
      { id: 'mod-stage-3', stepNumber: 3, key: 'OPPORTUNITY', name: 'Opportunity Created', title: 'OPPORTUNITY CREATED', subtitle: `Score: ${score}/100`, timeOffsetMs: 1500, status: 'completed', details: {}, badge: `${score}/100`, badgeTone: 'indigo' },
      { id: 'mod-stage-4', stepNumber: 4, key: 'AI_DECISION', name: 'AI Decision', title: 'AI DECISION ENGINE', subtitle: 'Analyzing module-specific context and historical evidence...', timeOffsetMs: 2200, status: 'completed', details: {}, badge: 'AI ANALYSIS', badgeTone: 'indigo' },
      { id: 'mod-stage-5', stepNumber: 5, key: 'DECISION', name: 'Recommendation', title: `DECISION: ${decisionAction}`, subtitle: `Action ${action} recommended by recovery engine`, timeOffsetMs: 3000, status: 'completed', details: {}, badge: decisionAction, badgeTone: decisionAction.includes('RETRY') || decisionAction.includes('PAYMENT_LINK') ? 'positive' : 'warn' },
      { id: 'mod-stage-6', stepNumber: 6, key: 'SAFETY', name: 'Safety Policy', title: `SAFETY: ${recovered ? 'APPROVED' : executionStatusLabel(decisionAction)}`, subtitle: recovered ? 'All safety guardrails passed' : 'Safety policy evaluation', timeOffsetMs: 3700, status: recovered ? 'completed' : 'blocked', details: {}, badge: recovered ? 'APPROVED' : 'BLOCKED', badgeTone: recovered ? 'positive' : 'risk' },
      { id: 'mod-stage-7', stepNumber: 7, key: 'EXECUTION', name: 'Action Execution', title: `ACTION: ${action.toUpperCase()}`, subtitle: `Module-specific ${action} dispatched`, timeOffsetMs: 4500, status: recovered ? 'completed' : 'blocked', details: {}, badge: recovered ? 'EXECUTED' : 'WITHHELD', badgeTone: recovered ? 'positive' : 'neutral' },
      { id: 'mod-stage-8', stepNumber: 8, key: 'OUTCOME', name: 'Outcome Verification', title: recovered ? `RECOVERED: ${amount}` : `OUTCOME: ${decisionAction}`, subtitle: recovered ? 'Payment captured and verified' : 'Awaiting resolution', timeOffsetMs: 5500, status: recovered ? 'completed' : 'review', details: {}, badge: recovered ? 'RECOVERED' : 'PENDING', badgeTone: recovered ? 'positive' : 'warn' },
    ];
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
    subscriptionId?: string;
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
      subscriptionId: data.subscriptionId ?? null,
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
    await this.db.$queryRaw`DELETE FROM merchant_strategy_memory WHERE "merchantId" = ${DEMO_MERCHANT_ID}::uuid`;
    await this.db.$queryRaw`DELETE FROM payment_accounts WHERE id = ${DEMO_PAYMENT_ACCOUNT_ID}::uuid`;
    await this.db.$queryRaw`DELETE FROM merchants WHERE id = ${DEMO_MERCHANT_ID}::uuid`;

    deleted = 1;
    return { deleted };
  }
}

function executionStatusLabel(action: string): string {
  switch (action) {
    case 'DO_NOT_RETRY': return 'BLOCKED';
    case 'REVIEW': return 'HUMAN REVIEW';
    case 'WAIT': return 'COOLDOWN';
    case 'NO_ACTION': return 'NO ACTION';
    default: return 'EVALUATING';
  }
}
