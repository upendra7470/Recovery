import type { FastifyPluginAsync } from 'fastify';
import { RazorpayAdapter } from '../adapters/razorpay.js';
import { ValidationError } from '../lib/errors.js';
import {
  createDefaultDetectionRules,
  RevenueLeakageDetector,
} from '../detection/revenue-leakage.detector.js';
import { PaymentEventRepository } from '../repositories/payment-event.repository.js';
import {
  WebhookService,
  type WebhookEventStatus,
  type WebhookServiceConfig,
} from '../services/webhook.service.js';
import { RevenueLeakageService } from '../services/revenue-leakage.service.js';

export interface WebhookAckResponse {
  received: boolean;
  eventId: string;
  status: WebhookEventStatus;
  eventType: string;
  duplicate: boolean;
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  // Wired once per plugin instance, mirroring the app's dependency-injection
  // conventions: stores come from the decorated database contract.
  const repository = new PaymentEventRepository(app.db.paymentEvent, app.db.paymentAccount);
  const config: WebhookServiceConfig = {
    razorpayWebhookSecret: app.config.RAZORPAY_WEBHOOK_SECRET,
    defaultTestPaymentAccountId: app.config.DEFAULT_TEST_PAYMENT_ACCOUNT_ID,
  };
  const service = new WebhookService(new RazorpayAdapter(), repository, config);

  // Detection operates on the PERSISTED event; ingestion stays responsible
  // only for receiving and storing provider events.
  const detector = new RevenueLeakageDetector(createDefaultDetectionRules());
  const leakageService = new RevenueLeakageService(
    detector,
    app.opportunities,
    app.db.paymentEvent,
    { windowMs: app.config.DETECTION_WINDOW_HOURS * 60 * 60 * 1000 }
  );

  // Scoped to this plugin's encapsulation context: captures the exact raw
  // request bytes for signature verification while leaving JSON parsing
  // behavior on every other route untouched.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    if (!Buffer.isBuffer(body)) {
      done(new Error('Unexpected webhook body encoding.'), undefined);
      return;
    }
    request.rawBody = body;

    if (body.length === 0) {
      // Hand the decision to the route handler so it can answer 422.
      done(null, undefined);
      return;
    }

    try {
      done(null, JSON.parse(body.toString('utf8')));
    } catch (error) {
      // Malformed JSON must be a client error, matching Fastify's native
      // parser behavior on other routes.
      const parseError = Object.assign(
        error instanceof Error ? error : new Error('Malformed JSON body.'),
        { statusCode: 400 }
      );
      done(parseError, undefined);
    }
  });

  app.post<{ Reply: WebhookAckResponse }>('/webhooks/razorpay', async (request, reply) => {
    const rawBody = request.rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new ValidationError('Webhook body must not be empty.');
    }

    const signature = request.headers['x-razorpay-signature'];
    if (typeof signature !== 'string' || signature.length === 0) {
      throw new ValidationError('Missing X-Razorpay-Signature header.');
    }

    request.log.info({ provider: 'razorpay', requestId: request.id }, 'Webhook received');

    const result = await service.processWebhook({
      rawBody,
      signature,
      payload: request.body,
    });

    // Detection runs on the persisted event, for new and redelivered events
    // alike (it is idempotent). A detection failure never fails the webhook
    // acknowledgement — the event is safely stored for later reprocessing.
    if (result.event !== null) {
      try {
        const outcome = await leakageService.processPaymentEvent(result.event);
        request.log.info(
          { requestId: request.id, sourceEventId: outcome.sourceEventId, outcome: outcome.outcome },
          'Revenue leakage detection'
        );
      } catch (error) {
        request.log.error({ err: error }, 'Revenue leakage detection failed');
      }
    }

    request.log.info(
      {
        provider: 'razorpay',
        requestId: request.id,
        eventType: result.eventType,
        eventId: result.eventId,
        processingStatus: result.status,
      },
      'Webhook processed'
    );

    const statusCode = result.isNew && result.status === 'processed' ? 201 : 200;
    const body: WebhookAckResponse = {
      received: true,
      eventId: result.eventId,
      status: result.status,
      eventType: result.eventType,
      duplicate: !result.isNew,
    };
    return reply.status(statusCode).send(body);
  });
};
