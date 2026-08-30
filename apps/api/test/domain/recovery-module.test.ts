import { describe, expect, it } from 'vitest';
import {
  RECOVERY_MODULE_TYPES,
  RECOVERY_MODULE_DEFINITIONS,
  detectModuleFromEvidence,
  getModuleInfo,
  type RecoveryModuleType,
} from '../../src/domain/recovery-module.js';

describe('Recovery Module Domain (Phase 12)', () => {
  describe('RECOVERY_MODULE_TYPES', () => {
    it('contains all 6 module types', () => {
      expect(RECOVERY_MODULE_TYPES).toHaveLength(6);
      expect(RECOVERY_MODULE_TYPES).toContain('FAILED_PAYMENT');
      expect(RECOVERY_MODULE_TYPES).toContain('SUBSCRIPTION_RECOVERY');
      expect(RECOVERY_MODULE_TYPES).toContain('MANDATE_RETRY');
      expect(RECOVERY_MODULE_TYPES).toContain('B2B_RECEIVABLE');
      expect(RECOVERY_MODULE_TYPES).toContain('CHECKOUT_DROPOFF');
      expect(RECOVERY_MODULE_TYPES).toContain('PAYMENT_DEGRADATION');
    });
  });

  describe('RECOVERY_MODULE_DEFINITIONS', () => {
    it('has definitions for all module types', () => {
      for (const type of RECOVERY_MODULE_TYPES) {
        const def = RECOVERY_MODULE_DEFINITIONS[type];
        expect(def).toBeDefined();
        expect(def.type).toBe(type);
        expect(def.name).toBeTruthy();
        expect(def.shortName).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.triggerEvent).toBeTruthy();
        expect(def.allowedActions.length).toBeGreaterThan(0);
      }
    });

    it('each module has a badgeTone', () => {
      for (const type of RECOVERY_MODULE_TYPES) {
        expect(RECOVERY_MODULE_DEFINITIONS[type].badgeTone).toBeTruthy();
      }
    });
  });

  describe('getModuleInfo()', () => {
    it('returns correct info for each module type', () => {
      for (const type of RECOVERY_MODULE_TYPES) {
        const info = getModuleInfo(type);
        expect(info.type).toBe(type);
      }
    });

    it('falls back to FAILED_PAYMENT for unknown type', () => {
      const info = getModuleInfo('UNKNOWN_MODULE' as RecoveryModuleType);
      expect(info.type).toBe('FAILED_PAYMENT');
    });
  });

  describe('detectModuleFromEvidence()', () => {
    it('detects SUBSCRIPTION_RECOVERY from subscriptionId', () => {
      const result = detectModuleFromEvidence({ subscriptionId: 'sub_123' });
      expect(result).toBe('SUBSCRIPTION_RECOVERY');
    });

    it('detects SUBSCRIPTION_RECOVERY from opportunityType', () => {
      const result = detectModuleFromEvidence({}, 'SUBSCRIPTION_PAYMENT_FAILED');
      expect(result).toBe('SUBSCRIPTION_RECOVERY');
    });

    it('detects B2B_RECEIVABLE from invoiceId', () => {
      const result = detectModuleFromEvidence({ invoiceId: 'INV-001' });
      expect(result).toBe('B2B_RECEIVABLE');
    });

    it('detects B2B_RECEIVABLE from businessName', () => {
      const result = detectModuleFromEvidence({ businessName: 'Acme Corp' });
      expect(result).toBe('B2B_RECEIVABLE');
    });

    it('detects B2B_RECEIVABLE from overdueDays', () => {
      const result = detectModuleFromEvidence({ overdueDays: 18 });
      expect(result).toBe('B2B_RECEIVABLE');
    });

    it('detects MANDATE_RETRY from mandateId', () => {
      const result = detectModuleFromEvidence({ mandateId: 'mand_001' });
      expect(result).toBe('MANDATE_RETRY');
    });

    it('detects PAYMENT_DEGRADATION from degradationMetrics', () => {
      const result = detectModuleFromEvidence({
        degradationMetrics: {
          normalSuccessRate: 96,
          currentSuccessRate: 72,
          failureSpikeRate: 28,
          affectedPaymentsCount: 147,
          errorConcentration: 'GATEWAY_TIMEOUT',
        },
      });
      expect(result).toBe('PAYMENT_DEGRADATION');
    });

    it('detects CHECKOUT_DROPOFF from cartValue', () => {
      const result = detectModuleFromEvidence({ cartValue: 199900 });
      expect(result).toBe('CHECKOUT_DROPOFF');
    });

    it('detects CHECKOUT_DROPOFF from opportunityType', () => {
      const result = detectModuleFromEvidence({}, 'CHECKOUT_DROPOFF');
      expect(result).toBe('CHECKOUT_DROPOFF');
    });

    it('detects FAILED_PAYMENT as default fallback', () => {
      const result = detectModuleFromEvidence({});
      expect(result).toBe('FAILED_PAYMENT');
    });

    it('detects FAILED_PAYMENT from null evidence', () => {
      const result = detectModuleFromEvidence(null);
      expect(result).toBe('FAILED_PAYMENT');
    });

    it('respects explicit moduleType in evidence', () => {
      const result = detectModuleFromEvidence({ moduleType: 'MANDATE_RETRY' });
      expect(result).toBe('MANDATE_RETRY');
    });

    it('ignores invalid moduleType in evidence', () => {
      const result = detectModuleFromEvidence({ moduleType: 'INVALID' });
      expect(result).toBe('FAILED_PAYMENT');
    });

    it('priority: moduleType > invoiceId > mandateId > degradationMetrics > subscriptionId > cartValue > fallback', () => {
      const evidence = {
        moduleType: 'PAYMENT_DEGRADATION',
        invoiceId: 'INV-001',
        mandateId: 'mand_001',
        degradationMetrics: { normalSuccessRate: 96, currentSuccessRate: 72, failureSpikeRate: 28, affectedPaymentsCount: 147, errorConcentration: 'GATEWAY_TIMEOUT' },
        subscriptionId: 'sub_123',
        cartValue: 199900,
      };
      const result = detectModuleFromEvidence(evidence);
      expect(result).toBe('PAYMENT_DEGRADATION');
    });
  });
});
