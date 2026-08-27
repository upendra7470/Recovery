import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import {
  createDbExecutorMock,
  InMemoryPaymentEventStore,
  InMemoryRecoveryOpportunityStore,
  makeTestEnv,
} from '../helpers.js';
import type { WebhookAckResponse } from '../../src/routes/webhooks.js';
import {
  generateSignature,
  MALFORMED_PAYLOAD_MISSING_EVENT,
  PAYMENT_AUTHORIZED_PAYLOAD,
  PAYMENT_CAPTURED_PAYLOAD,
  PAYMENT_CAPTURED_RETRY_PAYLOAD,
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
  let opportunityStore: InMemoryRecoveryOpportunityStore;

  beforeEach(async () => {
    eventStore = new InMemoryPaymentEventStore();
    opportunityStore = new InMemoryRecoveryOpportunityStore();
    app = await buildApp({
      env: makeTestEnv(),
      db: createDbExecutorMock(undefined, {
        paymentEvent: eventStore,
        recoveryOpportunity: opportunityStore,
      }),
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

describe('Webhooks route detection integration', () => {
  let app: FastifyInstance;
  let eventStore: InMemoryPaymentEventStore;
  let opportunityStore: InMemoryRecoveryOpportunityStore;

  beforeEach(async () => {
    eventStore = new InMemoryPaymentEventStore();
    opportunityStore = new InMemoryRecoveryOpportunityStore();
    app = await buildApp({
      env: makeTestEnv(),
      db: createDbExecutorMock(undefined, {
        paymentEvent: eventStore,
        recoveryOpportunity: opportunityStore,
      }),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  function signedPost(payload: unknown, secret = WEBHOOK_SECRET) {
    const body = JSON.stringify(payload);
    return app.inject({
      method: 'POST',
      url: '/webhooks/razorpay',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': generateSignature(secret, body) },
      payload: body,
    });
  }

  it('creates an open FAILED_PAYMENT opportunity from a failed payment', async () => {
    const response = await signedPost(PAYMENT_FAILED_PAYLOAD);
    expect(response.statusCode).toBe(201);

    expect(opportunityStore.rows.size).toBe(1);
    const opportunity = [...opportunityStore.rows.values()][0]!;
    expect(opportunity.type).toBe('FAILED_PAYMENT');
    expect(opportunity.status).toBe('OPEN');
    expect(opportunity.amountAtRisk).toBe(100000);
    expect(opportunity.currency).toBe('INR');
    expect(opportunity.providerPaymentId).toBe('pay_ABCdef1234');
    expect(opportunity.providerOrderId).toBe('order_XYZabc999');
    // Attribution flows only from the stored source event (no account link → null).
    expect(opportunity.merchantId).toBeNull();

    const evidence = opportunity.evidence as Record<string, unknown>;
    expect(evidence['failureCode']).toBe('PAYMENT_FAILED');
    expect(evidence['amount']).toBe(100000);
  });

  it('does not duplicate the opportunity on replay', async () => {
    await signedPost(PAYMENT_FAILED_PAYLOAD);
    const replay = await signedPost(PAYMENT_FAILED_PAYLOAD);

    expect(replay.statusCode).toBe(200);
    expect(replay.json<WebhookAckResponse>().duplicate).toBe(true);
    expect(opportunityStore.rows.size).toBe(1);
  });

  it('marks the opportunity RECOVERED when a captured retry arrives', async () => {
    await signedPost(PAYMENT_FAILED_PAYLOAD);
    const captureResponse = await signedPost(PAYMENT_CAPTURED_RETRY_PAYLOAD);
    expect(captureResponse.statusCode).toBe(201);

    expect(opportunityStore.rows.size).toBe(1);
    const opportunity = [...opportunityStore.rows.values()][0]!;
    expect(opportunity.status).toBe('RECOVERED');
    expect(opportunity.recoveryEventId).not.toBeNull();
    expect(opportunity.resolvedAt).toBeInstanceOf(Date);

    const recoveryEvent = eventStore.rows.get(`razorpay:payment.captured:pay_RETRYok9876`);
    expect(recoveryEvent).toBeDefined();
    expect(opportunity.recoveryEventId).toBe(recoveryEvent?.id);
  });

  it('creates a CHECKOUT_DROPOFF opportunity from an authorized payment', async () => {
    const response = await signedPost(PAYMENT_AUTHORIZED_PAYLOAD);
    expect(response.statusCode).toBe(201);

    expect(opportunityStore.rows.size).toBe(1);
    const opportunity = [...opportunityStore.rows.values()][0]!;
    expect(opportunity.type).toBe('CHECKOUT_DROPOFF');
    expect(opportunity.status).toBe('OPEN');
    expect(opportunity.amountAtRisk).toBe(50000);
    expect(opportunity.expiresAt).toBeInstanceOf(Date);
  });

  it('does not create opportunities for unsupported events', async () => {
    await signedPost(UNSUPPORTED_EVENT_PAYLOAD);
    expect(eventStore.rows.size).toBe(0);
    expect(opportunityStore.rows.size).toBe(0);
  });

  it('does not create duplicate recovery events on duplicate captured webhooks', async () => {
    await signedPost(PAYMENT_FAILED_PAYLOAD);
    const firstCapture = await signedPost(PAYMENT_CAPTURED_RETRY_PAYLOAD);
    expect(firstCapture.statusCode).toBe(201);

    const opportunity = [...opportunityStore.rows.values()][0]!;
    expect(opportunity.status).toBe('RECOVERED');
    const firstRecoveryEventId = opportunity.recoveryEventId;

    // Send duplicate captured webhook
    const secondCapture = await signedPost(PAYMENT_CAPTURED_RETRY_PAYLOAD);
    expect(secondCapture.statusCode).toBe(200);
    expect(secondCapture.json<WebhookAckResponse>().duplicate).toBe(true);

    // Opportunity should still have the same recovery event
    const updatedOpportunity = [...opportunityStore.rows.values()][0]!;
    expect(updatedOpportunity.status).toBe('RECOVERED');
    expect(updatedOpportunity.recoveryEventId).toBe(firstRecoveryEventId);
  });
});
