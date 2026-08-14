import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@retaillink/database';
import { z } from 'zod';
import { evaluateRisk } from './risk-enforcement.js';

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().length(3).default('LKR'),
  merchant_reference_prefix: z.string().trim().min(1).max(80).optional(),
});

const stateSchema = z.object({ active: z.boolean() });
const publicCheckoutSchema = z.object({}).passthrough();
const idempotencySchema = z.string().trim().min(1).max(120);

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function authenticate(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer sk_test_')) {
    const key = await prisma.apiKey.findUnique({ where: { keyHash: hashToken(authorization.slice('Bearer '.length)) } });
    if (key && !key.revokedAt && key.environment === 'TEST') {
      await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
      return { merchantId: key.merchantId, userId: null as string | null, source: 'api_key' as const };
    }
  }

  const token = request.cookies.rt_session;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { merchantId: true, userId: true, expiresAt: true },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  return { merchantId: session.merchantId, userId: session.userId, source: 'session' as const };
}

function paymentLinkUrl(publicToken: string) {
  const checkoutBase = (process.env.CHECKOUT_BASE_URL ?? 'http://localhost:3002').replace(/\/$/, '');
  return `${checkoutBase}/l/${publicToken}`;
}

function checkoutUrl(checkoutToken: string) {
  const checkoutBase = (process.env.CHECKOUT_BASE_URL ?? 'http://localhost:3002').replace(/\/$/, '');
  return `${checkoutBase}/pay/${checkoutToken}`;
}

function serialize(row: {
  id: string;
  publicToken: string;
  title: string;
  description: string | null;
  amount: bigint;
  currency: string;
  merchantReferencePrefix: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    object: 'payment_link',
    title: row.title,
    description: row.description,
    amount: row.amount.toString(),
    currency: row.currency,
    merchant_reference_prefix: row.merchantReferencePrefix,
    active: row.active,
    url: paymentLinkUrl(row.publicToken),
    livemode: false,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

async function audit(request: FastifyRequest, auth: { merchantId: string; userId: string | null; source: string }, action: string, id: string, metadata?: object) {
  if (auth.source !== 'session') return;
  await prisma.auditLog.create({
    data: {
      merchantId: auth.merchantId,
      userId: auth.userId ?? undefined,
      action,
      resource: 'payment_link',
      resourceId: id,
      metadata,
      ipAddress: request.ip,
    },
  });
}

export function registerPaymentLinks(app: FastifyInstance) {
  app.post('/v1/payment_links', async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'A valid sandbox API key or merchant session is required.' } });

    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { type: 'invalid_request_error', details: parsed.error.flatten() } });
    }

    const row = await prisma.paymentLink.create({
      data: {
        merchantId: auth.merchantId,
        publicToken: `plink_test_${randomBytes(24).toString('hex')}`,
        title: parsed.data.title,
        description: parsed.data.description,
        amount: BigInt(parsed.data.amount),
        currency: parsed.data.currency.toUpperCase(),
        merchantReferencePrefix: parsed.data.merchant_reference_prefix,
      },
    });
    await audit(request, auth, 'payment_link.created', row.id, { amount: row.amount.toString(), currency: row.currency });
    return reply.code(201).send(serialize(row));
  });

  app.get('/v1/payment_links', async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'A valid sandbox API key or merchant session is required.' } });
    const rows = await prisma.paymentLink.findMany({ where: { merchantId: auth.merchantId }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { object: 'list', data: rows.map(serialize) };
  });

  app.get('/v1/payment_links/:id', async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'A valid sandbox API key or merchant session is required.' } });
    const { id } = request.params as { id: string };
    const row = await prisma.paymentLink.findFirst({ where: { id, merchantId: auth.merchantId } });
    if (!row) return reply.code(404).send({ error: { type: 'not_found', message: 'No such payment_link.' } });
    return serialize(row);
  });

  app.post('/v1/payment_links/:id/state', async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'A valid sandbox API key or merchant session is required.' } });
    const parsed = stateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'active must be a boolean.' } });
    const { id } = request.params as { id: string };
    const existing = await prisma.paymentLink.findFirst({ where: { id, merchantId: auth.merchantId } });
    if (!existing) return reply.code(404).send({ error: { type: 'not_found', message: 'No such payment_link.' } });
    const row = await prisma.paymentLink.update({ where: { id }, data: { active: parsed.data.active } });
    await audit(request, auth, parsed.data.active ? 'payment_link.activated' : 'payment_link.deactivated', row.id);
    return serialize(row);
  });

  app.get('/public/payment_links/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const row = await prisma.paymentLink.findUnique({
      where: { publicToken: token },
      include: { merchant: { select: { name: true } } },
    });
    if (!row || !row.active) return reply.code(404).send({ error: { type: 'not_found', message: 'This payment link is unavailable.' } });
    return {
      object: 'payment_link_public',
      title: row.title,
      description: row.description,
      amount: row.amount.toString(),
      currency: row.currency,
      merchant_name: row.merchant.name,
      active: true,
      livemode: false,
    };
  });

  app.post('/public/payment_links/:token/checkout', async (request, reply) => {
    const { token } = request.params as { token: string };
    const parsedBody = publicCheckoutSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'Invalid request.' } });

    const rawIdempotency = request.headers['idempotency-key'];
    const parsedKey = idempotencySchema.safeParse(typeof rawIdempotency === 'string' ? rawIdempotency : '');
    if (!parsedKey.success) {
      return reply.code(400).send({
        error: { type: 'invalid_request_error', code: 'idempotency_key_required', message: 'Payment Link checkout requires an Idempotency-Key header.' },
      });
    }

    const link = await prisma.paymentLink.findUnique({ where: { publicToken: token } });
    if (!link || !link.active) return reply.code(404).send({ error: { type: 'not_found', message: 'This payment link is unavailable.' } });

    const internalKey = `plink:${link.id}:${parsedKey.data}`;
    const existing = await prisma.paymentIntent.findUnique({
      where: { merchantId_idempotencyKey: { merchantId: link.merchantId, idempotencyKey: internalKey } },
    });
    if (existing) {
      if (existing.paymentLinkId !== link.id) {
        return reply.code(409).send({ error: { type: 'idempotency_error', message: 'This checkout request conflicts with an existing payment.' } });
      }
      return { payment_intent: existing.id, checkout_url: checkoutUrl(existing.checkoutToken), status: existing.status.toLowerCase(), livemode: false };
    }

    const referenceSuffix = randomBytes(5).toString('hex').toUpperCase();
    const merchantReference = link.merchantReferencePrefix ? `${link.merchantReferencePrefix}-${referenceSuffix}` : `PLINK-${referenceSuffix}`;
    const risk = await evaluateRisk(link.merchantId, {
      amount: link.amount,
      currency: link.currency,
      merchant_reference: merchantReference,
    });
    if (risk.outcome === 'blocked') {
      return reply.code(403).send({
        error: { type: 'risk_blocked', code: 'risk_rule_blocked', message: `Payment blocked by sandbox risk rule: ${risk.ruleName ?? 'unnamed rule'}.` },
      });
    }

    const checkoutToken = `ct_test_${randomBytes(24).toString('hex')}`;
    const intent = await prisma.paymentIntent.create({
      data: {
        merchantId: link.merchantId,
        paymentLinkId: link.id,
        environment: 'TEST',
        amount: link.amount,
        currency: link.currency,
        merchantReference,
        description: link.description ?? link.title,
        checkoutToken,
        idempotencyKey: internalKey,
        metadata: { payment_link_id: link.id },
      },
    });

    return reply.code(201).send({
      payment_intent: intent.id,
      checkout_url: checkoutUrl(intent.checkoutToken),
      status: intent.status.toLowerCase(),
      livemode: false,
    });
  });
}
