import { randomBytes } from 'node:crypto';
import { Prisma, prisma, type SubscriptionInterval } from '@retaillink/database';
import { evaluateRisk } from './risk-enforcement.js';

function numberEnv(name: string, fallback: number, minimum = 1) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= minimum ? Math.floor(value) : fallback;
}

function advancePeriod(start: Date, interval: SubscriptionInterval, count: number) {
  const next = new Date(start);
  if (interval === 'DAY') next.setUTCDate(next.getUTCDate() + count);
  if (interval === 'WEEK') next.setUTCDate(next.getUTCDate() + (7 * count));
  if (interval === 'MONTH') next.setUTCMonth(next.getUTCMonth() + count);
  if (interval === 'YEAR') next.setUTCFullYear(next.getUTCFullYear() + count);
  return next;
}

async function systemAudit(merchantId: string, action: string, resourceId: string, metadata?: Prisma.InputJsonValue) {
  await prisma.auditLog.create({
    data: {
      merchantId,
      action,
      resource: 'subscription',
      resourceId,
      metadata,
    },
  });
}

export async function runBillingBatch(options: { merchantId?: string } = {}) {
  const now = new Date();
  const batchSize = numberEnv('BILLING_WORKER_BATCH_SIZE', 20);
  const candidates = await prisma.subscription.findMany({
    where: {
      status: 'ACTIVE',
      nextBillingAt: { lte: now },
      ...(options.merchantId ? { merchantId: options.merchantId } : {}),
    },
    orderBy: { nextBillingAt: 'asc' },
    take: batchSize,
  });

  let processed = 0;
  for (const candidate of candidates) {
    if (candidate.cancelAtPeriodEnd) {
      const canceled = await prisma.subscription.updateMany({
        where: { id: candidate.id, status: 'ACTIVE', cancelAtPeriodEnd: true, nextBillingAt: { lte: now } },
        data: { status: 'CANCELED', canceledAt: now, cancelAtPeriodEnd: false },
      });
      if (canceled.count === 1) {
        processed += 1;
        await systemAudit(candidate.merchantId, 'subscription.canceled_by_scheduler', candidate.id);
      }
      continue;
    }

    const risk = await evaluateRisk(candidate.merchantId, {
      amount: candidate.amount,
      currency: candidate.currency,
      merchant_reference: `SUBSCRIPTION-${candidate.id}`,
    });
    if (risk.outcome === 'blocked') {
      const paused = await prisma.subscription.updateMany({
        where: { id: candidate.id, status: 'ACTIVE', nextBillingAt: { lte: now } },
        data: { status: 'PAUSED' },
      });
      if (paused.count === 1) {
        processed += 1;
        await systemAudit(candidate.merchantId, 'subscription.paused_by_risk', candidate.id, { rule: risk.ruleName ?? null });
      }
      continue;
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const subscription = await tx.subscription.findFirst({
          where: {
            id: candidate.id,
            merchantId: candidate.merchantId,
            status: 'ACTIVE',
            cancelAtPeriodEnd: false,
            nextBillingAt: { lte: now },
          },
        });
        if (!subscription) return false;

        const periodStart = subscription.currentPeriodEnd;
        const periodEnd = advancePeriod(periodStart, subscription.interval, subscription.intervalCount);
        const idempotencyKey = `subscription:${subscription.id}:${periodStart.toISOString()}`;
        const paymentIntent = await tx.paymentIntent.create({
          data: {
            merchantId: subscription.merchantId,
            customerId: subscription.customerId,
            environment: 'TEST',
            amount: subscription.amount,
            currency: subscription.currency,
            status: 'REQUIRES_PAYMENT_METHOD',
            merchantReference: `SUBSCRIPTION-${subscription.id}`,
            description: subscription.description ?? 'Subscription invoice',
            checkoutToken: `ct_test_${randomBytes(24).toString('hex')}`,
            idempotencyKey,
            metadata: { subscription_id: subscription.id, generated_by: 'worker' },
          },
        });
        await tx.invoice.create({
          data: {
            merchantId: subscription.merchantId,
            customerId: subscription.customerId,
            subscriptionId: subscription.id,
            paymentIntentId: paymentIntent.id,
            amountDue: subscription.amount,
            amountPaid: 0n,
            currency: subscription.currency,
            status: 'OPEN',
            description: subscription.description ?? 'Subscription invoice',
            periodStart,
            periodEnd,
            dueAt: periodEnd,
          },
        });
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            nextBillingAt: periodEnd,
          },
        });
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      if (result) {
        processed += 1;
        await systemAudit(candidate.merchantId, 'subscription.cycle_generated_by_scheduler', candidate.id);
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) continue;
      throw error;
    }
  }

  return processed;
}
