import type { RecoveryModuleType } from '../domain/recovery-module.js';

export interface ModuleExecutionRequest {
  opportunityId: string;
  moduleType: RecoveryModuleType;
  amount: number;
  currency: string;
  recommendedAction: string;
  context: Record<string, unknown>;
}

export interface ModuleExecutionResult {
  outcome: 'executed' | 'blocked' | 'review_required' | 'monitoring';
  adapterName: string;
  actionSummary: string;
  providerReferenceId?: string;
  isRecovered: boolean;
  recoveredAmount: number;
  policyDetails: Array<{ name: string; passed: boolean; detail: string }>;
  details: Record<string, unknown>;
}

export interface RecoveryModuleAdapter {
  readonly moduleType: RecoveryModuleType;
  readonly name: string;
  execute(request: ModuleExecutionRequest): Promise<ModuleExecutionResult>;
}

/**
 * Adapter for Failed Payment Recovery (One-time cards & UPI).
 */
export class FailedPaymentModuleAdapter implements RecoveryModuleAdapter {
  readonly moduleType = 'FAILED_PAYMENT';
  readonly name = 'DemoFailedPaymentAdapter';

  // eslint-disable-next-line @typescript-eslint/require-await
  async execute(request: ModuleExecutionRequest): Promise<ModuleExecutionResult> {
    // Safety gate is authoritative — if we reach the adapter, execution is authorized.
    const shortId = request.opportunityId.slice(0, 8);
    return {
      outcome: 'executed',
      adapterName: this.name,
      actionSummary: 'Smart card retry dispatched to gateway via exponential backoff.',
      providerReferenceId: `demo_pay_retry_${shortId}`,
      isRecovered: true,
      recoveredAmount: request.amount,
      policyDetails: [
        { name: 'Retry Limit', passed: true, detail: '1 of 3 allowed attempts used' },
        { name: 'Amount Threshold', passed: true, detail: 'Within merchant policy ceiling' },
        { name: 'Failure Classification', passed: true, detail: 'Transient gateway error' },
        { name: 'Safety Gate', passed: true, detail: 'All guardrails passed' },
      ],
      details: { action: 'RETRY_DISPATCHED', method: 'card_retry' },
    };
  }
}

/**
 * Adapter for Subscription Recovery (SaaS renewal failures).
 */
export class SubscriptionModuleAdapter implements RecoveryModuleAdapter {
  readonly moduleType = 'SUBSCRIPTION_RECOVERY';
  readonly name = 'DemoSubscriptionAdapter';

  // eslint-disable-next-line @typescript-eslint/require-await
  async execute(request: ModuleExecutionRequest): Promise<ModuleExecutionResult> {
    const shortId = request.opportunityId.slice(0, 8);
    const plan = (request.context['planName'] as string) ?? 'Pro Plan';

    // Safety gate is authoritative — if we reach the adapter, execution is authorized.
    return {
      outcome: 'executed',
      adapterName: this.name,
      actionSummary: `Smart renewal schedule applied for ${plan}. Grace period preserved.`,
      providerReferenceId: `demo_sub_rec_${shortId}`,
      isRecovered: true,
      recoveredAmount: request.amount,
      policyDetails: [
        { name: 'Subscription Status', passed: true, detail: 'Active SaaS subscription' },
        { name: 'Billing History', passed: true, detail: 'Good historical standing (>12 mo)' },
        { name: 'Retry Timing Cooldown', passed: true, detail: 'Scheduled outside high-traffic window' },
        { name: 'Safety Gate', passed: true, detail: 'Authorized by deterministic safety policy' },
      ],
      details: {
        plan,
        recoveryMethod: 'smart_scheduled_retry',
        gracePeriodDays: 3,
      },
    };
  }
}

/**
 * Adapter for Mandate & Autodebit Recovery (e-mandates, NACH).
 */
export class MandateModuleAdapter implements RecoveryModuleAdapter {
  readonly moduleType = 'MANDATE_RETRY';
  readonly name = 'DemoMandateAdapter';

  // eslint-disable-next-line @typescript-eslint/require-await
  async execute(request: ModuleExecutionRequest): Promise<ModuleExecutionResult> {
    const mandateStatus = (request.context['mandateStatus'] as string) ?? 'ACTIVE';
    const retryCount = (request.context['retryCount'] as number) ?? 0;

    // Safety gate is authoritative — if we reach the adapter, execution is authorized.
    const shortId = request.opportunityId.slice(0, 8);
    return {
      outcome: 'executed',
      adapterName: this.name,
      actionSummary: 'Mandate debit re-presented to sponsor bank during clearing window.',
      providerReferenceId: `demo_mandate_${shortId}`,
      isRecovered: true,
      recoveredAmount: request.amount,
      policyDetails: [
        { name: 'Mandate Active Check', passed: mandateStatus === 'ACTIVE', detail: `Status: ${mandateStatus}` },
        { name: 'Bank Clearing Window', passed: true, detail: 'Representment within NACH/e-Sign cycle' },
        { name: 'Retry Limit', passed: true, detail: `${retryCount + 1} of 2 allowed attempts` },
        { name: 'Safety Gate', passed: true, detail: 'Authorized by deterministic safety policy' },
      ],
      details: { mandateStatus, retryCount, clearingWindow: '09:00 - 11:30 IST' },
    };
  }
}

/**
 * Adapter for B2B Receivables Recovery (Invoices & Enterprise Dunning).
 */
export class B2BReceivableModuleAdapter implements RecoveryModuleAdapter {
  readonly moduleType = 'B2B_RECEIVABLE';
  readonly name = 'DemoB2BReceivablesAdapter';

  // eslint-disable-next-line @typescript-eslint/require-await
  async execute(request: ModuleExecutionRequest): Promise<ModuleExecutionResult> {
    const invoiceId = (request.context['invoiceId'] as string) ?? 'INV-2026-0042';
    const businessName = (request.context['businessName'] as string) ?? 'Enterprise Client';
    const overdueDays = (request.context['overdueDays'] as number) ?? 7;

    const shortId = request.opportunityId.slice(0, 8);
    return {
      outcome: 'executed',
      adapterName: this.name,
      actionSummary: `Payment reminder prepared and one-click corporate payment link generated for ${invoiceId} (${businessName}).`,
      providerReferenceId: `demo_inv_link_${shortId}`,
      isRecovered: true,
      recoveredAmount: request.amount,
      policyDetails: [
        { name: 'Invoice Overdue Validation', passed: true, detail: `${overdueDays} days past due date` },
        { name: 'Account Escalation Protocol', passed: true, detail: 'Non-intrusive reminder within SLA' },
        { name: 'Payment Link Synthesis', passed: true, detail: 'Direct corporate RTGS/NEFT/Card gateway link prepared' },
        { name: 'Deterministic Safety Gate', passed: true, detail: 'Zero customer disruption threshold passed' },
      ],
      details: {
        invoiceId,
        businessName,
        overdueDays,
        actionPrepared: 'Payment reminder & Corporate payment link prepared (Synthetic)',
      },
    };
  }
}

/**
 * Adapter for Checkout Drop-off Recovery (Cart abandonment & intent capture).
 */
export class CheckoutDropoffModuleAdapter implements RecoveryModuleAdapter {
  readonly moduleType = 'CHECKOUT_DROPOFF';
  readonly name = 'DemoCheckoutDropoffAdapter';

  // eslint-disable-next-line @typescript-eslint/require-await
  async execute(request: ModuleExecutionRequest): Promise<ModuleExecutionResult> {
    const shortId = request.opportunityId.slice(0, 8);
    const cartItemsCount = (request.context['cartItemsCount'] as number) ?? 2;

    return {
      outcome: 'executed',
      adapterName: this.name,
      actionSummary: `Recovery checkout link generated for abandoned session (${cartItemsCount} items).`,
      providerReferenceId: `demo_cart_link_${shortId}`,
      isRecovered: true,
      recoveredAmount: request.amount,
      policyDetails: [
        { name: 'Intent Window Check', passed: true, detail: 'Cart active within 30-min window' },
        { name: 'Customer Channel Eligibility', passed: true, detail: 'Customer opted-in for recovery reminders' },
        { name: 'Duplicate Prevention', passed: true, detail: 'Single recovery link generated' },
        { name: 'Safety Policy', passed: true, detail: 'Fair reminder limit enforced' },
      ],
      details: {
        cartItemsCount,
        actionPrepared: 'Recovery payment link synthesized (Synthetic)',
      },
    };
  }
}

/**
 * Adapter for Payment Degradation Protection (Gateway-wide failure spike shielding).
 */
export class PaymentDegradationModuleAdapter implements RecoveryModuleAdapter {
  readonly moduleType = 'PAYMENT_DEGRADATION';
  readonly name = 'DemoPaymentDegradationAdapter';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await
  async execute(_request: ModuleExecutionRequest): Promise<ModuleExecutionResult> {
    // Module-specific policy: during gateway degradation, automated retries
    // are paused to protect merchant score and prevent cascade failures.
    // This is module-specific knowledge that the generic safety gate doesn't have.
    return {
      outcome: 'blocked',
      adapterName: this.name,
      actionSummary: 'Degradation Sentinel: Automated retries paused. Circuit breaker active to prevent customer churn and gateway penalties.',
      isRecovered: false,
      recoveredAmount: 0,
      policyDetails: [
        { name: 'Gateway Health Anomaly', passed: false, detail: 'Success rate dropped below threshold' },
        { name: 'Circuit Breaker Status', passed: false, detail: 'ACTIVE — Immediate retries suspended' },
        { name: 'Merchant Protection Rule', passed: true, detail: 'Shielding merchant score from excessive declines' },
        { name: 'Safety Gate', passed: true, detail: 'Authorized by safety policy, but module adapter blocked per degradation protocol' },
      ],
      details: {
        action: 'PAUSE_RETRIES',
        circuitBreaker: 'ACTIVE',
        gatewayStatus: 'DEGRADED',
        reason: 'Module-specific degradation protection protocol',
      },
    };
  }
}

export class ModuleAdapterRegistry {
  private readonly adapters: Map<RecoveryModuleType, RecoveryModuleAdapter> = new Map();

  constructor() {
    this.register(new FailedPaymentModuleAdapter());
    this.register(new SubscriptionModuleAdapter());
    this.register(new MandateModuleAdapter());
    this.register(new B2BReceivableModuleAdapter());
    this.register(new CheckoutDropoffModuleAdapter());
    this.register(new PaymentDegradationModuleAdapter());
  }

  register(adapter: RecoveryModuleAdapter): void {
    this.adapters.set(adapter.moduleType, adapter);
  }

  get(type: RecoveryModuleType): RecoveryModuleAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      return this.adapters.get('FAILED_PAYMENT')!;
    }
    return adapter;
  }
}
