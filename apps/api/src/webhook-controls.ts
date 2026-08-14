import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@retaillink/database';
import { z } from 'zod';

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function sessionFor(request: FastifyRequest) {
  const token = request.cookies.rt_session;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { merchantId: true, userId: true, expiresAt: true },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  return session;
}

function unauthorized() {
  return { error: { type: 'authentication_error', message: 'A valid merchant session is required.' } };
}

export function registerWebhookControls(app: FastifyInstance) {
  app.post('/dashboard/webhook_endpoints/:id/state', async (request, reply) => {
    const session = await sessionFor(request);
    if (!session) return reply.code(401).send(unauthorized());
    const parsed = z.object({ enabled: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'enabled must be a boolean.' } });

    const { id } = request.params as { id: string };
    const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id, merchantId: session.merchantId } });
    if (!endpoint) return reply.code(404).send({ error: { type: 'not_found', message: 'No such webhook_endpoint.' } });

    const updated = await prisma.webhookEndpoint.update({ where: { id }, data: { enabled: parsed.data.enabled } });
    await prisma.auditLog.create({
      data: {
        merchantId: session.merchantId,
        userId: session.userId,
        action: parsed.data.enabled ? 'webhook.enabled' : 'webhook.disabled',
        resource: 'webhook_endpoint',
        resourceId: id,
        metadata: { url: endpoint.url },
        ipAddress: request.ip,
      },
    });
    return { id: updated.id, url: updated.url, enabled: updated.enabled, created_at: updated.createdAt.toISOString() };
  });

  app.post('/dashboard/webhook_endpoints/:id/rotate_secret', async (request, reply) => {
    const session = await sessionFor(request);
    if (!session) return reply.code(401).send(unauthorized());
    const { id } = request.params as { id: string };
    const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id, merchantId: session.merchantId } });
    if (!endpoint) return reply.code(404).send({ error: { type: 'not_found', message: 'No such webhook_endpoint.' } });

    const secret = `whsec_test_${randomBytes(24).toString('hex')}`;
    await prisma.webhookEndpoint.update({ where: { id }, data: { secret } });
    await prisma.auditLog.create({
      data: {
        merchantId: session.merchantId,
        userId: session.userId,
        action: 'webhook.secret_rotated',
        resource: 'webhook_endpoint',
        resourceId: id,
        metadata: { url: endpoint.url },
        ipAddress: request.ip,
      },
    });
    return {
      id,
      secret,
      livemode: false,
      message: 'Copy this new sandbox signing secret now. The previous secret is no longer valid.',
    };
  });
}
