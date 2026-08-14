import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './bootstrap.js';

let cookie = '';

function uniqueEmail() {
  return `refund-idempotency-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
}

async function createSucceededPayment(amount: number) {
  const intent = await app.inject({
    method: 'POST',
    url: '/v1/payment_intents',
    headers: { cookie, 'idempotency-key': `intent-${Date.now()}-${Math.random()}` },
    payload: { amount, currency: 'LKR' },
  });
  expect(intent.statusCode).toBe(201);
  const token = new URL(intent.json().checkout_url).pathname.split('/').at(-1)!;
  const paid = await app.inject({
    method: 'POST',
    url: `/checkout/${token}/confirm`,
    payload: { card_number: '4242424242424242', expiry: '12/30', cvc: '123' },
  });
  expect(paid.statusCode).toBe(200);
  return paid.json().payment.id as string;
}

describe.sequential('refund idempotency', () => {
  beforeAll(async () => {
    await app.ready();
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { business_name: 'Refund Idempotency Test', email: uniqueEmail(), password: 'IntegrationTest123!' },
    });
    expect(signup.statusCode).toBe(201);
    cookie = String(signup.headers['set-cookie']).split(';', 1)[0];
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the original refund when the same key and request are replayed', async () => {
    const paymentId = await createSucceededPayment(40_000);
    const key = `refund-${Date.now()}`;
    const request = () => app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/refunds`,
      headers: { cookie, 'idempotency-key': key },
      payload: { amount: 10_000, reason: 'duplicate-safe' },
    });

    const first = await request();
    const replay = await request();
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(first.json().id);

    const payment = await app.inject({ method: 'GET', url: `/v1/payments/${paymentId}`, headers: { cookie } });
    expect(payment.json().amount_refunded).toBe('10000');
  });

  it('rejects reuse of a refund key with a different request', async () => {
    const paymentId = await createSucceededPayment(50_000);
    const key = `refund-conflict-${Date.now()}`;
    const first = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/refunds`,
      headers: { cookie, 'idempotency-key': key },
      payload: { amount: 10_000 },
    });
    expect(first.statusCode).toBe(201);

    const conflict = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/refunds`,
      headers: { cookie, 'idempotency-key': key },
      payload: { amount: 20_000 },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('idempotency_key_conflict');
  });
});
