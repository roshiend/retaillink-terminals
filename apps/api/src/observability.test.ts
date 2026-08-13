import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './bootstrap.js';

let cookie = '';

function uniqueEmail() {
  return `logs-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
}

describe.sequential('API request observability', () => {
  beforeAll(async () => {
    await app.ready();
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { business_name: 'API Log Test', email: uniqueEmail(), password: 'IntegrationTest123!' },
    });
    expect(signup.statusCode).toBe(201);
    cookie = String(signup.headers['set-cookie']).split(';', 1)[0];
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs payment API metadata without needing request-body storage', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: { cookie, 'idempotency-key': `api-log-${Date.now()}` },
      payload: { amount: 12_345, currency: 'LKR', merchant_reference: 'LOG-TEST-1' },
    });
    expect(created.statusCode).toBe(201);

    const listed = await app.inject({ method: 'GET', url: '/dashboard/api_logs', headers: { cookie } });
    expect(listed.statusCode).toBe(200);
    const log = listed.json().data.find((row: { path: string; method: string }) => row.path === '/v1/payment_intents' && row.method === 'POST');
    expect(log).toBeTruthy();
    expect(log).toMatchObject({ status: 201, source: 'session' });
    expect(log.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
