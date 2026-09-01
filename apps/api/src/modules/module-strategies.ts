import type { RecoveryModuleType } from '../domain/recovery-module.js';
import type { MerchantMemoryStrategy } from '../domain/merchant-memory.js';

/**
 * Phase 12.3 — Module Strategy Candidates.
 *
 * Each recovery module exposes the set of valid strategies it can execute.
 * These are the ONLY strategies the AI may recommend for a given module.
 * The deterministic validation layer rejects any strategy not in this set.
 *
 * Strategy values reuse the existing MerchantMemoryStrategy type to ensure
 * merchant memory tracking and strategy execution share the same vocabulary.
 */

export interface ModuleStrategyCandidate {
  /** Strategy identifier — matches MerchantMemoryStrategy values. */
  strategy: MerchantMemoryStrategy;
  /** Human-readable label for UI display. */
  label: string;
  /** Whether this is the default strategy for cold-start / insufficient data. */
  isDefault: boolean;
  /** Whether this strategy is executable by a module adapter (vs. informational). */
  executable: boolean;
}

export interface ModuleStrategySet {
  moduleType: RecoveryModuleType;
  strategies: ModuleStrategyCandidate[];
}

/**
 * Valid strategy candidates per module type.
 *
 * The `isDefault` flag marks which strategy is used when merchant memory
 * has insufficient evidence to make an informed recommendation.
 */
export const MODULE_STRATEGY_CANDIDATES: Record<RecoveryModuleType, ModuleStrategyCandidate[]> = {
  FAILED_PAYMENT: [
    { strategy: 'RETRY', label: 'Smart Retry', isDefault: true, executable: true },
    { strategy: 'PAYMENT_LINK', label: 'Payment Link', isDefault: false, executable: true },
    { strategy: 'REVIEW', label: 'Human Review', isDefault: false, executable: false },
    { strategy: 'DO_NOT_RETRY', label: 'Do Not Retry', isDefault: false, executable: false },
  ],
  SUBSCRIPTION_RECOVERY: [
    { strategy: 'RETRY', label: 'Delayed Retry', isDefault: true, executable: true },
    { strategy: 'PAYMENT_LINK', label: 'Payment Link', isDefault: false, executable: true },
    { strategy: 'REVIEW', label: 'Human Review', isDefault: false, executable: false },
    { strategy: 'DO_NOT_RETRY', label: 'Do Not Retry', isDefault: false, executable: false },
  ],
  MANDATE_RETRY: [
    { strategy: 'RETRY', label: 'Mandate Representment', isDefault: true, executable: true },
    { strategy: 'REVIEW', label: 'Human Review', isDefault: false, executable: false },
    { strategy: 'DO_NOT_RETRY', label: 'Do Not Retry', isDefault: false, executable: false },
  ],
  B2B_RECEIVABLE: [
    { strategy: 'PAYMENT_LINK', label: 'Payment Link', isDefault: true, executable: true },
    { strategy: 'RETRY', label: 'Send Reminder', isDefault: false, executable: true },
    { strategy: 'REVIEW', label: 'Human Review', isDefault: false, executable: false },
    { strategy: 'DO_NOT_RETRY', label: 'Do Not Contact', isDefault: false, executable: false },
  ],
  CHECKOUT_DROPOFF: [
    { strategy: 'PAYMENT_LINK', label: 'Recovery Link', isDefault: true, executable: true },
    { strategy: 'RETRY', label: 'Checkout Retry', isDefault: false, executable: true },
    { strategy: 'REVIEW', label: 'Human Review', isDefault: false, executable: false },
    { strategy: 'DO_NOT_RETRY', label: 'Do Not Contact', isDefault: false, executable: false },
  ],
  PAYMENT_DEGRADATION: [
    { strategy: 'RETRY', label: 'Retry After Cooldown', isDefault: false, executable: true },
    { strategy: 'REVIEW', label: 'Human Review', isDefault: true, executable: false },
    { strategy: 'DO_NOT_RETRY', label: 'Pause Retries', isDefault: false, executable: false },
  ],
};

/**
 * Get the valid strategy candidates for a module type.
 */
export function getStrategyCandidates(moduleType: RecoveryModuleType): ModuleStrategyCandidate[] {
  return MODULE_STRATEGY_CANDIDATES[moduleType] ?? MODULE_STRATEGY_CANDIDATES.FAILED_PAYMENT;
}

/**
 * Get the default strategy for a module (used during cold-start).
 */
export function getDefaultStrategy(moduleType: RecoveryModuleType): MerchantMemoryStrategy {
  const candidates = getStrategyCandidates(moduleType);
  return candidates.find((c) => c.isDefault)?.strategy ?? 'RETRY';
}

/**
 * Validate that a strategy is valid for a given module type.
 */
export function isValidStrategyForModule(
  moduleType: RecoveryModuleType,
  strategy: string
): boolean {
  const candidates = getStrategyCandidates(moduleType);
  return candidates.some((c) => c.strategy === strategy);
}

/**
 * Map a recommended action to a memory-tracked strategy.
 * This handles the mapping between execution actions and memory strategies.
 */
export function actionToStrategy(action: string): MerchantMemoryStrategy {
  const mapping: Record<string, MerchantMemoryStrategy> = {
    RETRY: 'RETRY',
    RETRY_LATER: 'RETRY',
    RETRY_MANDATE: 'RETRY',
    SEND_PAYMENT_LINK: 'PAYMENT_LINK',
    RECOVERY_PAYMENT_LINK: 'PAYMENT_LINK',
    CHECKOUT_REMINDER: 'RETRY',
    RETRY_CHECKOUT: 'RETRY',
    REQUEST_PAYMENT_METHOD_UPDATE: 'REVIEW',
    DO_NOT_RETRY: 'DO_NOT_RETRY',
    DO_NOT_CONTACT: 'DO_NOT_RETRY',
    REVIEW: 'REVIEW',
    HUMAN_REVIEW: 'REVIEW',
    NO_ACTION: 'DO_NOT_RETRY',
    WAIT: 'RETRY',
    CUSTOMER_ACTION_REQUIRED: 'REVIEW',
    SEND_REMINDER: 'RETRY',
    ESCALATE_TO_ACCOUNT_MANAGER: 'REVIEW',
    SCHEDULE_FOLLOW_UP: 'RETRY',
    PAUSE_RETRIES: 'DO_NOT_RETRY',
    RETRY_AFTER_COOLDOWN: 'RETRY',
    ROUTE_TO_ALTERNATE_STRATEGY: 'PAYMENT_LINK',
    MONITOR: 'REVIEW',
  };
  return mapping[action] ?? 'REVIEW';
}
