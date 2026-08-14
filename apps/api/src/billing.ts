import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma, prisma, type SubscriptionInterval } from '@retaillink/database';
import { z } from 'zod';

const subscriptionSchema = z.object({
  customer: z.string().min(1),
  amount: z.number().int().positive(),
  currency: z.string().length(3).default('LKR'),
  interval: z.enum(['day', 'week', 'month', 'year']),
  interval_count: z.number().int().min(1).max(36).default(1),
  description: z.string().trim().max(500).optional(),
});
const cancelSchema = z.object({ at_period_end: z.boolean().default(true) });

type BillingTransaction = Pick<typeof prisma, 'paymentIntent' | 'invoice'>;

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function merchantAuth(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer sk_test_')) {
    const key = await prisma.apiKey.findUnique({ where: { keyHash: hashToken(authorization.slice('Bearer '.length)) } });
    if (key && !key.revokedAt && key.environment === 'TEST') return { merchantId: key.merchantId, userId: null as string | null, source: 'api_key' as const };
  }

  const token = request.cookies.rt_session;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session || session.expiresAt <= new Date()) return null;
  return { merchantId: session.merchantId, userId: session.userId, source: 'session' as const };
}

function intervalEnum(value: 'day' | 'week' | 'month' | 'year'): SubscriptionInterval {
  return value.toUpperCase() as SubscriptionInterval;
}

function advancePeriod(start: Date, interval: SubscriptionInterval, count: number) {
  const next = new Date(start);
  if (interval === 'DAY') next.setUTCDate(next.getUTCDate() + count);
  if (interval === 'WEEK') next.setUTCDate(next.getUTCDate() + (7 * count));
  if (interval === 'MONTH') next.setUTCMonth(next.getUTCMonth() + count);
  if (interval === 'YEAR') next.setUTCFullYear(next.getUTCFullYear() + count);
  return next;
}

function checkoutBaseUrl() {
  return process.env.CHECKOUT_BASE_URL ?? 'http://localhost:3002';
}

function serializeInvoice(row: any) {
  return {
    id: row.id,
    object: 'invoice',
    customer: row.customerId,
    subscription: row.subscriptionId,
    payment_intent: row.paymentIntentId,
    amount_due: row.amountDue.toString(),
    amount_paid: row.amountPaid.toString(),
    currency: row.currency,
    status: row.status.toLowerCase(),
    description: row.description,
    period_start: row.periodStart.toISOString(),
    period_end: row.periodEnd.toISOString(),
    due_at: row.dueAt?.toISOString() ?? null,
    paid_at: row.paidAt?.toISOString() ?? null,
    checkout_url: row.paymentIntent?.checkoutToken ? `${checkoutBaseUrl()}/pay/${row.paymentIntent.checkoutToken}` : null,
    created_at: row.createdAt.toISOString(),
    livemode: false,
  };
}

function serializeSubscription(row: any) {
  return {
    id: row.id,
    object: 'subscription',
    customer: row.customerId,
    amount: row.amount.toString(),
    currency: row.currency,
    interval: row.interval.toLowerCase(),
    interval_count: row.intervalCount,
    description: row.description,
    status: row.status.toLowerCase(),
    current_period_start: row.currentPeriodStart.toISOString(),
    current_period_end: row.currentPeriodEnd.toISOString(),
    next_billing_at: row.nextBillingAt.toISOString(),
    cancel_at_period_end: row.cancelAtPeriodEnd,
    canceled_at: row.canceledAt?.toISOString() ?? null,
    latest_invoice: row.invoices?.[0] ? serializeInvoice(row.invoices[0]) : null,
    created_at: row.createdAt.toISOString(),
    livemode: false,
  };
}

async function createOpenInvoice(
  tx: BillingTransaction,
  input: {
    merchantId: string;
    customerId: string;
    subscriptionId: string;
    amount: bigint;
    currency: string;
    description?: string | null;
    periodStart: Date;
    periodEnd: Date;
  },
) {
  const idempotencyKey = `subscription:${input.subscriptionId}:${input.periodStart.toISOString()}`;
  const paymentIntent = await tx.paymentIntent.create({
    data: {
      merchantId: input.merchantId,
      customerId: input.customerId,
      environment: 'TEST',
      amount: input.amount,
      currency: input.currency,
      status: 'REQUIRES_PAYMENT_METHOD',
      merchantReference: `SUBSCRIPTION-${input.subscriptionId}`,
      description: input.description ?? 'Subscription invoice',
      checkoutToken: `ct_test_${randomBytes(24).toString('hex')}`,
      idempotencyKey,
      metadata: { subscription_id: input.subscriptionId },
    },
  });

  return tx.invoice.create({
    data: {
      merchantId: input.merchantId,
      customerId: input.customerId,
      subscriptionId: input.subscriptionId,
      paymentIntentId: paymentIntent.id,
      amountDue: input.amount,
      amountPaid: 0n,
      currency: input.currency,
      status: 'OPEN',
      description: input.description ?? 'Subscription invoice',
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      dueAt: input.periodEnd,
    },
    include: { paymentIntent: true },
  });
}

async function audit(input: { merchantId: string; userId: string | null; action: string; resource: string; resourceId: string; metadata?: unknown; ip?: string }) {
  if (!input.userId) return;
  await prisma.auditLog.create({
    data: {
      merchantId: input.merchantId,
      userId: input.userId,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
      ipAddress: input.ip,
    },
  });
}

export function registerBilling(app: FastifyInstance) {
  app.post('/v1/subscriptions', async (request, reply) => {
    const auth = await merchantAuth(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'A valid test API key or merchant session is required.' } });
    const parsed = subscriptionSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'Invalid subscription.', details: parsed.error.flatten() } });

    const customer = await prisma.customer.findFirst({ where: { id: parsed.data.customer, merchantId: auth.merchantId }, select: { id: true } });
    if (!customer) return reply.code(404).send({ error: { type: 'not_found', message: 'No such customer for this merchant.' } });

    const start = new Date();
    const interval = intervalEnum(parsed.data.interval);
    const end = advancePeriod(start, interval, parsed.data.interval_count);
    const currency = parsed.data.currency.toUpperCase();

    const subscription = await prisma.$transaction(async (tx) => {
      const row = await tx.subscription.create({
        data: {
          merchantId: auth.merchantId,
          customerId: customer.id,
          amount: BigInt(parsed.data.amount),
          currency,
          interval,
          intervalCount: parsed.data.interval_count,
          description: parsed.data.description,
          status: 'ACTIVE',
          currentPeriodStart: start,
          currentPeriodEnd: end,
          nextBillingAt: end,
        },
      });
      await createOpenInvoice(tx, {
        merchantId: auth.merchantId,
        customerId: customer.id,
        subscriptionId: row.id,
        amount: row.amount,
        currency,
        description: row.description,
        periodStart: start,
        periodEnd: end,
      });
      return tx.subscription.findUniqueOrThrow({ where: { id: row.id }, include: { invoices: { include: { paymentIntent: true }, orderBy: { createdAt: 'desc' }, take: 1 } } });
    });

    await audit({ merchantId: auth.merchantId, userId: auth.userId, action: 'subscription.created', resource: 'subscription', resourceId: subscription.id, metadata: { customer_id: customer.id }, ip: request.ip });
    return reply.code(201).send(serializeSubscription(subscription));
  });

  app.get('/v1/subscriptions', async (request, reply) => {
    const auth = await merchantAuth(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'A valid test API key or merchant session is required.' } });
    const rows = await prisma.subscription.findMany({
      where: { merchantId: auth.merchantId },
      include: { invoices: { include: { paymentIntent: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
    return { object: 'list', data: rows.map(serializeSubscription) };
  });

  app.get('/v1/subscriptions/:id', async (request, reply) => {
    const auth = await merchantAuth(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'A valid test API key or merchant session is required.' } });
    const { id } = request.params as { id: string };
    const row = await prisma.subscription.findFirst({
      where: { id, merchantId: auth.merchantId },
      include: { invoices: { include: { paymentIntent: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!row) return reply.code(404).send({ error: { type: 'not_found', message: 'No such subscription.' } });
    return serializeSubscription(row);
  });

  app.post('/v1/subscriptions/:id/cancel', async (request, reply) => {
    const auth = await merchantAuth(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'A valid test API key or merchant session is required.' } });
    const parsed = cancelSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'Invalid cancellation request.' } });
    const { id } = request.params as { id: string };
    const existing = await prisma.subscription.findFirst({ where: { id, merchantId: auth.merchantId } });
    if (!existing) return reply.code(404).send({ error: { type: 'not_found', message: 'No such subscription.' } });
    if (existing.status === 'CANCELED') return reply.code(409).send({ error: { type: 'invalid_state', message: 'Subscription is already canceled.' } });

    const row = await prisma.subscription.update({
      where: { id },
      data: parsed.data.at_period_end
        ? { cancelAtPeriodEnd: true }
        : { status: 'CANCELED', cancelAtPeriodEnd: false, canceledAt: new Date() },
      include: { invoices: { include: { paymentIntent: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    await audit({ merchantId: auth.merchantId, userId: auth.userId, action: 'subscription.cancel_requested', resource: 'subscription', resourceId: id, metadata: { at_period_end: parsed.data.at_period_end }, ip: request.ip });
    return serializeSubscription(row);
  });

  app.post('/v1/subscriptions/:id/run_cycle', async (request, reply) => {
    const auth = await merchantAuth(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'A valid test API key or merchant session is required.' } });
    const { id } = request.params as { id: string };

    try {
      const row = await prisma.$transaction(async (tx) => {
        const subscription = await tx.subscription.findFirst({ where: { id, merchantId: auth.merchantId } });
        if (!subscription) return { kind: 'missing' as const };
        if (subscription.status !== 'ACTIVE') return { kind: 'inactive' as const };
        if (subscription.cancelAtPeriodEnd) {
          const canceled = await tx.subscription.update({
            where: { id },
            data: { status: 'CANCELED', canceledAt: new Date(), cancelAtPeriodEnd: false },
            include: { invoices: { include: { paymentIntent: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
          });
          return { kind: 'canceled' as const, subscription: canceled };
        }

        const periodStart = subscription.currentPeriodEnd;
        const periodEnd = advancePeriod(periodStart, subscription.interval, subscription.intervalCount);
        await createOpenInvoice(tx, {
          merchantId: subscription.merchantId,
          customerId: subscription.customerId,
          subscriptionId: subscription.id,
          amount: subscription.amount,
          currency: subscription.currency,
          description: subscription.description,
          periodStart,
          periodEnd,
        });
        const updated = await tx.subscription.update({
          where: { id },
          data: { currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, nextBillingAt: periodEnd },
          include: { invoices: { include: { paymentIntent: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
        });
        return { kind: 'generated' as const, subscription: updated };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      if (row.kind === 'missing') return reply.code(404).send({ error: { type: 'not_found', message: 'No such subscription.' } });
      if (row.kind === 'inactive') return reply.code(409).send({ error: { type: 'invalid_state', message: 'Only active subscriptions can generate a new billing cycle.' } });
      if (row.kind === 'canceled') {
        await audit({ merchantId: auth.merchantId, userId: auth.userId, action: 'subscription.canceled', resource: 'subscription', resourceId: id, ip: request.ip });
        return { result: 'canceled_at_period_end', subscription: serializeSubscription(row.subscription) };
      }
      await audit({ merchantId: auth.merchantId, userId: auth.userId, action: 'subscription.cycle_generated', resource: 'subscription', resourceId: id, ip: request.ip });
      return { result: 'invoice_generated', subscription: serializeSubscription(row.subscription) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.code(409).send({ error: { type: 'invalid_state', message: 'This billing period has already generated an invoice.' } });
      }
      throw error;
    }
  });

  app.get('/v1/invoices', async (request, reply) => {
    const auth = await merchantAuth(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'A valid test API key or merchant session is required.' } });
    const rows = await prisma.invoice.findMany({
      where: { merchantId: auth.merchantId }, include: { paymentIntent: true }, orderBy: { createdAt: 'desc' }, take: 100,
    });
    return { object: 'list', data: rows.map(serializeInvoice) };
  });

  app.get('/v1/invoices/:id', async (request, reply) => {
    const auth = await merchantAuth(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'A valid test API key or merchant session is required.' } });
    const { id } = request.params as { id: string };
    const row = await prisma.invoice.findFirst({ where: { id, merchantId: auth.merchantId }, include: { paymentIntent: true } });
    if (!row) return reply.code(404).send({ error: { type: 'not_found', message: 'No such invoice.' } });
    return serializeInvoice(row);
  });

  app.post('/v1/invoices/:id/void', async (request, reply) => {
    const auth = await merchantAuth(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'A valid test API key or merchant session is required.' } });
    const { id } = request.params as { id: string };
    const invoice = await prisma.invoice.findFirst({ where: { id, merchantId: auth.merchantId } });
    if (!invoice) return reply.code(404).send({ error: { type: 'not_found', message: 'No such invoice.' } });
    if (invoice.status !== 'OPEN') return reply.code(409).send({ error: { type: 'invalid_state', message: 'Only open invoices can be voided.' } });

    const row = await prisma.invoice.update({ where: { id }, data: { status: 'VOID' }, include: { paymentIntent: true } });
    await audit({ merchantId: auth.merchantId, userId: auth.userId, action: 'invoice.voided', resource: 'invoice', resourceId: id, ip: request.ip });
    return serializeInvoice(row);
  });
}
