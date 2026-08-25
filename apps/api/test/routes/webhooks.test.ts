import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import {
  createDbExecutorMock,
  InMemoryPaymentEventStore,
  makeTestEnv,
} from '../helpers.js';
import type { WebhookAckResponse } from '../../src/routes/webhooks.js';
import {
  generateSignature,
  MALFORMED_PAYLOAD_MISSING_EVENT,
  PAYMENT_CAPTURED_PAYLOAD,
  PAYMENT_FAILED_PAYLOAD,
  UNSUPPORTED_EVENT_PAYLOAD,
  WEBHOOK_SECRET,
} from '../fixtures/razorpay.js';

interface ErrorResponse {
  error: { code: string; message: string };
}

describe('Webhooks route', () => {
  let app: FastifyInstance;
  let eventStore: InMemoryPaymentEventStore;

  beforeEach(async () => {
    eventStore = new InMemoryPaymentEventStore();
    app = await buildApp({
      env: makeTestEnv(),
      db: createDbExecutorMock(undefined, { paymentEvent: eventStore }),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  function post(body: string | undefined, headers: Record<string, string> = {}) {
    return app.inject({
      method: 'POST',
      url: '/webhooks/razorpay',
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { payload: body }),
    });
  }

  function signedPost(payload: unknown, secret = WEBHOOK_SECRET) {
    const body = JSON.stringify(payload);
    return post(body, { 'x-razorpay-signature': generateSignature(secret, body) }).then(
      (response) => ({ response, body })
    );
  }

  it('returns 201 and persists a new payment.captured event', async () => {
    const { response } = await signedPost(PAYMENT_CAPTURED_PAYLOAD);

    expect(response.statusCode).toBe(201);
    const result = response.json<WebhookAckResponse>();
    expect(result.received).toBe(true);
    expect(result.status).toBe('processed');
    expect(result.eventType).toBe('payment.captured');
    expect(result.duplicate).toBe(false);
    expect(eventStore.rows.size).toBe(1);
  });

  it('returns 200 for a duplicate delivery without creating another record', async () => {
    const first = await signedPost(PAYMENT_CAPTURED_PAYLOAD);
    expect(first.response.statusCode).toBe(201);

    const second = await signedPost(PAYMENT_CAPTURED_PAYLOAD);
    expect(second.response.statusCode).toBe(200);
    const result = second.response.json<WebhookAckResponse>();
    expect(result.status).toBe('duplicate');
    expect(result.duplicate).toBe(true);
    expect(eventStore.rows.size).toBe(1);
  });

  it('returns 201 for a payment.authorized event', async () => {
    const payload = {
      ...PAYMENT_CAPTURED_PAYLOAD,
      event: 'payment.authorized',
      payload: {
        payment: { ...PAYMENT_CAPTURED_PAYLOAD.payload.payment, status: 'authorized' },
      },
    };
    const { response } = await signedPost(payload);

    expect(response.statusCode).toBe(201);
    expect(response.json<WebhookAckResponse>().eventType).toBe('payment.authorized');
  });

  it('returns 201 for a payment.failed event', async () => {
    const { response } = await signedPost(PAYMENT_FAILED_PAYLOAD);

    expect(response.statusCode).toBe(201);
    expect(response.json<WebhookAckResponse>().eventType).toBe('payment.failed');
  });

  it('returns 200 for an unsupported event without persisting it', async () => {
    const { response } = await signedPost(UNSUPPORTED_EVENT_PAYLOAD);

    expect(response.statusCode).toBe(200);
    const result = response.json<WebhookAckResponse>();
    expect(result.status).toBe('unsupported');
    expect(result.eventType).toBe('refund.created');
    expect(eventStore.rows.size).toBe(0);
  });

  it('returns 422 for an invalid signature', async () => {
    const body = JSON.stringify(PAYMENT_CAPTURED_PAYLOAD);
    const response = await post(body, { 'x-razorpay-signature': 'invalid_signature' });

    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorResponse>().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 422 when the payload was modified after signing', async () => {
    const originalBody = JSON.stringify(PAYMENT_CAPTURED_PAYLOAD);
    const modifiedBody = JSON.stringify({ ...PAYMENT_CAPTURED_PAYLOAD, event: 'payment.failed' });
    const response = await post(modifiedBody, {
      'x-razorpay-signature': generateSignature(WEBHOOK_SECRET, originalBody),
    });

    expect(response.statusCode).toBe(422);
    expect(eventStore.rows.size).toBe(0);
  });

  it('returns 422 when the X-Razorpay-Signature header is missing', async () => {
    const body = JSON.stringify(PAYMENT_CAPTURED_PAYLOAD);
    const response = await post(body);

    expect(response.statusCode).toBe(422);
  });

  it('returns 422 for a malformed payload missing the event field', async () => {
    const { response } = await signedPost(MALFORMED_PAYLOAD_MISSING_EVENT);

    expect(response.statusCode).toBe(422);
  });

  it('returns 422 for a null payload', async () => {
    const response = await post('null', {
      'x-razorpay-signature': generateSignature(WEBHOOK_SECRET, 'null'),
    });

    expect(response.statusCode).toBe(422);
  });

  it('returns 422 for an empty body', async () => {
    const response = await post('', { 'x-razorpay-signature': 'some_signature' });

    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorResponse>().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 (client error) for malformed JSON', async () => {
    const response = await post('{ this is not json', {
      'x-razorpay-signature': 'some_signature',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorResponse>().error).toBeDefined();
  });

  it('does not leak webhook payloads into error responses', async () => {
    const body = JSON.stringify(PAYMENT_CAPTURED_PAYLOAD);
    const response = await post(body, { 'x-razorpay-signature': 'invalid_signature' });

    expect(response.body).not.toContain('customer@example.com');
  });
});
