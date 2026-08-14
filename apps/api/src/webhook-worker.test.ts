import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@retaillink/database';
import { runWebhookBatch } from './webhook-worker.js';

let merchantId = '';
const originalBase = process.env.WEBHOOK_RETRY_BASE_MS;

async function createDueDelivery(url: string) {
  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      merchantId,
      url,
      secret: `whsec_test_worker_${Math.random().toString(16).slice(2)}`,
      enabled: true,
    },
  });
  const delivery = await prisma.webhookDelivery.create({
    data: {
      endpointId: endpoint.id,
      eventId: `evt_test_worker_${Math.random().toString(16).slice(2)}`,
      eventType: 'payment.succeeded',
      payload: { id: 'evt_test_worker', type: 'payment.succeeded', data: { object: 'payment', id: 'pay_worker' }, livemode: false },
      status: 'FAILED',
      attempts: 1,
      lastError: 'Initial attempt failed',
    },
  });
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: { updatedAt: new Date(Date.now() - 10_000) },
  });
  return delivery.id;
}

describe.sequential('durable webhook worker', () => {
  beforeAll(async () => {
    process.env.WEBHOOK_RETRY_BASE_MS = '1000';
    const merchant = await prisma.merchant.create({ data: { name: `Worker Test ${Date.now()}`, country: 'LK', defaultCurrency: 'LKR' } });
    merchantId = merchant.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (originalBase === undefined) delete process.env.WEBHOOK_RETRY_BASE_MS;
    else process.env.WEBHOOK_RETRY_BASE_MS = originalBase;
    await prisma.merchant.delete({ where: { id: merchantId } }).catch(() => undefined);
  });

  it('claims and delivers a due public webhook', async () => {
    const id = await createDueDelivery('https://8.8.8.8/retaillink-worker-test');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));

    const processed = await runWebhookBatch({ merchantId });
    expect(processed).toBe(1);
    const row = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('DELIVERED');
    expect(row.attempts).toBe(2);
    expect(row.lastError).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect((options?.headers as Record<string, string>)['x-retaillink-signature']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
  });

  it('fails a due retry when the destination is private', async () => {
    vi.restoreAllMocks();
    const id = await createDueDelivery('http://127.0.0.1:9999/webhook');
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const processed = await runWebhookBatch({ merchantId });
    expect(processed).toBe(1);
    const row = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('FAILED');
    expect(row.attempts).toBe(2);
    expect(row.lastError?.toLowerCase()).toContain('private');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
