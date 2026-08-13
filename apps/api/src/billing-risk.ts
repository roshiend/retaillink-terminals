import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@retaillink/database';
import { z } from 'zod';
import { evaluateRisk } from './risk-enforcement.js';

const createSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().length(3).default('LKR'),
}).passthrough();

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

function blocked(reply: FastifyReply, ruleName: string) {
  return reply.code(403).send({
    error: {
      type: 'risk_blocked',
      code: 'risk_rule_blocked',
      message: `Subscription invoice blocked by sandbox risk rule: ${ruleName}.`,
    },
  });
}

export function registerBillingRisk(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    const route = request.routeOptions.url;
    if (request.method !== 'POST') return;

    if (route === '/v1/subscriptions') {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) return;
      const merchantId = await merchantIdFor(request);
      if (!merchantId) return;
      const decision = await evaluateRisk(merchantId, {
        amount: parsed.data.amount,
        currency: parsed.data.currency,
        merchant_reference: 'SUBSCRIPTION-CREATE',
      });
      if (decision.outcome === 'blocked') return blocked(reply, decision.ruleName ?? 'unnamed rule');
      return;
    }

    if (route === '/v1/subscriptions/:id/run_cycle') {
      const merchantId = await merchantIdFor(request);
      if (!merchantId) return;
      const { id } = request.params as { id: string };
      const subscription = await prisma.subscription.findFirst({
        where: { id, merchantId },
        select: { amount: true, currency: true, status: true, cancelAtPeriodEnd: true },
      });
      if (!subscription || subscription.status !== 'ACTIVE' || subscription.cancelAtPeriodEnd) return;
      const decision = await evaluateRisk(merchantId, {
        amount: subscription.amount,
        currency: subscription.currency,
        merchant_reference: `SUBSCRIPTION-${id}`,
      });
      if (decision.outcome === 'blocked') return blocked(reply, decision.ruleName ?? 'unnamed rule');
    }
  });
}
