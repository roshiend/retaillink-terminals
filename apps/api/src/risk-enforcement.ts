import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@retaillink/database';
import { z } from 'zod';

const paymentIntentBody = z.object({
  amount: z.number().int().positive(),
  currency: z.string().length(3).default('LKR'),
  merchant_reference: z.string().max(255).optional(),
}).passthrough();

export type RiskEvaluationInput = {
  amount: number | bigint;
  currency: string;
  merchant_reference?: string;
};

export type RiskEvaluation = {
  outcome: 'allowed' | 'review' | 'blocked';
  ruleId: string | null;
  ruleName: string | null;
};

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

function matchesRule(
  rule: { type: string; threshold: bigint | null; textValue: string | null; currency: string | null },
  input: RiskEvaluationInput,
) {
  const currency = input.currency.toUpperCase();
  const amount = typeof input.amount === 'bigint' ? input.amount : BigInt(input.amount);
  if (rule.type === 'AMOUNT_GTE') {
    if (rule.currency && rule.currency !== currency) return false;
    return rule.threshold !== null && amount >= rule.threshold;
  }
  if (rule.type === 'REFERENCE_CONTAINS') {
    return Boolean(rule.textValue && input.merchant_reference?.toLowerCase().includes(rule.textValue.toLowerCase()));
  }
  return false;
}

async function recordEvent(input: {
  merchantId: string;
  ruleId: string | null;
  outcome: 'ALLOWED' | 'REVIEW' | 'BLOCKED';
  reason: string;
  amount: number | bigint;
  currency: string;
  merchantReference?: string;
}) {
  await prisma.riskEvent.create({
    data: {
      merchantId: input.merchantId,
      ruleId: input.ruleId ?? undefined,
      outcome: input.outcome,
      reason: input.reason,
      amount: typeof input.amount === 'bigint' ? input.amount : BigInt(input.amount),
      currency: input.currency.toUpperCase(),
      merchantReference: input.merchantReference,
    },
  });
}

export async function evaluateRisk(merchantId: string, input: RiskEvaluationInput): Promise<RiskEvaluation> {
  const rules = await prisma.riskRule.findMany({
    where: { merchantId, enabled: true },
    orderBy: { createdAt: 'asc' },
  });
  const matched = rules.filter((rule) => matchesRule(rule, input));
  const blockRule = matched.find((rule) => rule.action === 'BLOCK');
  if (blockRule) {
    await recordEvent({
      merchantId,
      ruleId: blockRule.id,
      outcome: 'BLOCKED',
      reason: `Matched BLOCK rule “${blockRule.name}”.`,
      amount: input.amount,
      currency: input.currency,
      merchantReference: input.merchant_reference,
    });
    return { outcome: 'blocked', ruleId: blockRule.id, ruleName: blockRule.name };
  }

  const reviewRule = matched.find((rule) => rule.action === 'REVIEW');
  if (reviewRule) {
    await recordEvent({
      merchantId,
      ruleId: reviewRule.id,
      outcome: 'REVIEW',
      reason: `Matched REVIEW rule “${reviewRule.name}”; payment was allowed in sandbox review mode.`,
      amount: input.amount,
      currency: input.currency,
      merchantReference: input.merchant_reference,
    });
    return { outcome: 'review', ruleId: reviewRule.id, ruleName: reviewRule.name };
  }

  await recordEvent({
    merchantId,
    ruleId: null,
    outcome: 'ALLOWED',
    reason: rules.length ? 'No enabled risk rule matched.' : 'No enabled risk rules configured.',
    amount: input.amount,
    currency: input.currency,
    merchantReference: input.merchant_reference,
  });
  return { outcome: 'allowed', ruleId: null, ruleName: null };
}

function blocked(reply: FastifyReply, ruleName: string) {
  return reply.code(403).send({
    error: {
      type: 'risk_blocked',
      code: 'risk_rule_blocked',
      message: `Payment blocked by sandbox risk rule: ${ruleName}.`,
    },
  });
}

export function registerRiskEnforcement(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'POST' || request.routeOptions.url !== '/v1/payment_intents') return;

    const parsed = paymentIntentBody.safeParse(request.body);
    if (!parsed.success) return;

    const merchantId = await merchantIdFor(request);
    if (!merchantId) return;

    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof idempotencyKey === 'string' && idempotencyKey.trim()) {
      const existing = await prisma.paymentIntent.findUnique({
        where: { merchantId_idempotencyKey: { merchantId, idempotencyKey: idempotencyKey.trim() } },
        select: { id: true },
      });
      if (existing) return;
    }

    const decision = await evaluateRisk(merchantId, parsed.data);
    if (decision.outcome === 'blocked') return blocked(reply, decision.ruleName ?? 'unnamed rule');
  });
}
