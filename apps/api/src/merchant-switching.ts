import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@retaillink/database';
import { z } from 'zod';

const switchSchema = z.object({ merchant_id: z.string().min(1) });

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function activeSession(request: FastifyRequest) {
  const token = request.cookies.rt_session;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session || session.expiresAt <= new Date()) return null;
  return session;
}

export function registerMerchantSwitching(app: FastifyInstance) {
  app.get('/auth/merchants', async (request, reply) => {
    const session = await activeSession(request);
    if (!session) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });

    const memberships = await prisma.merchantUser.findMany({
      where: { userId: session.userId },
      include: { merchant: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      current_merchant_id: session.merchantId,
      data: memberships.map((row) => ({
        merchant: { id: row.merchant.id, name: row.merchant.name, country: row.merchant.country, currency: row.merchant.defaultCurrency },
        role: row.role,
        joined_at: row.createdAt.toISOString(),
      })),
    };
  });

  app.post('/auth/switch_merchant', async (request, reply) => {
    const session = await activeSession(request);
    if (!session) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    const parsed = switchSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'A merchant_id is required.' } });

    const membership = await prisma.merchantUser.findUnique({
      where: { userId_merchantId: { userId: session.userId, merchantId: parsed.data.merchant_id } },
      include: { merchant: true },
    });
    if (!membership) return reply.code(403).send({ error: { type: 'permission_error', message: 'You are not a member of this merchant account.' } });

    const previousMerchantId = session.merchantId;
    await prisma.session.update({ where: { id: session.id }, data: { merchantId: membership.merchantId, lastSeenAt: new Date() } });
    await prisma.auditLog.create({
      data: {
        merchantId: membership.merchantId,
        userId: session.userId,
        action: 'session.merchant_switched',
        resource: 'merchant',
        resourceId: membership.merchantId,
        metadata: { previous_merchant_id: previousMerchantId },
        ipAddress: request.ip,
      },
    });

    return {
      merchant: { id: membership.merchant.id, name: membership.merchant.name, country: membership.merchant.country, currency: membership.merchant.defaultCurrency },
      role: membership.role,
    };
  });
}
