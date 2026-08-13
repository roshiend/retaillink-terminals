import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma, prisma } from '@retaillink/database';
import { z } from 'zod';

const SESSION_COOKIE = 'rt_session';
const settingsSchema = z.object({ name: z.string().trim().min(2).max(120) });

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

async function getDashboardSession(request: FastifyRequest) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true, merchant: true },
  });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  const membership = await prisma.merchantUser.findUnique({
    where: { userId_merchantId: { userId: session.userId, merchantId: session.merchantId } },
  });
  if (!membership) return null;
  return { session, membership };
}

async function audit(input: {
  merchantId: string;
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: unknown;
  ipAddress?: string;
}) {
  await prisma.auditLog.create({
    data: {
      merchantId: input.merchantId,
      userId: input.userId,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
      ipAddress: input.ipAddress,
    },
  });
}

function serializeSettlement(row: {
  id: string;
  amount: bigint;
  currency: string;
  status: string;
  periodFrom: Date;
  periodTo: Date;
  createdAt: Date;
}) {
  return {
    id: row.id,
    amount: row.amount.toString(),
    currency: row.currency,
    status: row.status.toLowerCase(),
    period_from: row.periodFrom.toISOString(),
    period_to: row.periodTo.toISOString(),
    created_at: row.createdAt.toISOString(),
  };
}

export function registerDashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard/settings', async (request, reply) => {
    const auth = await getDashboardSession(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });

    return {
      merchant: {
        id: auth.session.merchant.id,
        name: auth.session.merchant.name,
        country: auth.session.merchant.country,
        currency: auth.session.merchant.defaultCurrency,
      },
      role: auth.membership.role,
    };
  });

  app.post('/dashboard/settings', async (request, reply) => {
    const auth = await getDashboardSession(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    if (auth.membership.role !== 'OWNER') {
      return reply.code(403).send({ error: { type: 'permission_error', message: 'Only the merchant owner can change business settings.' } });
    }

    const parsed = settingsSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'Invalid business settings.', details: parsed.error.flatten() } });
    }

    const merchant = await prisma.merchant.update({
      where: { id: auth.session.merchantId },
      data: { name: parsed.data.name },
    });

    await audit({
      merchantId: merchant.id,
      userId: auth.session.userId,
      action: 'merchant.updated',
      resource: 'merchant',
      resourceId: merchant.id,
      metadata: { name: merchant.name },
      ipAddress: request.ip,
    });

    return {
      merchant: { id: merchant.id, name: merchant.name, country: merchant.country, currency: merchant.defaultCurrency },
    };
  });

  app.get('/dashboard/settlements', async (request, reply) => {
    const auth = await getDashboardSession(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });

    const rows = await prisma.settlement.findMany({
      where: { merchantId: auth.session.merchantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { data: rows.map(serializeSettlement) };
  });

  app.post('/dashboard/settlements', async (request, reply) => {
    const auth = await getDashboardSession(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    if (auth.membership.role !== 'OWNER') {
      return reply.code(403).send({ error: { type: 'permission_error', message: 'Only the merchant owner can run a settlement.' } });
    }

    const now = new Date();
    const merchantId = auth.session.merchantId;
    const currency = auth.session.merchant.defaultCurrency;

    const settlement = await prisma.$transaction(async (tx) => {
      const merchantAccount = await tx.ledgerAccount.upsert({
        where: { merchantId_code_currency: { merchantId, code: 'MERCHANT_PAYABLE', currency } },
        update: {},
        create: { merchantId, code: 'MERCHANT_PAYABLE', name: 'Merchant payable', currency },
      });
      const processorAccount = await tx.ledgerAccount.upsert({
        where: { merchantId_code_currency: { merchantId, code: 'PROCESSOR_CLEARING', currency } },
        update: {},
        create: { merchantId, code: 'PROCESSOR_CLEARING', name: 'Processor clearing', currency },
      });

      const entries = await tx.ledgerEntry.findMany({ where: { accountId: merchantAccount.id } });
      const available = entries.reduce(
        (sum, entry) => sum + (entry.direction === 'CREDIT' ? entry.amount : -entry.amount),
        0n,
      );
      if (available <= 0n) return null;

      const previous = await tx.settlement.findFirst({
        where: { merchantId },
        orderBy: { periodTo: 'desc' },
      });

      const row = await tx.settlement.create({
        data: {
          merchantId,
          amount: available,
          currency,
          status: 'PAID',
          periodFrom: previous?.periodTo ?? auth.session.merchant.createdAt,
          periodTo: now,
        },
      });

      const transactionId = `txn_${randomUUID()}`;
      await tx.ledgerEntry.createMany({
        data: [
          {
            transactionId,
            accountId: merchantAccount.id,
            direction: 'DEBIT',
            amount: available,
            currency,
            referenceType: 'settlement',
            referenceId: row.id,
          },
          {
            transactionId,
            accountId: processorAccount.id,
            direction: 'CREDIT',
            amount: available,
            currency,
            referenceType: 'settlement',
            referenceId: row.id,
          },
        ],
      });

      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (!settlement) {
      return reply.code(409).send({ error: { type: 'invalid_state', message: 'There is no available balance to settle.' } });
    }

    await audit({
      merchantId,
      userId: auth.session.userId,
      action: 'settlement.paid',
      resource: 'settlement',
      resourceId: settlement.id,
      metadata: { amount: settlement.amount.toString(), currency: settlement.currency },
      ipAddress: request.ip,
    });

    return reply.code(201).send({ settlement: serializeSettlement(settlement) });
  });
}
