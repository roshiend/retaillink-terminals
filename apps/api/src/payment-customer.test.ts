import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './bootstrap.js';

let cookie = '';
let customerA = '';
let customerB = '';

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
}

describe.sequential('Payment Intent customer association', () => {
  beforeAll(async () => {
    await app.ready();
    const signup = await app.inject({
      method: 'POST', url: '/auth/signup',
      payload: { business_name: 'Customer Payment Test', email: uniqueEmail('owner'), password: 'CustomerPayment123!' },
    });
    expect(signup.statusCode).toBe(201);
    cookie = String(signup.headers['set-cookie']).split(';', 1)[0];

    const first = await app.inject({ method: 'POST', url: '/v1/customers', headers: { cookie }, payload: { email: uniqueEmail('customer-a') } });
    const second = await app.inject({ method: 'POST', url: '/v1/customers', headers: { cookie }, payload: { email: uniqueEmail('customer-b') } });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    customerA = first.json().id;
    customerB = second.json().id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires idempotency when attaching a customer', async () => {
    const response = await app.inject({
      method: 'POST', url: '/v1/payment_intents', headers: { cookie },
      payload: { amount: 40_000, currency: 'LKR', customer: customerA },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('customer_requires_idempotency');
  });

  it('stores and returns the customer across create, retrieve and replay', async () => {
    const idempotencyKey = `customer-pi-${Date.now()}`;
    const created = await app.inject({
      method: 'POST', url: '/v1/payment_intents', headers: { cookie, 'idempotency-key': idempotencyKey },
      payload: { amount: 40_000, currency: 'LKR', merchant_reference: 'CUSTOMER-ORDER-1', customer: customerA },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().customer).toBe(customerA);

    const retrieved = await app.inject({ method: 'GET', url: `/v1/payment_intents/${created.json().id}`, headers: { cookie } });
    expect(retrieved.statusCode).toBe(200);
    expect(retrieved.json().customer).toBe(customerA);

    const replay = await app.inject({
      method: 'POST', url: '/v1/payment_intents', headers: { cookie, 'idempotency-key': idempotencyKey },
      payload: { amount: 40_000, currency: 'LKR', merchant_reference: 'CUSTOMER-ORDER-1', customer: customerA },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(created.json().id);
    expect(replay.json().customer).toBe(customerA);

    const conflictingReplay = await app.inject({
      method: 'POST', url: '/v1/payment_intents', headers: { cookie, 'idempotency-key': idempotencyKey },
      payload: { amount: 40_000, currency: 'LKR', merchant_reference: 'CUSTOMER-ORDER-1', customer: customerB },
    });
    expect(conflictingReplay.statusCode).toBe(409);
    expect(conflictingReplay.json().error.code).toBe('customer_idempotency_conflict');
  });
});
