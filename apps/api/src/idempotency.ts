import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@retaillink/database';

const LOCK_MS = 30_000;
const pending = new WeakMap<FastifyRequest, { id: string; lockToken: string }>();

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function merchantIdFor(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer sk_test_')) {
    const key = await prisma.apiKey.findUnique({
      where: { keyHash: hash(authorization.slice('Bearer '.length)) },
      select: { merchantId: true, revokedAt: true, environment: true },
    });
    if (key && !key.revokedAt && key.environment === 'TEST') return key.merchantId;
  }

  const token = request.cookies.rt_session;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hash(token) },
    select: { merchantId: true, expiresAt: true },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  return session.merchantId;
}

function parsePayload(payload: unknown) {
  try {
    if (typeof payload === 'string') return JSON.parse(payload);
    if (Buffer.isBuffer(payload)) return JSON.parse(payload.toString('utf8'));
    if (payload && typeof payload === 'object') return payload;
  } catch {
    return null;
  }
  return null;
}

function isUniqueConstraint(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

async function removeReservation(request: FastifyRequest) {
  const held = pending.get(request);
  if (!held) return;
  pending.delete(request);
  await prisma.idempotencyRecord.deleteMany({ where: { id: held.id, lockToken: held.lockToken, responseStatus: null } }).catch(() => undefined);
}

export function registerPersistentIdempotency(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    const route = request.routeOptions.url;
    if (request.method !== 'POST' || route !== '/v1/payments/:id/refunds') return;

    const merchantId = await merchantIdFor(request);
    if (!merchantId) return;

    const rawKey = request.headers['idempotency-key'];
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';
    const required = process.env.REQUIRE_IDEMPOTENCY_KEYS === 'true' || process.env.NODE_ENV === 'production';
    if (!key) {
      if (!required) return;
      return reply.code(400).send({
        error: {
          type: 'invalid_request_error',
          code: 'idempotency_key_required',
          message: 'This write operation requires an Idempotency-Key header.',
        },
      });
    }
    if (key.length > 255) {
      return reply.code(400).send({
        error: { type: 'invalid_request_error', code: 'invalid_idempotency_key', message: 'Idempotency-Key must be 255 characters or fewer.' },
      });
    }

    const requestHash = hash(canonicalJson({ method: request.method, route, params: request.params, body: request.body ?? null }));
    const lockToken = randomUUID();
    const lockedUntil = new Date(Date.now() + LOCK_MS);

    try {
      const created = await prisma.idempotencyRecord.create({
        data: { merchantId, key, method: request.method, path: route, requestHash, lockToken, lockedUntil },
      });
      pending.set(request, { id: created.id, lockToken });
      return;
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
    }

    let existing = await prisma.idempotencyRecord.findUnique({
      where: { merchantId_key: { merchantId, key } },
    });
    if (!existing) return reply.code(409).send({ error: { type: 'idempotency_error', message: 'Unable to resolve the existing idempotency record.' } });

    if (existing.method !== request.method || existing.path !== route || existing.requestHash !== requestHash) {
      return reply.code(409).send({
        error: {
          type: 'idempotency_error',
          code: 'idempotency_key_conflict',
          message: 'This Idempotency-Key was already used for a different request.',
        },
      });
    }

    if (existing.responseStatus !== null && existing.responseBody !== null) {
      return reply.code(existing.responseStatus).send(existing.responseBody);
    }

    if (existing.lockedUntil && existing.lockedUntil > new Date()) {
      return reply.code(409).send({
        error: {
          type: 'idempotency_error',
          code: 'idempotency_request_in_progress',
          message: 'A request with this Idempotency-Key is already in progress. Retry shortly.',
        },
      });
    }

    const existingId = existing.id;
    const claimed = await prisma.idempotencyRecord.updateMany({
      where: {
        id: existingId,
        responseStatus: null,
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }],
      },
      data: { lockToken, lockedUntil },
    });
    if (claimed.count !== 1) {
      existing = await prisma.idempotencyRecord.findUnique({ where: { id: existingId } });
      if (existing && existing.responseStatus !== null && existing.responseBody !== null) {
        return reply.code(existing.responseStatus).send(existing.responseBody);
      }
      return reply.code(409).send({
        error: { type: 'idempotency_error', code: 'idempotency_request_in_progress', message: 'A request with this Idempotency-Key is already in progress. Retry shortly.' },
      });
    }
    pending.set(request, { id: existingId, lockToken });
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const held = pending.get(request);
    if (!held) return payload;

    if (reply.statusCode >= 500) {
      await removeReservation(request);
      return payload;
    }

    const body = parsePayload(payload);
    if (body === null) {
      await removeReservation(request);
      return payload;
    }

    pending.delete(request);
    await prisma.idempotencyRecord.updateMany({
      where: { id: held.id, lockToken: held.lockToken },
      data: {
        responseStatus: reply.statusCode,
        responseBody: body as any,
        lockToken: null,
        lockedUntil: null,
      },
    });
    return payload;
  });

  app.addHook('onError', async (request) => {
    await removeReservation(request);
  });
}
