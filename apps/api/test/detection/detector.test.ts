import { describe, expect, it } from 'vitest';
import type { DetectionContext } from '../../src/detection/detection-rule.js';
import {
  createDefaultDetectionRules,
  RevenueLeakageDetector,
} from '../../src/detection/revenue-leakage.detector.js';
import { makeEventRow } from '../fixtures/payment-events.js';

const WINDOW = { windowMs: 24 * 60 * 60 * 1000 };
const detector = new RevenueLeakageDetector(createDefaultDetectionRules());

function ctx(partial: Partial<DetectionContext> = {}): DetectionContext {
  return {
    event: partial.event ?? makeEventRow({ eventType: 'payment.failed' }),
    relatedEvents: partial.relatedEvents ?? [],
    config: partial.config ?? WINDOW,
  };
}

describe('RevenueLeakageDetector', () => {
  it('runs all registered rules and collects their findings', () => {
    const findings = detector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('FAILED_PAYMENT');
  });

  it('produces exactly one finding per event (rules are mutually exclusive)', () => {
    const subscriptionFailure = makeEventRow({
      eventType: 'payment.failed',
      normalizedData: { subscriptionId: 'sub_1' },
    });
    expect(detector.evaluate(ctx({ event: subscriptionFailure }))).toHaveLength(1);

    const authorized = makeEventRow({
      eventType: 'payment.authorized',
      providerPaymentId: 'pay_auth_x',
    });
    expect(detector.evaluate(ctx({ event: authorized }))).toHaveLength(1);
  });

  it('is deterministic: identical input yields identical output', () => {
    const context = ctx();
    const first = detector.evaluate(context);
    const second = detector.evaluate(context);
    expect(first).toEqual(second);
  });

  it('returns no findings when no rule applies', () => {
    const captured = makeEventRow({
      eventType: 'payment.captured',
      normalizedData: { status: 'captured', errorCode: null },
    });
    expect(detector.evaluate(ctx({ event: captured }))).toEqual([]);
  });

  it('exposes the default rule set with the three Phase 3 categories', () => {
    const types = createDefaultDetectionRules().map((rule) => rule.type);
    expect(types).toContain('FAILED_PAYMENT');
    expect(types).toContain('SUBSCRIPTION_PAYMENT_FAILED');
    expect(types).toContain('CHECKOUT_DROPOFF');
  });
});
