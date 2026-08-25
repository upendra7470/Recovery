import { createHmac } from 'node:crypto';

export const WEBHOOK_SECRET = 'test_webhook_secret_123';

export const PAYMENT_AUTHORIZED_PAYLOAD = {
  event: 'payment.authorized',
  account_id: 'acc_123456',
  created_at: 1690000000,
  payload: {
    payment: {
      id: 'pay_GHIjklMnOp',
      entity: 'payment',
      amount: 50000,
      currency: 'INR',
      status: 'authorized',
      order_id: 'order_DEFghi789',
      method: 'upi',
      email: 'customer@example.com',
      contact: '+919876543210',
      bank: null,
      created_at: 1690000000,
    },
  },
};

export const PAYMENT_CAPTURED_PAYLOAD = {
  event: 'payment.captured',
  account_id: 'acc_123456',
  created_at: 1690000100,
  payload: {
    payment: {
      id: 'pay_GHIjklMnOp',
      entity: 'payment',
      amount: 50000,
      currency: 'INR',
      status: 'captured',
      order_id: 'order_DEFghi789',
      method: 'upi',
      email: 'customer@example.com',
      contact: '+919876543210',
      bank: null,
      created_at: 1690000000,
      captured_at: 1690000100,
    },
  },
};

export const PAYMENT_FAILED_PAYLOAD = {
  event: 'payment.failed',
  account_id: 'acc_123456',
  created_at: 1690000050,
  payload: {
    payment: {
      id: 'pay_ABCdef1234',
      entity: 'payment',
      amount: 100000,
      currency: 'INR',
      status: 'failed',
      order_id: 'order_XYZabc999',
      method: 'card',
      email: 'declined@example.com',
      contact: '+919812345678',
      bank: 'HDFC',
      error_code: 'PAYMENT_FAILED',
      error_description: 'Your card has insufficient funds.',
      error_source: 'customer',
      error_step: 'payment_authorization',
      error_reason: 'insufficient_funds',
      created_at: 1690000050,
    },
  },
};

export const PAYMENT_NETBANKING_PAYLOAD = {
  event: 'payment.captured',
  account_id: 'acc_123456',
  created_at: 1690000200,
  payload: {
    payment: {
      id: 'pay_NB67890xyz',
      entity: 'payment',
      amount: 25000,
      currency: 'INR',
      status: 'captured',
      order_id: 'order_NB111222',
      method: 'netbanking',
      bank: 'ICICI',
      created_at: 1690000200,
    },
  },
};

export const UNSUPPORTED_EVENT_PAYLOAD = {
  event: 'refund.created',
  account_id: 'acc_123456',
  created_at: 1690000300,
  payload: {
    refund: {
      id: 'rfnd_abc123',
      entity: 'refund',
      amount: 10000,
      currency: 'INR',
      status: 'processed',
    },
  },
};

export const MALFORMED_PAYLOAD_MISSING_EVENT = {
  account_id: 'acc_123456',
  created_at: 1690000000,
  payload: {},
};

export const MALFORMED_PAYLOAD_MISSING_PAYMENT = {
  event: 'payment.captured',
  account_id: 'acc_123456',
  created_at: 1690000000,
  payload: {
    refund: { id: 'rfnd_123' },
  },
};

/** Valid Razorpay envelope shape except that `payload.payment` is not an object. */
export const MALFORMED_PAYMENT_ENTITY_NOT_OBJECT = {
  event: 'payment.captured',
  account_id: 'acc_123456',
  created_at: 1690000000,
  payload: {
    payment: 'not-an-object',
  },
};

export function generateSignature(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function signPayload(
  payload: object,
  secret: string = WEBHOOK_SECRET
): { body: string; signature: string } {
  const body = JSON.stringify(payload);
  return { body, signature: generateSignature(secret, body) };
}
