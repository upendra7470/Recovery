#!/usr/bin/env node

import { createHmac } from 'node:crypto';

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:4000/webhooks/razorpay';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_123';

function generateSignature(secret, body) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function createPayload(eventType, overrides = {}) {
  const base = {
    event: eventType,
    account_id: 'acc_test_local',
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      payment: {
        id: `pay_test_${Date.now()}`,
        entity: 'payment',
        amount: 50000,
        currency: 'INR',
        status: eventType.split('.')[1],
        order_id: `order_test_${Date.now()}`,
        method: 'upi',
        created_at: Math.floor(Date.now() / 1000),
        ...overrides,
      },
    },
  };
  return base;
}

async function sendWebhook(payload, options = {}) {
  const { expectStatus, label } = options;
  const body = JSON.stringify(payload);
  const signature = generateSignature(WEBHOOK_SECRET, body);

  console.log(`\n--- ${label || payload.event} ---`);
  console.log(`Sending to ${WEBHOOK_URL}`);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Razorpay-Signature': signature,
      },
      body,
    });

    const result = await response.json();
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(result, null, 2)}`);

    if (expectStatus && response.status !== expectStatus) {
      console.log(`FAIL: Expected ${expectStatus}, got ${response.status}`);
      process.exitCode = 1;
    } else {
      console.log('OK');
    }
  } catch (error) {
    console.log(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const eventType = args[0] || 'payment.captured';

  const scenarios = {
    'payment.authorized': () => createPayload('payment.authorized'),
    'payment.captured': () => createPayload('payment.captured'),
    'payment.failed': () =>
      createPayload('payment.failed', {
        error_code: 'PAYMENT_FAILED',
        error_description: 'Insufficient funds',
        error_source: 'customer',
        error_step: 'payment_authorization',
        error_reason: 'insufficient_funds',
      }),
    duplicate: () => {
      const payload = createPayload('payment.captured');
      return { payload, duplicate: payload };
    },
    'invalid-signature': () => ({
      payload: createPayload('payment.captured'),
      badSignature: 'invalid_signature_value',
    }),
    'modified-payload': (originalPayload) => ({
      payload: { ...originalPayload, event: 'payment.captured' },
      originalBody: JSON.stringify(originalPayload),
    }),
    unsupported: () => ({
      event: 'refund.created',
      account_id: 'acc_test_local',
      created_at: Math.floor(Date.now() / 1000),
      payload: { refund: { id: 'rfnd_test', entity: 'refund', amount: 10000 } },
    }),
    malformed: () => ({ not_an_event: true }),
  };

  if (eventType === 'duplicate') {
    const scenario = scenarios.duplicate();
    await sendWebhook(scenario.payload, { label: 'Duplicate - first' });
    await sendWebhook(scenario.duplicate, { label: 'Duplicate - second', expectStatus: 200 });
  } else if (eventType === 'invalid-signature') {
    const scenario = scenarios['invalid-signature']();
    const body = JSON.stringify(scenario.payload);
    console.log(`\n--- invalid-signature ---`);
    console.log(`Sending to ${WEBHOOK_URL}`);
    try {
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': scenario.badSignature,
        },
        body,
      });
      const result = await response.json();
      console.log(`Status: ${response.status}`);
      console.log(`Response: ${JSON.stringify(result, null, 2)}`);
      if (response.status === 422) {
        console.log('OK - signature correctly rejected');
      } else {
        console.log('FAIL: Expected 422');
        process.exitCode = 1;
      }
    } catch (error) {
      console.log(`ERROR: ${error.message}`);
      process.exitCode = 1;
    }
  } else if (eventType === 'modified-payload') {
    const originalPayload = createPayload('payment.captured');
    const modifiedBody = JSON.stringify({ ...originalPayload, event: 'payment.failed' });
    const signature = generateSignature(WEBHOOK_SECRET, JSON.stringify(originalPayload));
    console.log(`\n--- modified-payload ---`);
    console.log(`Sending modified body with original signature`);
    try {
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': signature,
        },
        body: modifiedBody,
      });
      const result = await response.json();
      console.log(`Status: ${response.status}`);
      console.log(`Response: ${JSON.stringify(result, null, 2)}`);
      if (response.status === 422) {
        console.log('OK - modified payload correctly rejected');
      } else {
        console.log('FAIL: Expected 422');
        process.exitCode = 1;
      }
    } catch (error) {
      console.log(`ERROR: ${error.message}`);
      process.exitCode = 1;
    }
  } else if (eventType === 'unsupported') {
    const payload = scenarios.unsupported();
    await sendWebhook(payload, { label: 'Unsupported event', expectStatus: 200 });
  } else if (eventType === 'malformed') {
    const payload = scenarios.malformed();
    await sendWebhook(payload, { label: 'Malformed payload', expectStatus: 422 });
  } else if (scenarios[eventType]) {
    await sendWebhook(scenarios[eventType](), { label: eventType });
  } else {
    console.log(`Unknown scenario: ${eventType}`);
    console.log(`Available: payment.authorized, payment.captured, payment.failed, duplicate, invalid-signature, modified-payload, unsupported, malformed`);
    process.exitCode = 1;
  }
}

main();
