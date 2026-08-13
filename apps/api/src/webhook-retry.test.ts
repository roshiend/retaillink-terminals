import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@retaillink/database';
import { app } from './bootstrap.js';

let cookie = '';
let merchantId = '';

function uniqueEmail() {
  return `webhook-retry-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
}

async function deliveryFor(url: string) {
  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      merchantId,
      url,
      secret: 'whsec_test_retry_fixture',
      enabled: true,
    },
  });
  return prisma.webhookDelivery.create({
    data: {
      endpointId: endpoint.id,
      eventId: `evt_test_retry_${Math.random().toString(16).slice(2)}`,
      eventType: 'payment.succeeded',
      payload: { id: 'evt_test_retry', type: 'payment.succeeded', data: { object: 'payment', id: 'pay_test' }, livemode: false },
      status: 'FAILED',
      attempts: 1,
      lastError: 'Initial delivery failed',
    },
  });
}

describe.sequential('manual webhook delivery retry', () => {
  beforeAll(async () => {
    await app.ready();
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { business_name: 'Webhook Retry Merchant', email: uniqueEmail(), password: 'WebhookRetry123!' },
    });
    expect(signup.statusCode).toBe(201);
    cookie = String(signup.headers['set-cookie']).split(';', 1)[0];
    merchantId = signup.json().merchant.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('re-checks DNS/address safety and blocks loopback destinations', async () => {
    const delivery = await deliveryFor('http://127.0.0.1:9999/webhook');
    const response = await app.inject({
      method: 'POST',
      url: `/dashboard/webhook_deliveries/${delivery.id}/retry`,
      headers: { cookie },
      payload: {},
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.type).toBe('webhook_delivery_error');
    expect(response.json().delivery.attempts).toBe(2);
    expect(response.json().delivery.last_error.toLowerCase()).toContain('private');
  });

  it('redelivers a safe public endpoint and updates attempt state', async () => {
    const delivery = await deliveryFor('https://example.com/retaillink-webhook');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));

    const response = await app.inject({
      method: 'POST',
      url: `/dashboard/webhook_deliveries/${delivery.id}/retry`,
      headers: { cookie },
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: delivery.id, status: 'delivered', attempts: 2, last_error: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect((options?.headers as Record<string, string>)['x-retaillink-signature']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
  });
});
