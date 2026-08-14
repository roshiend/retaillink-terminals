import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sandboxCards } from '@retaillink/payment-core';
import { app } from './bootstrap.js';

let cookie = '';

function uniqueEmail() {
  return `card-guard-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
}

async function createIntent() {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/payment_intents',
    headers: { cookie, 'idempotency-key': `card-guard-${Date.now()}-${Math.random()}` },
    payload: { amount: 10_000, currency: 'LKR' },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

describe.sequential('sandbox card boundary', () => {
  beforeAll(async () => {
    await app.ready();
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { business_name: 'Card Guard Test', email: uniqueEmail(), password: 'IntegrationTest123!' },
    });
    expect(signup.statusCode).toBe(201);
    cookie = String(signup.headers['set-cookie']).split(';', 1)[0];
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects undocumented numbers before Payment Intent state changes', async () => {
    const intent = await createIntent();
    const token = new URL(intent.checkout_url).pathname.split('/').at(-1)!;
    const rejected = await app.inject({
      method: 'POST',
      url: `/checkout/${token}/confirm`,
      payload: { card_number: '123456789012', expiry: '12/30', cvc: '123' },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe('invalid_test_card');

    const unchanged = await app.inject({ method: 'GET', url: `/v1/payment_intents/${intent.id}`, headers: { cookie } });
    expect(unchanged.statusCode).toBe(200);
    expect(unchanged.json().status).toBe('requires_payment_method');
  });

  it('still supports the documented synthetic decline scenario', async () => {
    const intent = await createIntent();
    const token = new URL(intent.checkout_url).pathname.split('/').at(-1)!;
    const declined = await app.inject({
      method: 'POST',
      url: `/checkout/${token}/confirm`,
      payload: { card_number: sandboxCards.decline, expiry: '12/30', cvc: '123' },
    });
    expect(declined.statusCode).toBe(402);
    expect(declined.json().error.code).toBe('card_declined');

    const failed = await app.inject({ method: 'GET', url: `/v1/payment_intents/${intent.id}`, headers: { cookie } });
    expect(failed.json().status).toBe('failed');
  });
});
