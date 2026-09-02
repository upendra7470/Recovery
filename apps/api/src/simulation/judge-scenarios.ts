/**
 * Phase 15 — Judge Mode Scenario Configurations.
 *
 * Each scenario maps to existing SyntheticDatasetService configuration.
 * No recovery logic lives here — only dataset generation parameters.
 */

export type JudgeScenarioId =
  | 'payment-failure-storm'
  | 'gateway-degradation'
  | 'mixed-recovery'
  | 'recovery-stress';

export interface JudgeScenario {
  id: JudgeScenarioId;
  name: string;
  description: string;
  /** Failure distribution overrides (rates that sum to <= 1.0). */
  distribution?: {
    successRate?: number;
    gatewayErrorRate?: number;
    networkErrorRate?: number;
    insufficientFundsRate?: number;
    expiredCardRate?: number;
    authenticationFailedRate?: number;
    unknownErrorRate?: number;
  };
  /** Dataset size defaults. */
  defaultSeed: number;
  defaultEvents: number;
  defaultMerchantCount: number;
}

export const JUDGE_SCENARIOS: readonly JudgeScenario[] = [
  {
    id: 'payment-failure-storm',
    name: 'Payment Failure Storm',
    description:
      'High volume of failed payments with multiple failure reasons. Demonstrates RecoveryOS detecting and recovering revenue from a surge of payment failures.',
    distribution: {
      successRate: 0.60,
      gatewayErrorRate: 0.12,
      networkErrorRate: 0.08,
      insufficientFundsRate: 0.08,
      expiredCardRate: 0.05,
      authenticationFailedRate: 0.04,
      unknownErrorRate: 0.03,
    },
    defaultSeed: 42,
    defaultEvents: 1000,
    defaultMerchantCount: 5,
  },
  {
    id: 'gateway-degradation',
    name: 'Gateway Degradation',
    description:
      'Concentrated gateway/network failures. Shows RecoveryOS identifying recoverable transient failures versus permanent declines.',
    distribution: {
      successRate: 0.70,
      gatewayErrorRate: 0.15,
      networkErrorRate: 0.10,
      insufficientFundsRate: 0.02,
      expiredCardRate: 0.01,
      authenticationFailedRate: 0.01,
      unknownErrorRate: 0.01,
    },
    defaultSeed: 77,
    defaultEvents: 1000,
    defaultMerchantCount: 5,
  },
  {
    id: 'mixed-recovery',
    name: 'Mixed Recovery',
    description:
      'Realistic mixture of successful payments, failures, recoverable cases, unsafe cases, and review-required cases.',
    distribution: {
      successRate: 0.82,
      gatewayErrorRate: 0.05,
      networkErrorRate: 0.04,
      insufficientFundsRate: 0.04,
      expiredCardRate: 0.02,
      authenticationFailedRate: 0.02,
      unknownErrorRate: 0.01,
    },
    defaultSeed: 123,
    defaultEvents: 1000,
    defaultMerchantCount: 5,
  },
  {
    id: 'recovery-stress',
    name: 'Recovery Stress Test',
    description:
      'Large-scale stress test. Processes the maximum event volume to verify pipeline throughput and accuracy under load.',
    distribution: {
      successRate: 0.75,
      gatewayErrorRate: 0.08,
      networkErrorRate: 0.06,
      insufficientFundsRate: 0.04,
      expiredCardRate: 0.03,
      authenticationFailedRate: 0.02,
      unknownErrorRate: 0.02,
    },
    defaultSeed: 999,
    defaultEvents: 10000,
    defaultMerchantCount: 10,
  },
] as const;

export function getJudgeScenario(id: string): JudgeScenario | undefined {
  return JUDGE_SCENARIOS.find((s) => s.id === id);
}

export function isValidJudgeScenarioId(id: string): id is JudgeScenarioId {
  return JUDGE_SCENARIOS.some((s) => s.id === id);
}
