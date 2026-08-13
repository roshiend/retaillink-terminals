import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './bootstrap.js';

let cookie = '';

function uniqueEmail() {
  return `intent-control-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
}

async function createIntent(amount: number) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/payment_intents',
    headers: { cookie, 'idempotency-key': `cancel-${amount}-${Date.now()}-${Math.random()}` },
    payload: { amount, currency: 'LKR', merchant_reference: `CANCEL-${amount}` },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

describe.sequential('payment intent cancellation', () => {
  beforeAll(async () => {
    await app.ready();
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { business_name: 'Intent Control Merchant', email: uniqueEmail(), password: 'IntentControl123!' },
    });
    expect(signup.statusCode).toBe(201);
    cookie = String(signup.headers['set-cookie']).split(';', 1)[0];
  });

  afterAll(async () => {
    await app.close();
  });

  it('cancels an unpaid intent and makes cancellation idempotent', async () => {
    const intent = await createIntent(45_000);

    const canceled = await app.inject({
      method: 'POST',
      url: `/v1/payment_intents/${intent.id}/cancel`,
      headers: { cookie },
      payload: {},
    });
    expect(canceled.statusCode).toBe(200);
    expect(canceled.json()).toMatchObject({ id: intent.id, status: 'canceled' });

    const repeated = await app.inject({
      method: 'POST',
      url: `/v1/payment_intents/${intent.id}/cancel`,
      headers: { cookie },
      payload: {},
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().status).toBe('canceled');

    const token = new URL(intent.checkout_url).pathname.split('/').at(-1)!;
    const checkout = await app.inject({
      method: 'POST',
      url: `/checkout/${token}/confirm`,
      payload: { card_number: '4242424242424242', expiry: '12/30', cvc: '123' },
    });
    expect(checkout.statusCode).toBe(409);
  });

  it('does not cancel a succeeded intent', async () => {
    const intent = await createIntent(52_000);
    const token = new URL(intent.checkout_url).pathname.split('/').at(-1)!;
    const paid = await app.inject({
      method: 'POST',
      url: `/checkout/${token}/confirm`,
      payload: { card_number: '4242424242424242', expiry: '12/30', cvc: '123' },
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().status).toBe('succeeded');

    const canceled = await app.inject({
      method: 'POST',
      url: `/v1/payment_intents/${intent.id}/cancel`,
      headers: { cookie },
      payload: {},
    });
    expect(canceled.statusCode).toBe(409);
    expect(canceled.json().error.code).toBe('payment_already_succeeded');
  });

  it('protects open invoice Payment Intents from direct cancellation', async () => {
    const customer = await app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: { cookie },
      payload: { name: 'Invoice Customer', email: uniqueEmail() },
    });
    expect(customer.statusCode).toBe(201);

    const subscription = await app.inject({
      method: 'POST',
      url: '/v1/subscriptions',
      headers: { cookie },
      payload: { customer: customer.json().id, amount: 65_000, currency: 'LKR', interval: 'month' },
    });
    expect(subscription.statusCode).toBe(201);
    const paymentIntentId = subscription.json().latest_invoice.payment_intent;
    expect(paymentIntentId).toBeTruthy();

    const canceled = await app.inject({
      method: 'POST',
      url: `/v1/payment_intents/${paymentIntentId}/cancel`,
      headers: { cookie },
      payload: {},
    });
    expect(canceled.statusCode).toBe(409);
    expect(canceled.json().error.code).toBe('invoice_payment_intent');
  });
});
