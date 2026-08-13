import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@retaillink/database';
import { z } from 'zod';

const createBody = z.object({ customer: z.string().min(1).optional() }).passthrough();

type PendingCustomer = {
  merchantId: string;
  customerId: string;
  lockKey: string | null;
  existing: boolean;
};

type CustomerLock = { customerId: string; count: number };

const pending = new WeakMap<FastifyRequest, PendingCustomer>();
const locks = new Map<string, CustomerLock>();

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function merchantIdFor(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer sk_test_')) {
    const key = await prisma.apiKey.findUnique({ where: { keyHash: hashToken(authorization.slice('Bearer '.length)) } });
    if (key && !key.revokedAt && key.environment === 'TEST') return key.merchantId;
  }
  const token = request.cookies.rt_session;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session || session.expiresAt <= new Date()) return null;
  return session.merchantId;
}

function acquire(lockKey: string, customerId: string) {
  const current = locks.get(lockKey);
  if (current) {
    if (current.customerId !== customerId) return false;
    current.count += 1;
    return true;
  }
  locks.set(lockKey, { customerId, count: 1 });
  return true;
}

function release(lockKey: string | null) {
  if (!lockKey) return;
  const current = locks.get(lockKey);
  if (!current) return;
  current.count -= 1;
  if (current.count <= 0) locks.delete(lockKey);
}

function parseJsonPayload(payload: unknown) {
  try {
    if (typeof payload === 'string') return JSON.parse(payload);
    if (Buffer.isBuffer(payload)) return JSON.parse(payload.toString('utf8'));
  } catch {
    return null;
  }
  return null;
}

function conflict(message: string) {
  return JSON.stringify({ error: { type: 'idempotency_error', code: 'customer_idempotency_conflict', message } });
}

export function registerPaymentCustomerAssociation(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'POST' || request.routeOptions.url !== '/v1/payment_intents') return;
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success || !parsed.data.customer) return;

    const merchantId = await merchantIdFor(request);
    if (!merchantId) return;

    const idempotencyHeader = request.headers['idempotency-key'];
    const idempotencyKey = typeof idempotencyHeader === 'string' ? idempotencyHeader.trim() : '';
    if (!idempotencyKey) {
      return reply.code(400).send({
        error: {
          type: 'invalid_request_error',
          code: 'customer_requires_idempotency',
          message: 'Payment Intents created with a customer must include an Idempotency-Key header.',
        },
      });
    }

    const customer = await prisma.customer.findFirst({
      where: { id: parsed.data.customer, merchantId },
      select: { id: true },
    });
    if (!customer) {
      return reply.code(404).send({ error: { type: 'not_found', message: 'No such customer for this merchant.' } });
    }

    const existing = await prisma.paymentIntent.findUnique({
      where: { merchantId_idempotencyKey: { merchantId, idempotencyKey } },
      select: { id: true, customerId: true },
    });
    if (existing) {
      if (existing.customerId !== customer.id) {
        return reply.code(409).send({
          error: {
            type: 'idempotency_error',
            code: 'customer_idempotency_conflict',
            message: 'This Idempotency-Key has already been used with a different customer value.',
          },
        });
      }
      pending.set(request, { merchantId, customerId: customer.id, lockKey: null, existing: true });
      return;
    }

    const lockKey = `${merchantId}:${idempotencyKey}`;
    if (!acquire(lockKey, customer.id)) {
      return reply.code(409).send({
        error: {
          type: 'idempotency_error',
          code: 'customer_idempotency_conflict',
          message: 'Concurrent requests used the same Idempotency-Key with different customers.',
        },
      });
    }
    pending.set(request, { merchantId, customerId: customer.id, lockKey, existing: false });
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const route = request.routeOptions.url;

    if (request.method === 'POST' && route === '/v1/payment_intents') {
      const association = pending.get(request);
      if (!association || reply.statusCode < 200 || reply.statusCode >= 300) return payload;
      const data = parseJsonPayload(payload);
      if (!data?.id || typeof data.id !== 'string') return payload;

      if (!association.existing) {
        const result = await prisma.paymentIntent.updateMany({
          where: {
            id: data.id,
            merchantId: association.merchantId,
            OR: [{ customerId: null }, { customerId: association.customerId }],
          },
          data: { customerId: association.customerId },
        });
        if (result.count !== 1) {
          reply.code(409);
          return conflict('The Payment Intent customer association conflicted with another concurrent request.');
        }
      }
      data.customer = association.customerId;
      return JSON.stringify(data);
    }

    if (request.method === 'GET' && route === '/v1/payment_intents/:id' && reply.statusCode === 200) {
      const data = parseJsonPayload(payload);
      if (!data?.id || typeof data.id !== 'string') return payload;
      const row = await prisma.paymentIntent.findUnique({ where: { id: data.id }, select: { customerId: true } });
      data.customer = row?.customerId ?? null;
      return JSON.stringify(data);
    }

    if (request.method === 'GET' && route === '/v1/payment_intents' && reply.statusCode === 200) {
      const data = parseJsonPayload(payload);
      if (!Array.isArray(data?.data) || data.data.length === 0) return payload;
      const ids = data.data.map((row: { id?: unknown }) => row.id).filter((id: unknown): id is string => typeof id === 'string');
      const rows = await prisma.paymentIntent.findMany({ where: { id: { in: ids } }, select: { id: true, customerId: true } });
      const customerByIntent = new Map(rows.map((row) => [row.id, row.customerId]));
      data.data = data.data.map((row: { id: string }) => ({ ...row, customer: customerByIntent.get(row.id) ?? null }));
      return JSON.stringify(data);
    }

    return payload;
  });

  app.addHook('onResponse', async (request) => {
    const association = pending.get(request);
    if (!association) return;
    release(association.lockKey);
    pending.delete(request);
  });
}
