import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './server.js';

let cookie = '';

async function createIntent(amount: number, idempotencyKey: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/payment_intents',
    headers: { cookie, 'idempotency-key': idempotencyKey },
    payload: { amount, currency: 'LKR', description: 'Integration test' },
  });
}

describe.sequential('sandbox API payment invariants', () => {
  beforeAll(async () => {
    await app.ready();
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        business_name: 'Integration Test Merchant',
        email: `integration-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`,
        password: 'IntegrationTest123!',
      },
    });
    expect(signup.statusCode).toBe(201);
    const setCookie = signup.headers['set-cookie'];
    expect(setCookie).toBeTypeOf('string');
    cookie = String(setCookie).split(';', 1)[0];
  });

  afterAll(async () => {
    await app.close();
  });

  it('enforces idempotency request consistency', async () => {
    const first = await createIntent(10_000, 'integration-idempotency');
    const replay = await createIntent(10_000, 'integration-idempotency');
    const conflict = await createIntent(20_000, 'integration-idempotency');

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(first.json().id);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.type).toBe('idempotency_error');
  });

  it('deduplicates concurrent requests with the same idempotency key', async () => {
    const key = `integration-idempotency-race-${Date.now()}`;
    const responses = await Promise.all([createIntent(15_000, key), createIntent(15_000, key)]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    expect(new Set(responses.map((response) => response.json().id)).size).toBe(1);
  });

  it('rejects webhook destinations on private networks', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhook_endpoints',
      headers: { cookie },
      payload: { url: 'http://127.0.0.1:9000/webhook' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('public');
  });

  it('persists and binds 3DS state, then fully reverses ledger balance on refund', async () => {
    const intentResponse = await createIntent(10_000, `integration-3ds-${Date.now()}`);
    const intent = intentResponse.json();
    const checkoutToken = new URL(intent.checkout_url).pathname.split('/').at(-1)!;

    const challenge = await app.inject({
      method: 'POST',
      url: `/checkout/${checkoutToken}/confirm`,
      payload: { card_number: '4000002500003155', expiry: '12/30', cvc: '123' },
    });
    expect(challenge.statusCode).toBe(200);
    expect(challenge.json().status).toBe('requires_action');

    const bypass = await app.inject({
      method: 'POST',
      url: `/checkout/${checkoutToken}/confirm`,
      payload: { card_number: '4242424242424242', expiry: '12/30', cvc: '123' },
    });
    expect(bypass.statusCode).toBe(409);

    const reloaded = await app.inject({ method: 'GET', url: `/checkout/${checkoutToken}` });
    expect(reloaded.json()).toMatchObject({
      status: 'requires_action',
      action_token: challenge.json().action_token,
    });

    const invalid3ds = await app.inject({
      method: 'POST',
      url: `/checkout/${checkoutToken}/3ds/complete`,
      payload: { action_token: '3ds_test_wrong_token' },
    });
    expect(invalid3ds.statusCode).toBe(400);

    const completed = await app.inject({
      method: 'POST',
      url: `/checkout/${checkoutToken}/3ds/complete`,
      payload: { action_token: challenge.json().action_token },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().payment.payment_method.last4).toBe('3155');

    const balanceAfterPayment = await app.inject({ method: 'GET', url: '/v1/balance', headers: { cookie } });
    expect(balanceAfterPayment.json().available).toBe('6750');

    const refund = await app.inject({
      method: 'POST',
      url: `/v1/payments/${completed.json().payment.id}/refunds`,
      headers: { cookie },
      payload: {},
    });
    expect(refund.statusCode).toBe(201);

    const balanceAfterRefund = await app.inject({ method: 'GET', url: '/v1/balance', headers: { cookie } });
    expect(balanceAfterRefund.json().available).toBe('0');
  });

  it('deduplicates concurrent successful confirmations', async () => {
    const intentResponse = await createIntent(20_000, `integration-concurrent-confirm-${Date.now()}`);
    const checkoutToken = new URL(intentResponse.json().checkout_url).pathname.split('/').at(-1)!;
    const request = () => app.inject({
      method: 'POST',
      url: `/checkout/${checkoutToken}/confirm`,
      payload: { card_number: '4242424242424242', expiry: '12/30', cvc: '123' },
    });

    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(new Set(responses.map((response) => response.json().payment.id)).size).toBe(1);
  });

  it('prevents concurrent refunds from exceeding the payment amount', async () => {
    const intentResponse = await createIntent(30_000, `integration-concurrent-refund-${Date.now()}`);
    const checkoutToken = new URL(intentResponse.json().checkout_url).pathname.split('/').at(-1)!;
    const completed = await app.inject({
      method: 'POST',
      url: `/checkout/${checkoutToken}/confirm`,
      payload: { card_number: '4242424242424242', expiry: '12/30', cvc: '123' },
    });
    const paymentId = completed.json().payment.id;
    const request = () => app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/refunds`,
      headers: { cookie },
      payload: { amount: 30_000 },
    });

    const responses = await Promise.all([request(), request()]);
    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(1);

    const payment = await app.inject({ method: 'GET', url: `/v1/payments/${paymentId}`, headers: { cookie } });
    expect(payment.json()).toMatchObject({ amount: '30000', amount_refunded: '30000', status: 'refunded' });
  });
});
