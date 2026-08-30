import type { RecoveryOpportunityType, RecoveryOpportunityStatus } from './recovery-opportunity.js';

export const RECOVERY_MODULE_TYPES = [
  'FAILED_PAYMENT',
  'SUBSCRIPTION_RECOVERY',
  'MANDATE_RETRY',
  'B2B_RECEIVABLE',
  'CHECKOUT_DROPOFF',
  'PAYMENT_DEGRADATION',
] as const;

export type RecoveryModuleType = (typeof RECOVERY_MODULE_TYPES)[number];

export interface RecoveryModuleInfo {
  type: RecoveryModuleType;
  name: string;
  shortName: string;
  description: string;
  triggerEvent: string;
  opportunityType: RecoveryOpportunityType;
  primaryAction: string;
  allowedActions: string[];
  defaultUrgency: 'low' | 'medium' | 'high' | 'critical';
  icon: string;
  badgeTone: 'indigo' | 'emerald' | 'amber' | 'rose' | 'slate' | 'cyan';
}

export interface RecoveryModuleEvidence {
  moduleType: RecoveryModuleType;
  customerName?: string;
  customerEmail?: string;
  customerTier?: string;
  businessName?: string;
  invoiceId?: string;
  subscriptionId?: string;
  mandateId?: string;
  planName?: string;
  overdueDays?: number;
  cartValue?: number;
  cartItemsCount?: number;
  degradationMetrics?: {
    normalSuccessRate: number;
    currentSuccessRate: number;
    failureSpikeRate: number;
    affectedPaymentsCount: number;
    errorConcentration: string;
  };
  urgency: 'low' | 'medium' | 'high' | 'critical';
  failureReason: string;
  allowedActions: string[];
  recommendedStrategy: string;
  actionStatus: string;
  actionAdapterType: string;
  actionAdapterMessage: string;
  [key: string]: unknown;
}

export const RECOVERY_MODULE_DEFINITIONS: Record<RecoveryModuleType, RecoveryModuleInfo> = {
  FAILED_PAYMENT: {
    type: 'FAILED_PAYMENT',
    name: 'Failed Payment Recovery',
    shortName: 'Failed Payments',
    description: 'Recovers one-time e-commerce and checkout card/UPI transaction failures with smart retry scheduling.',
    triggerEvent: 'payment.failed',
    opportunityType: 'FAILED_PAYMENT',
    primaryAction: 'RETRY',
    allowedActions: ['RETRY', 'WAIT', 'CUSTOMER_ACTION_REQUIRED', 'DO_NOT_RETRY', 'REVIEW'],
    defaultUrgency: 'high',
    icon: 'credit-card',
    badgeTone: 'emerald',
  },
  SUBSCRIPTION_RECOVERY: {
    type: 'SUBSCRIPTION_RECOVERY',
    name: 'Subscription Recovery',
    shortName: 'Subscriptions',
    description: 'Recovers recurring SaaS and subscription renewal failures with churn prevention and grace period management.',
    triggerEvent: 'subscription.charged',
    opportunityType: 'SUBSCRIPTION_PAYMENT_FAILED',
    primaryAction: 'RETRY_LATER',
    allowedActions: ['RETRY_LATER', 'SEND_PAYMENT_LINK', 'REQUEST_PAYMENT_METHOD_UPDATE', 'DO_NOT_RETRY', 'HUMAN_REVIEW'],
    defaultUrgency: 'high',
    icon: 'refresh-cw',
    badgeTone: 'indigo',
  },
  MANDATE_RETRY: {
    type: 'MANDATE_RETRY',
    name: 'Mandate & Autodebit Recovery',
    shortName: 'Mandates',
    description: 'Recovers standing instructions, e-mandates, and NACH debit failures with strict bank cooldown and retry limits.',
    triggerEvent: 'mandate.debited',
    opportunityType: 'FAILED_PAYMENT',
    primaryAction: 'RETRY_MANDATE',
    allowedActions: ['RETRY_MANDATE', 'RETRY_LATER', 'DO_NOT_RETRY', 'HUMAN_REVIEW'],
    defaultUrgency: 'medium',
    icon: 'shield-check',
    badgeTone: 'cyan',
  },
  B2B_RECEIVABLE: {
    type: 'B2B_RECEIVABLE',
    name: 'B2B Receivables Recovery',
    shortName: 'B2B Invoices',
    description: 'Recovers overdue enterprise invoices through non-intrusive payment links, account escalations, and automated dunning.',
    triggerEvent: 'invoice.overdue',
    opportunityType: 'FAILED_PAYMENT',
    primaryAction: 'SEND_PAYMENT_LINK',
    allowedActions: ['SEND_REMINDER', 'SEND_PAYMENT_LINK', 'ESCALATE_TO_ACCOUNT_MANAGER', 'SCHEDULE_FOLLOW_UP', 'DO_NOT_CONTACT', 'HUMAN_REVIEW'],
    defaultUrgency: 'high',
    icon: 'briefcase',
    badgeTone: 'amber',
  },
  CHECKOUT_DROPOFF: {
    type: 'CHECKOUT_DROPOFF',
    name: 'Checkout Abandonment Recovery',
    shortName: 'Checkout Drop-off',
    description: 'Recovers abandoned carts and incomplete payment sessions via timed recovery links before intent expires.',
    triggerEvent: 'checkout.abandoned',
    opportunityType: 'CHECKOUT_DROPOFF',
    primaryAction: 'RECOVERY_PAYMENT_LINK',
    allowedActions: ['RECOVERY_PAYMENT_LINK', 'CHECKOUT_REMINDER', 'RETRY_CHECKOUT', 'DO_NOT_CONTACT', 'HUMAN_REVIEW'],
    defaultUrgency: 'medium',
    icon: 'shopping-cart',
    badgeTone: 'rose',
  },
  PAYMENT_DEGRADATION: {
    type: 'PAYMENT_DEGRADATION',
    name: 'Payment Degradation Protection',
    shortName: 'Degradation Sentinel',
    description: 'Detects gateway-wide anomalies and failure spikes, automatically pausing retries to protect merchant score and customer trust.',
    triggerEvent: 'gateway.degraded',
    opportunityType: 'FAILED_PAYMENT',
    primaryAction: 'PAUSE_RETRIES',
    allowedActions: ['PAUSE_RETRIES', 'RETRY_AFTER_COOLDOWN', 'ROUTE_TO_ALTERNATE_STRATEGY', 'MONITOR', 'HUMAN_REVIEW'],
    defaultUrgency: 'critical',
    icon: 'alert-triangle',
    badgeTone: 'rose',
  },
};

export function getModuleInfo(type: RecoveryModuleType): RecoveryModuleInfo {
  return RECOVERY_MODULE_DEFINITIONS[type] ?? RECOVERY_MODULE_DEFINITIONS.FAILED_PAYMENT;
}

export function detectModuleFromEvidence(evidence: unknown, opportunityType?: RecoveryOpportunityType): RecoveryModuleType {
  if (typeof evidence === 'object' && evidence !== null) {
    const ev = evidence as Record<string, unknown>;
    if (typeof ev['moduleType'] === 'string' && RECOVERY_MODULE_TYPES.includes(ev['moduleType'] as RecoveryModuleType)) {
      return ev['moduleType'] as RecoveryModuleType;
    }
    if (ev['invoiceId'] || ev['businessName'] || ev['overdueDays']) {
      return 'B2B_RECEIVABLE';
    }
    if (ev['mandateId']) {
      return 'MANDATE_RETRY';
    }
    if (ev['degradationMetrics']) {
      return 'PAYMENT_DEGRADATION';
    }
    if (ev['subscriptionId'] || opportunityType === 'SUBSCRIPTION_PAYMENT_FAILED') {
      return 'SUBSCRIPTION_RECOVERY';
    }
    if (ev['cartValue'] || opportunityType === 'CHECKOUT_DROPOFF') {
      return 'CHECKOUT_DROPOFF';
    }
  }

  if (opportunityType === 'SUBSCRIPTION_PAYMENT_FAILED') return 'SUBSCRIPTION_RECOVERY';
  if (opportunityType === 'CHECKOUT_DROPOFF') return 'CHECKOUT_DROPOFF';
  return 'FAILED_PAYMENT';
}

export interface ModuleOpportunityItem {
  id: string;
  moduleType: RecoveryModuleType;
  moduleName: string;
  amount: number;
  currency: string;
  status: RecoveryOpportunityStatus;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  triggerEvent: string;
  failureReason: string;
  customerName: string;
  businessContext: string;
  detectedAt: string;
  resolvedAt: string | null;
  decision?: {
    recommendedAction: string;
    score: number;
    confidence: number;
    priority: string;
    reasons: string[];
  } | null;
  aiAdvice?: {
    summary: string;
    explanation: string;
    nextStep: string;
    confidence: number;
  } | null;
  policyResult: {
    passed: boolean;
    checks: Array<{ name: string; passed: boolean; detail: string }>;
  };
  action: {
    type: string;
    status: string;
    summary: string;
    providerReferenceId?: string;
  };
  outcome: {
    recovered: boolean;
    recoveredAmount: number;
    description: string;
  };
}

export interface RecoveryModuleSummary {
  moduleType: RecoveryModuleType;
  info: RecoveryModuleInfo;
  metrics: {
    totalOpportunities: number;
    revenueAtRisk: number;
    recoverableRevenue: number;
    recoveredRevenue: number;
    recoveryRate: number;
    activeCases: number;
    blockedActions: number;
    humanReviews: number;
  };
  opportunitiesCount: number;
  sampleOpportunities: ModuleOpportunityItem[];
}

export interface RecoveryModulesOverview {
  summary: {
    totalModules: number;
    totalOpportunities: number;
    totalRevenueAtRisk: number;
    totalRecoverableRevenue: number;
    totalRecoveredRevenue: number;
    overallRecoveryRate: number;
    totalBlockedActions: number;
    totalHumanReviews: number;
  };
  modules: RecoveryModuleSummary[];
}
