import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './bootstrap.js';

let cookie = '';

async function createKey(name: string, scopes: string[]) {
  const response = await app.inject({
    method: 'POST',
    url: '/dashboard/api_keys/scoped',
    headers: { cookie },
    payload: { name, scopes },
  });
  expect(response.statusCode).toBe(201);
  return response.json().secret as string;
}

describe.sequential('restricted API keys', () => {
  beforeAll(async () => {
    await app.ready();
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        business_name: 'Scoped Key Test',
        email: `scoped-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`,
        password: 'IntegrationTest123!',
      },
    });
    expect(signup.statusCode).toBe(201);
    cookie = String(signup.headers['set-cookie']).split(';', 1)[0];
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows a read scope to read payments but not create them', async () => {
    const secret = await createKey('Payments reader', ['payments:read']);
    const auth = { authorization: `Bearer ${secret}` };

    const list = await app.inject({ method: 'GET', url: '/v1/payment_intents', headers: auth });
    expect(list.statusCode).toBe(200);

    const create = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: { ...auth, 'idempotency-key': `scope-read-${Date.now()}` },
      payload: { amount: 5_000, currency: 'LKR' },
    });
    expect(create.statusCode).toBe(403);
    expect(create.json().error).toMatchObject({ code: 'insufficient_api_key_scope', required_scope: 'payments:write' });
  });

  it('allows a write scope to create payments but denies unrelated customer access', async () => {
    const secret = await createKey('Payments writer', ['payments:write']);
    const auth = { authorization: `Bearer ${secret}` };

    const create = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: { ...auth, 'idempotency-key': `scope-write-${Date.now()}` },
      payload: { amount: 7_500, currency: 'LKR' },
    });
    expect(create.statusCode).toBe(201);

    const customers = await app.inject({ method: 'GET', url: '/v1/customers', headers: auth });
    expect(customers.statusCode).toBe(403);
    expect(customers.json().error).toMatchObject({ code: 'insufficient_api_key_scope', required_scope: 'customers:read' });
  });

  it('can combine scopes on one key and lists them without exposing the secret', async () => {
    await createKey('Integration key', ['payments:read', 'payments:write', 'refunds:write']);
    const list = await app.inject({ method: 'GET', url: '/dashboard/api_keys/scoped', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const key = list.json().data.find((row: { name: string }) => row.name === 'Integration key');
    expect(key.scopes).toEqual(['payments:read', 'payments:write', 'refunds:write']);
    expect(key.secret).toBeUndefined();
    expect(list.json().available_scopes).toContain('webhooks:write');
  });
});
