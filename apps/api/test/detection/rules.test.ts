import { describe, expect, it } from 'vitest';
import type { DetectionWindowConfig } from '../../src/detection/detection-rule.js';
import { hasCapturedPayment } from '../../src/detection/detection-rule.js';
import { toEventView } from '../../src/detection/event-view.js';
import { CheckoutDropoffRule } from '../../src/detection/rules/checkout-dropoff.rule.js';
import { FailedPaymentRule } from '../../src/detection/rules/failed-payment.rule.js';
import { SubscriptionPaymentFailedRule } from '../../src/detection/rules/subscription-payment-failed.rule.js';
import { makeEventRow, normalizedData } from '../fixtures/payment-events.js';

const WINDOW: DetectionWindowConfig = { windowMs: 24 * 60 * 60 * 1000 };
const failedRule = new FailedPaymentRule();
const subscriptionRule = new SubscriptionPaymentFailedRule();
const dropoffRule = new CheckoutDropoffRule();

describe('FailedPaymentRule', () => {
  const base = { eventType: 'payment.failed' as const };

  it('detects a failed payment with no successful follow-up', () => {
    const event = makeEventRow(base);
    const finding = failedRule.evaluate({ event, relatedEvents: [], config: WINDOW });

    expect(finding).not.toBeNull();
    expect(finding?.type).toBe('FAILED_PAYMENT');
    expect(finding?.reason).toContain('no successful payment was observed');
    expect(finding?.expiresAt).toBeNull();
  });

  it('calculates the amount and currency from the source event', () => {
    const event = makeEventRow({ ...base, normalizedData: { amount: 249900, currency: 'INR' } });
    const finding = failedRule.evaluate({ event, relatedEvents: [], config: WINDOW });

    expect(finding?.evidence.amount).toBe(249900);
    expect(finding?.evidence.currency).toBe('INR');
    expect(finding?.evidence.sourceEventId).toBe(event.id);
    expect(finding?.evidence.providerPaymentId).toBe('pay_test_failed_1');
    expect(finding?.evidence.failureCode).toBe('PAYMENT_DECLINED');
  });

  it('does not create an opportunity when a captured payment for the same order follows', () => {
    const event = makeEventRow(base);
    const captured = makeEventRow({
      eventType: 'payment.captured',
      providerOrderId: 'order_test_1',
      providerPaymentId: 'pay_retry_success',
      normalizedData: { status: 'captured' },
    });
    const finding = failedRule.evaluate({ event, relatedEvents: [captured], config: WINDOW });

    expect(finding).toBeNull();
  });

  it('does not create an opportunity when the same payment id was captured', () => {
    const event = makeEventRow(base);
    const captured = makeEventRow({
      eventType: 'payment.captured',
      providerPaymentId: 'pay_test_failed_1',
    });
    expect(hasCapturedPayment(toEventView(event), [captured])).toBe(true);
  });

  it('skips events missing an amount (never invents money)', () => {
    const event = makeEventRow({ ...base, normalizedData: { amount: null } });
    expect(failedRule.evaluate({ event, relatedEvents: [], config: WINDOW })).toBeNull();
  });

  it('skips events missing a payment id', () => {
    const event = makeEventRow({ ...base, providerPaymentId: null });
    expect(failedRule.evaluate({ event, relatedEvents: [], config: WINDOW })).toBeNull();
  });

  it('skips events missing a currency', () => {
    const event = makeEventRow({ ...base, normalizedData: { currency: null } });
    expect(failedRule.evaluate({ event, relatedEvents: [], config: WINDOW })).toBeNull();
  });

  it('skips zero and negative amounts', () => {
    expect(
      failedRule.evaluate({
        event: makeEventRow({ ...base, normalizedData: { amount: 0 } }),
        relatedEvents: [],
        config: WINDOW,
      })
    ).toBeNull();
    expect(
      failedRule.evaluate({
        event: makeEventRow({ ...base, normalizedData: { amount: -5 } }),
        relatedEvents: [],
        config: WINDOW,
      })
    ).toBeNull();
  });

  it('ignores non-failure events', () => {
    const event = makeEventRow({ eventType: 'payment.captured' });
    expect(failedRule.evaluate({ event, relatedEvents: [], config: WINDOW })).toBeNull();
  });

  it('leaves subscription failures to the subscription rule', () => {
    const event = makeEventRow({
      ...base,
      normalizedData: { subscriptionId: 'sub_123' },
    });
    expect(failedRule.evaluate({ event, relatedEvents: [], config: WINDOW })).toBeNull();
  });

  it('handles rows with no normalized data defensively', () => {
    const row = makeEventRow(base);
    const broken = { ...row, normalizedData: null };
    expect(failedRule.evaluate({ event: broken, relatedEvents: [], config: WINDOW })).toBeNull();
  });
});

describe('SubscriptionPaymentFailedRule', () => {
  it('detects a failed recurring payment carrying a subscription id', () => {
    const event = makeEventRow({
      eventType: 'payment.failed',
      normalizedData: { subscriptionId: 'sub_ABC123' },
    });
    const finding = subscriptionRule.evaluate({ event, relatedEvents: [], config: WINDOW });

    expect(finding).not.toBeNull();
    expect(finding?.type).toBe('SUBSCRIPTION_PAYMENT_FAILED');
    expect(finding?.evidence.amount).toBe(249900);
    expect(finding?.reason).toContain('recurring');
  });

  it('ignores failures without subscription context instead of guessing', () => {
    const event = makeEventRow({ eventType: 'payment.failed' });
    expect(subscriptionRule.evaluate({ event, relatedEvents: [], config: WINDOW })).toBeNull();
  });

  it('does not fire when a successful payment for the same order exists', () => {
    const event = makeEventRow({
      eventType: 'payment.failed',
      normalizedData: { subscriptionId: 'sub_ABC123' },
    });
    const captured = makeEventRow({
      eventType: 'payment.captured',
      providerOrderId: 'order_test_1',
    });
    expect(
      subscriptionRule.evaluate({ event, relatedEvents: [captured], config: WINDOW })
    ).toBeNull();
  });

  it('skips incomplete subscription data (missing amount)', () => {
    const event = makeEventRow({
      eventType: 'payment.failed',
      normalizedData: { subscriptionId: 'sub_ABC123', amount: null },
    });
    expect(subscriptionRule.evaluate({ event, relatedEvents: [], config: WINDOW })).toBeNull();
  });
});

describe('CheckoutDropoffRule', () => {
  it('detects an authorized payment that is never captured or declined', () => {
    const event = makeEventRow({
      eventType: 'payment.authorized',
      providerPaymentId: 'pay_auth_1',
      normalizedData: normalizedData({ eventType: 'payment.authorized', status: 'authorized' }),
    });
    const finding = dropoffRule.evaluate({ event, relatedEvents: [], config: WINDOW });

    expect(finding).not.toBeNull();
    expect(finding?.type).toBe('CHECKOUT_DROPOFF');
    expect(finding?.expiresAt).toEqual(
      new Date(event.eventCreatedAt.getTime() + WINDOW.windowMs)
    );
  });

  it('is conservative when a capture arrives later in the window', () => {
    const event = makeEventRow({
      eventType: 'payment.authorized',
      providerPaymentId: 'pay_auth_1',
    });
    const captured = makeEventRow({
      eventType: 'payment.captured',
      providerPaymentId: 'pay_auth_1',
    });
    expect(
      dropoffRule.evaluate({ event, relatedEvents: [captured], config: WINDOW })
    ).toBeNull();
  });

  it('defers to failed-payment rules when an explicit failure exists', () => {
    const event = makeEventRow({ eventType: 'payment.authorized' });
    const failed = makeEventRow({ eventType: 'payment.failed' });
    expect(dropoffRule.evaluate({ event, relatedEvents: [failed], config: WINDOW })).toBeNull();
  });

  it('skips non-authorized events', () => {
    const event = makeEventRow({ eventType: 'payment.captured' });
    expect(dropoffRule.evaluate({ event, relatedEvents: [], config: WINDOW })).toBeNull();
  });
});
