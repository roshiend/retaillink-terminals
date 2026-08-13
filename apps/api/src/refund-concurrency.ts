import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@retaillink/database';

type Release = () => void;

const tails = new Map<string, Promise<void>>();
const releases = new WeakMap<FastifyRequest, { key: string; release: Release }>();

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function merchantIdFor(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer sk_test_')) {
    const key = await prisma.apiKey.findUnique({
      where: { keyHash: hashToken(authorization.slice('Bearer '.length)) },
      select: { merchantId: true, revokedAt: true, environment: true },
    });
    if (key && !key.revokedAt && key.environment === 'TEST') return key.merchantId;
  }

  const token = request.cookies.rt_session;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { merchantId: true, expiresAt: true },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  return session.merchantId;
}

async function acquire(key: string): Promise<Release> {
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: Release;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  tails.set(key, tail);
  await previous;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
    void tail.finally(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
  };
}

function releaseFor(request: FastifyRequest) {
  const held = releases.get(request);
  if (!held) return;
  releases.delete(request);
  held.release();
}

export function registerRefundConcurrency(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'POST' || request.routeOptions.url !== '/v1/payments/:id/refunds') return;

    const merchantId = await merchantIdFor(request);
    if (!merchantId) return;
    const { id } = request.params as { id: string };
    const key = `${merchantId}:${id}`;
    const release = await acquire(key);
    releases.set(request, { key, release });

    const payment = await prisma.payment.findFirst({
      where: { id, merchantId },
      select: { status: true },
    });

    if (payment && !['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(payment.status)) {
      releaseFor(request);
      return reply.code(409).send({
        error: {
          type: 'invalid_state',
          code: 'payment_not_refundable',
          message: `This payment cannot be refunded while it is ${payment.status.toLowerCase()}.`,
        },
      });
    }
  });

  app.addHook('onResponse', async (request) => {
    releaseFor(request);
  });

  app.addHook('onError', async (request) => {
    releaseFor(request);
  });
}
