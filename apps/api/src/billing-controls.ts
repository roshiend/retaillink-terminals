import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@retaillink/database';

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function authenticate(request: FastifyRequest) {
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

export function registerBillingControls(app: FastifyInstance) {
  app.post('/v1/subscriptions/:id/resume', async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'A valid sandbox API key or merchant session is required.' } });

    const { id } = request.params as { id: string };
    const subscription = await prisma.subscription.findFirst({ where: { id, merchantId: auth.merchantId } });
    if (!subscription) return reply.code(404).send({ error: { type: 'not_found', message: 'No such subscription.' } });
    if (subscription.status !== 'PAUSED') {
      return reply.code(409).send({
        error: { type: 'invalid_state', code: 'subscription_not_paused', message: 'Only paused subscriptions can be resumed.' },
      });
    }

    const updated = await prisma.subscription.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        nextBillingAt: subscription.nextBillingAt < new Date() ? new Date() : subscription.nextBillingAt,
      },
    });

    if (auth.source === 'session') {
      await prisma.auditLog.create({
        data: {
          merchantId: auth.merchantId,
          userId: auth.userId ?? undefined,
          action: 'subscription.resumed',
          resource: 'subscription',
          resourceId: id,
          ipAddress: request.ip,
        },
      });
    }

    return {
      id: updated.id,
      object: 'subscription',
      status: updated.status.toLowerCase(),
      next_billing_at: updated.nextBillingAt.toISOString(),
      livemode: false,
    };
  });
}
