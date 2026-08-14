import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@retaillink/database';
import { runBillingBatch } from './billing-worker.js';

let merchantId = '';
let customerId = '';

async function dueSubscription(overrides: { cancelAtPeriodEnd?: boolean; amount?: bigint } = {}) {
  const start = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const end = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return prisma.subscription.create({
    data: {
      merchantId,
      customerId,
      amount: overrides.amount ?? 25_000n,
      currency: 'LKR',
      interval: 'MONTH',
      intervalCount: 1,
      description: 'Worker billing fixture',
      status: 'ACTIVE',
      currentPeriodStart: start,
      currentPeriodEnd: end,
      nextBillingAt: end,
      cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
    },
  });
}

describe.sequential('recurring billing worker', () => {
  beforeAll(async () => {
    const merchant = await prisma.merchant.create({ data: { name: `Billing Worker ${Date.now()}`, country: 'LK', defaultCurrency: 'LKR' } });
    merchantId = merchant.id;
    const customer = await prisma.customer.create({ data: { merchantId, name: 'Worker Customer', email: `worker-${Date.now()}@example.test` } });
    customerId = customer.id;
  });

  afterAll(async () => {
    await prisma.merchant.delete({ where: { id: merchantId } }).catch(() => undefined);
  });

  it('generates an invoice and advances a due active subscription', async () => {
    const subscription = await dueSubscription();
    const processed = await runBillingBatch({ merchantId });
    expect(processed).toBe(1);

    const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(updated.status).toBe('ACTIVE');
    expect(updated.currentPeriodStart.getTime()).toBe(subscription.currentPeriodEnd.getTime());
    expect(updated.nextBillingAt.getTime()).toBeGreaterThan(subscription.nextBillingAt.getTime());

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { subscriptionId: subscription.id }, include: { paymentIntent: true } });
    expect(invoice.status).toBe('OPEN');
    expect(invoice.amountDue).toBe(subscription.amount);
    expect(invoice.paymentIntent?.metadata).toMatchObject({ subscription_id: subscription.id, generated_by: 'worker' });
  });

  it('honours cancel-at-period-end without creating another invoice', async () => {
    const subscription = await dueSubscription({ cancelAtPeriodEnd: true });
    const processed = await runBillingBatch({ merchantId });
    expect(processed).toBe(1);

    const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(updated.status).toBe('CANCELED');
    expect(updated.canceledAt).not.toBeNull();
    expect(await prisma.invoice.count({ where: { subscriptionId: subscription.id } })).toBe(0);
  });

  it('pauses a due subscription when an active BLOCK rule matches', async () => {
    const subscription = await dueSubscription({ amount: 90_000n });
    const rule = await prisma.riskRule.create({
      data: {
        merchantId,
        name: 'Worker block high amount',
        type: 'AMOUNT_GTE',
        action: 'BLOCK',
        threshold: 50_000n,
        currency: 'LKR',
        enabled: true,
      },
    });

    const processed = await runBillingBatch({ merchantId });
    expect(processed).toBe(1);
    const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(updated.status).toBe('PAUSED');
    expect(await prisma.invoice.count({ where: { subscriptionId: subscription.id } })).toBe(0);
    const event = await prisma.riskEvent.findFirst({ where: { merchantId, ruleId: rule.id, outcome: 'BLOCKED' } });
    expect(event).not.toBeNull();
  });
});
