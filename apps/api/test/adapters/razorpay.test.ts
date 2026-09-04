import { describe, expect, it } from 'vitest';
import { RazorpayAdapter } from '../../src/adapters/razorpay.js';
import {
  generateSignature,
  MALFORMED_PAYMENT_ENTITY_NOT_OBJECT,
  MALFORMED_PAYLOAD_MISSING_EVENT,
  MALFORMED_PAYLOAD_MISSING_PAYMENT,
  PAYMENT_AUTHORIZED_PAYLOAD,
  PAYMENT_CAPTURED_PAYLOAD,
  PAYMENT_FAILED_PAYLOAD,
  PAYMENT_FUTURE_TIMESTAMP_PAYLOAD,
  PAYMENT_MINIMAL_PAYLOAD,
  PAYMENT_MISSING_ID_PAYLOAD,
  PAYMENT_NEGATIVE_AMOUNT_PAYLOAD,
  PAYMENT_ZERO_AMOUNT_PAYLOAD,
  UNSUPPORTED_EVENT_PAYLOAD,
  WEBHOOK_SECRET,
} from '../fixtures/razorpay.js';

describe('RazorpayAdapter', () => {
  const adapter = new RazorpayAdapter();

  describe('provider', () => {
    it('identifies as razorpay', () => {
      expect(adapter.provider).toBe('razorpay');
    });
  });

  describe('verifySignature', () => {
    it('accepts a valid signature', () => {
      const body = JSON.stringify(PAYMENT_CAPTURED_PAYLOAD);
      const signature = generateSignature(WEBHOOK_SECRET, body);
      expect(adapter.verifySignature(WEBHOOK_SECRET, Buffer.from(body), signature)).toBe(true);
    });

    it('rejects an invalid signature', () => {
      const body = JSON.stringify(PAYMENT_CAPTURED_PAYLOAD);
      expect(
        adapter.verifySignature(WEBHOOK_SECRET, Buffer.from(body), 'invalid_signature')
      ).toBe(false);
    });

    it('rejects a signature produced with the wrong secret', () => {
      const body = JSON.stringify(PAYMENT_CAPTURED_PAYLOAD);
      const signature = generateSignature(WEBHOOK_SECRET, body);
      expect(adapter.verifySignature('wrong_secret', Buffer.from(body), signature)).toBe(false);
    });

    it('rejects an empty signature', () => {
      const body = JSON.stringify(PAYMENT_CAPTURED_PAYLOAD);
      expect(adapter.verifySignature(WEBHOOK_SECRET, Buffer.from(body), '')).toBe(false);
    });

    it('rejects when the body is modified after signing', () => {
      const originalBody = JSON.stringify(PAYMENT_CAPTURED_PAYLOAD);
      const signature = generateSignature(WEBHOOK_SECRET, originalBody);
      const modifiedBody = JSON.stringify({ ...PAYMENT_CAPTURED_PAYLOAD, event: 'payment.failed' });
      expect(adapter.verifySignature(WEBHOOK_SECRET, Buffer.from(modifiedBody), signature)).toBe(
        false
      );
    });

    it('verifies against the exact raw bytes, not re-serialized JSON', () => {
      const rawBody = Buffer.from(JSON.stringify(PAYMENT_CAPTURED_PAYLOAD) + ' ');
      const signature = generateSignature(WEBHOOK_SECRET, rawBody.toString('utf8'));
      expect(adapter.verifySignature(WEBHOOK_SECRET, rawBody, signature)).toBe(true);
    });
  });

  describe('validatePayload', () => {
    it('returns the envelope for a valid payment.authorized payload', () => {
      expect(adapter.validatePayload(PAYMENT_AUTHORIZED_PAYLOAD)).toEqual({
        event: 'payment.authorized',
      });
    });

    it('returns the envelope for a valid payment.captured payload', () => {
      expect(adapter.validatePayload(PAYMENT_CAPTURED_PAYLOAD)).toEqual({
        event: 'payment.captured',
      });
    });

    it('returns the envelope for a valid payment.failed payload', () => {
      expect(adapter.validatePayload(PAYMENT_FAILED_PAYLOAD)).toEqual({ event: 'payment.failed' });
    });

    it('rejects a missing event field', () => {
      expect(() => adapter.validatePayload(MALFORMED_PAYLOAD_MISSING_EVENT)).toThrow();
    });

    it('rejects a supported event with a missing payment entity', () => {
      expect(() => adapter.validatePayload(MALFORMED_PAYLOAD_MISSING_PAYMENT)).toThrow();
    });

    it('rejects a supported event whose payment entity is not an object', () => {
      expect(() => adapter.validatePayload(MALFORMED_PAYMENT_ENTITY_NOT_OBJECT)).toThrow();
    });

    it('rejects a null payload', () => {
      expect(() => adapter.validatePayload(null)).toThrow();
    });

    it('rejects a non-object payload', () => {
      expect(() => adapter.validatePayload('not_an_object')).toThrow();
      expect(() => adapter.validatePayload(42)).toThrow();
      expect(() => adapter.validatePayload([])).toThrow();
    });
  });

  describe('supportsEvent', () => {
    it('accepts payment.authorized', () => {
      expect(adapter.supportsEvent('payment.authorized')).toBe(true);
    });

    it('accepts payment.captured', () => {
      expect(adapter.supportsEvent('payment.captured')).toBe(true);
    });

    it('accepts payment.failed', () => {
      expect(adapter.supportsEvent('payment.failed')).toBe(true);
    });

    it('rejects unsupported events such as refund.created', () => {
      expect(adapter.supportsEvent('refund.created')).toBe(false);
    });

    it('rejects empty and unknown event types', () => {
      expect(adapter.supportsEvent('')).toBe(false);
      expect(adapter.supportsEvent('payment.refunded')).toBe(false);
    });
  });

  describe('normalizeEvent', () => {
    it('normalizes a valid payment.authorized payload', () => {
      const result = adapter.normalizeEvent(PAYMENT_AUTHORIZED_PAYLOAD);
      expect(result).toMatchObject({
        provider: 'razorpay',
        eventType: 'payment.authorized',
        providerEventId: 'payment.authorized:pay_GHIjklMnOp',
        providerPaymentId: 'pay_GHIjklMnOp',
        providerOrderId: 'order_DEFghi789',
        amount: 50000,
        currency: 'INR',
        status: 'authorized',
        method: 'upi',
        email: 'customer@example.com',
        contact: '+919876543210',
        bank: null,
        errorCode: null,
        errorDescription: null,
        errorSource: null,
        errorStep: null,
        errorReason: null,
        providerAccountId: 'acc_123456',
      });
      expect(result.occurredAt).toEqual(new Date(1690000000 * 1000));
      expect(result.paymentCreatedAt).toEqual(new Date(1690000000 * 1000));
    });

    it('normalizes a valid payment.captured payload', () => {
      const result = adapter.normalizeEvent(PAYMENT_CAPTURED_PAYLOAD);
      expect(result).toMatchObject({
        eventType: 'payment.captured',
        providerPaymentId: 'pay_GHIjklMnOp',
        status: 'captured',
      });
    });

    it('normalizes a payment.failed payload including error details', () => {
      const result = adapter.normalizeEvent(PAYMENT_FAILED_PAYLOAD);
      expect(result).toMatchObject({
        eventType: 'payment.failed',
        providerPaymentId: 'pay_ABCdef1234',
        providerOrderId: 'order_XYZabc999',
        errorCode: 'PAYMENT_FAILED',
        errorDescription: 'Your card has insufficient funds.',
        errorSource: 'customer',
        errorStep: 'payment_authorization',
        errorReason: 'insufficient_funds',
      });
    });

    it('keeps amounts in the provider minor unit (paise)', () => {
      const result = adapter.normalizeEvent(PAYMENT_CAPTURED_PAYLOAD);
      expect(result.amount).toBe(50000);
    });

    it('coerces string amounts to numbers without conversion', () => {
      const payload = {
        ...PAYMENT_CAPTURED_PAYLOAD,
        payload: {
          payment: {
            ...PAYMENT_CAPTURED_PAYLOAD.payload.payment,
            amount: '25000',
          },
        },
      };
      const result = adapter.normalizeEvent(payload);
      expect(result.amount).toBe(25000);
    });

    it('derives a stable providerEventId from event type and payment id', () => {
      const first = adapter.normalizeEvent(PAYMENT_CAPTURED_PAYLOAD);
      const second = adapter.normalizeEvent(PAYMENT_CAPTURED_PAYLOAD);
      expect(first.providerEventId).toBe(second.providerEventId);

      const otherEvent = {
        ...PAYMENT_CAPTURED_PAYLOAD,
        event: 'payment.authorized',
      };
      expect(adapter.normalizeEvent(otherEvent).providerEventId).not.toBe(first.providerEventId);
    });

    it('handles payloads with optional fields missing', () => {
      const payload = {
        event: 'payment.authorized',
        created_at: 1690000000,
        payload: {
          payment: {
            id: 'pay_minimal',
            entity: 'payment',
            amount: 1000,
            currency: 'INR',
            status: 'authorized',
          },
        },
      };
      const result = adapter.normalizeEvent(payload);
      expect(result.providerOrderId).toBeNull();
      expect(result.method).toBeNull();
      expect(result.email).toBeNull();
      expect(result.contact).toBeNull();
      expect(result.bank).toBeNull();
      expect(result.errorCode).toBeNull();
      expect(result.paymentCreatedAt).toBeNull();
      // falls back to the payment created_at, then ingestion time
      expect(result.occurredAt).toEqual(new Date(1690000000 * 1000));
    });

    it('rejects normalization of a payload missing the payment entity', () => {
      expect(() =>
        adapter.normalizeEvent({
          event: 'payment.authorized',
          payload: { refund: { id: 'rfnd_123' } },
        })
      ).toThrow('payload.payment');
    });
  });

  describe('unsupported events pass envelope validation', () => {
    it('refund.created validates structurally but is not supported', () => {
      expect(adapter.validatePayload(UNSUPPORTED_EVENT_PAYLOAD)).toEqual({
        event: 'refund.created',
      });
      expect(adapter.supportsEvent('refund.created')).toBe(false);
    });
  });

  describe('edge-case payloads', () => {
    it('normalizes minimal payment payload with only required fields', () => {
      const result = adapter.normalizeEvent(PAYMENT_MINIMAL_PAYLOAD);
      expect(result).toMatchObject({
        provider: 'razorpay',
        eventType: 'payment.authorized',
        providerPaymentId: 'pay_MINimal123',
        amount: 10000,
        currency: 'INR',
        status: 'authorized',
        providerOrderId: null,
        method: null,
        email: null,
        contact: null,
        bank: null,
      });
    });

    it('normalizes zero-amount payment', () => {
      const result = adapter.normalizeEvent(PAYMENT_ZERO_AMOUNT_PAYLOAD);
      expect(result.amount).toBe(0);
      expect(result.eventType).toBe('payment.failed');
      expect(result.errorReason).toBe('invalid_amount');
    });

    it('normalizes negative-amount payment', () => {
      const result = adapter.normalizeEvent(PAYMENT_NEGATIVE_AMOUNT_PAYLOAD);
      expect(result.amount).toBe(-5000);
      expect(result.eventType).toBe('payment.failed');
      expect(result.errorSource).toBe('provider');
    });

    it('accepts payload missing id at envelope level (id validated on normalize)', () => {
      expect(adapter.validatePayload(PAYMENT_MISSING_ID_PAYLOAD)).toEqual({
        event: 'payment.failed',
      });
    });

    it('rejects normalization of payload missing required id field', () => {
      expect(() => adapter.normalizeEvent(PAYMENT_MISSING_ID_PAYLOAD)).toThrow('"id"');
    });

    it('normalizes future-timestamp payment', () => {
      const result = adapter.normalizeEvent(PAYMENT_FUTURE_TIMESTAMP_PAYLOAD);
      expect(result.occurredAt).toEqual(new Date(4102444800 * 1000));
      expect(result.paymentCreatedAt).toEqual(new Date(4102444800 * 1000));
    });
  });
});
