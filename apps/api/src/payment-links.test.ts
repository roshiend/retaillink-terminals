import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './bootstrap.js';

let cookie = '';

function uniqueEmail() {
  return `payment-links-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
}

describe.sequential('payment links', () => {
  beforeAll(async () => {
    await app.ready();
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { business_name: 'Payment Link Merchant', email: uniqueEmail(), password: 'IntegrationTest123!' },
    });
    expect(signup.statusCode).toBe(201);
    cookie = String(signup.headers['set-cookie']).split(';', 1)[0];
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a reusable link without creating a payment on public GET', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/payment_links',
      headers: { cookie },
      payload: {
        title: 'Order deposit',
        description: 'Sandbox deposit',
        amount: 75_000,
        currency: 'LKR',
        merchant_reference_prefix: 'DEPOSIT',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ object: 'payment_link', amount: '75000', currency: 'LKR', active: true });

    const token = new URL(created.json().url).pathname.split('/').at(-1)!;
    const before = await app.inject({ method: 'GET', url: '/v1/payment_intents', headers: { cookie } });
    const beforeCount = before.json().data.length;

    const landing = await app.inject({ method: 'GET', url: `/public/payment_links/${token}` });
    expect(landing.statusCode).toBe(200);
    expect(landing.json()).toMatchObject({ merchant_name: 'Payment Link Merchant', title: 'Order deposit', amount: '75000' });

    const after = await app.inject({ method: 'GET', url: '/v1/payment_intents', headers: { cookie } });
    expect(after.json().data).toHaveLength(beforeCount);
  });

  it('creates one intent per idempotent checkout action and new intents for new actions', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/payment_links',
      headers: { cookie },
      payload: { title: 'Reusable checkout', amount: 12_500, currency: 'LKR' },
    });
    const token = new URL(created.json().url).pathname.split('/').at(-1)!;
    const key = `browser-${Date.now()}`;

    const first = await app.inject({ method: 'POST', url: `/public/payment_links/${token}/checkout`, headers: { 'idempotency-key': key }, payload: {} });
    const replay = await app.inject({ method: 'POST', url: `/public/payment_links/${token}/checkout`, headers: { 'idempotency-key': key }, payload: {} });
    const another = await app.inject({ method: 'POST', url: `/public/payment_links/${token}/checkout`, headers: { 'idempotency-key': `${key}-2` }, payload: {} });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().payment_intent).toBe(first.json().payment_intent);
    expect(another.statusCode).toBe(201);
    expect(another.json().payment_intent).not.toBe(first.json().payment_intent);

    const intents = await app.inject({ method: 'GET', url: '/v1/payment_intents', headers: { cookie } });
    const linked = intents.json().data.filter((row: { id: string }) => [first.json().payment_intent, another.json().payment_intent].includes(row.id));
    expect(linked).toHaveLength(2);
  });

  it('makes disabled links unavailable to both landing and checkout', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/payment_links',
      headers: { cookie },
      payload: { title: 'Disable me', amount: 5_000, currency: 'LKR' },
    });
    const token = new URL(created.json().url).pathname.split('/').at(-1)!;

    const disabled = await app.inject({
      method: 'POST',
      url: `/v1/payment_links/${created.json().id}/state`,
      headers: { cookie },
      payload: { active: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().active).toBe(false);

    const landing = await app.inject({ method: 'GET', url: `/public/payment_links/${token}` });
    const checkout = await app.inject({
      method: 'POST',
      url: `/public/payment_links/${token}/checkout`,
      headers: { 'idempotency-key': `disabled-${Date.now()}` },
      payload: {},
    });
    expect(landing.statusCode).toBe(404);
    expect(checkout.statusCode).toBe(404);
  });
});
