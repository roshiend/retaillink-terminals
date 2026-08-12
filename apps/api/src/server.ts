import 'dotenv/config';
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { z } from 'zod';
import { prisma } from '@retaillink/database';
import { completeDemo3ds, processDemoCard, sandboxCards } from '@retaillink/payment-core';

const app = Fastify({ logger: true });
const dashboardOrigin = process.env.DASHBOARD_ORIGIN ?? 'http://localhost:3000';
await app.register(cors, { origin: dashboardOrigin, credentials: true });
await app.register(cookie);

const SESSION_COOKIE = 'rt_session';
const SESSION_DAYS = 7;

app.get('/health', async () => ({ status: 'ok', service: 'retaillink-terminal-api', environment: 'sandbox' }));
app.get('/sandbox/cards', async () => ({
  cards: [
    { number: sandboxCards.success, result: 'succeeded' },
    { number: sandboxCards.decline, result: 'declined' },
    { number: sandboxCards.requiresAction, result: 'requires_action' },
  ],
  expiry: 'Any future date',
  cvc: 'Any 3 digits',
  warning: 'Sandbox only. Never enter real card details.',
}));

const signupSchema = z.object({
  business_name: z.string().trim().min(2).max(120),
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const createApiKeySchema = z.object({ name: z.string().trim().min(1).max(80).default('Sandbox key') });
const createPaymentIntentSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().length(3).default('LKR'),
  merchant_reference: z.string().max(255).optional(),
  description: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const cardSchema = z.object({
  card_number: z.string().min(12).max(24),
  expiry: z.string().min(4).max(7),
  cvc: z.string().regex(/^\d{3,4}$/),
});
const refundSchema = z.object({ amount: z.number().int().positive().optional(), reason: z.string().max(255).optional() });
const webhookSchema = z.object({ url: z.string().url() });

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const digest = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${digest}`;
}

function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, digest] = stored.split(':');
  if (algorithm !== 'scrypt' || !salt || !digest) return false;
  const expected = Buffer.from(digest, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function sessionExpiry() {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}

function setSessionCookie(reply: any, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

async function createSession(userId: string, merchantId: string) {
  const token = `sess_${randomBytes(32).toString('hex')}`;
  await prisma.session.create({ data: { tokenHash: hashToken(token), userId, merchantId, expiresAt: sessionExpiry() } });
  return token;
}

async function getSession(request: FastifyRequest) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const row = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true, merchant: true },
  });
  if (!row) return null;
  if (row.expiresAt <= new Date()) {
    await prisma.session.delete({ where: { id: row.id } }).catch(() => undefined);
    return null;
  }
  await prisma.session.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } });
  return row;
}

async function authenticate(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer sk_test_')) {
    const rawKey = authorization.slice('Bearer '.length);
    const keyHash = hashToken(rawKey);
    const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });
    if (apiKey && !apiKey.revokedAt && apiKey.environment === 'TEST') {
      await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });
      return { merchantId: apiKey.merchantId, userId: null as string | null, source: 'api_key' as const };
    }
  }

  const session = await getSession(request);
  if (!session) return null;
  return { merchantId: session.merchantId, userId: session.userId, source: 'session' as const };
}

async function requireSession(request: FastifyRequest) {
  return getSession(request);
}

async function audit(merchantId: string, userId: string | null, action: string, resource: string, resourceId?: string, metadata?: unknown, ipAddress?: string) {
  await prisma.auditLog.create({
    data: {
      merchantId,
      userId: userId ?? undefined,
      action,
      resource,
      resourceId,
      metadata: metadata as any,
      ipAddress,
    },
  });
}

app.post('/auth/signup', async (request, reply) => {
  const parsed = signupSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(validationError(parsed.error.flatten()));
  const email = parsed.data.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return reply.code(409).send({ error: { type: 'account_exists', message: 'An account with this email already exists.' } });

  const apiSecret = `sk_test_${randomBytes(24).toString('hex')}`;
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, passwordHash: hashPassword(parsed.data.password) } });
    const merchant = await tx.merchant.create({ data: { name: parsed.data.business_name, country: 'LK', defaultCurrency: 'LKR' } });
    await tx.merchantUser.create({ data: { userId: user.id, merchantId: merchant.id, role: 'OWNER' } });
    await tx.apiKey.create({
      data: {
        merchantId: merchant.id,
        environment: 'TEST',
        name: 'Default sandbox key',
        prefix: apiSecret.slice(0, 16),
        keyHash: hashToken(apiSecret),
      },
    });
    return { user, merchant };
  });

  const token = await createSession(result.user.id, result.merchant.id);
  setSessionCookie(reply, token);
  await audit(result.merchant.id, result.user.id, 'account.created', 'merchant', result.merchant.id, undefined, request.ip);
  return reply.code(201).send({
    user: { id: result.user.id, email: result.user.email },
    merchant: { id: result.merchant.id, name: result.merchant.name, country: result.merchant.country, currency: result.merchant.defaultCurrency },
    initial_test_api_key: apiSecret,
  });
});

app.post('/auth/login', async (request, reply) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(validationError(parsed.error.flatten()));
  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.trim().toLowerCase() },
    include: { memberships: { include: { merchant: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
  });
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash) || !user.memberships[0]) {
    return reply.code(401).send({ error: { type: 'authentication_error', message: 'Incorrect email or password.' } });
  }
  const membership = user.memberships[0];
  const token = await createSession(user.id, membership.merchantId);
  setSessionCookie(reply, token);
  await audit(membership.merchantId, user.id, 'session.created', 'session', undefined, undefined, request.ip);
  return { user: { id: user.id, email: user.email }, merchant: { id: membership.merchant.id, name: membership.merchant.name, country: membership.merchant.country, currency: membership.merchant.defaultCurrency }, role: membership.role };
});

app.post('/auth/logout', async (request, reply) => {
  const token = request.cookies[SESSION_COOKIE];
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  return { ok: true };
});

app.get('/auth/me', async (request, reply) => {
  const session = await requireSession(request);
  if (!session) return reply.code(401).send(authError('Merchant login required.'));
  const membership = await prisma.merchantUser.findUnique({ where: { userId_merchantId: { userId: session.userId, merchantId: session.merchantId } } });
  return {
    user: { id: session.user.id, email: session.user.email },
    merchant: { id: session.merchant.id, name: session.merchant.name, country: session.merchant.country, currency: session.merchant.defaultCurrency },
    role: membership?.role ?? 'STAFF',
  };
});

app.get('/dashboard/api_keys', async (request, reply) => {
  const session = await requireSession(request);
  if (!session) return reply.code(401).send(authError('Merchant login required.'));
  const keys = await prisma.apiKey.findMany({ where: { merchantId: session.merchantId }, orderBy: { createdAt: 'desc' } });
  return { data: keys.map((key) => ({ id: key.id, name: key.name, prefix: key.prefix, environment: key.environment.toLowerCase(), last_used_at: key.lastUsedAt?.toISOString() ?? null, revoked_at: key.revokedAt?.toISOString() ?? null, created_at: key.createdAt.toISOString() })) };
});

app.post('/dashboard/api_keys', async (request, reply) => {
  const session = await requireSession(request);
  if (!session) return reply.code(401).send(authError('Merchant login required.'));
  const parsed = createApiKeySchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send(validationError(parsed.error.flatten()));
  const secret = `sk_test_${randomBytes(24).toString('hex')}`;
  const key = await prisma.apiKey.create({
    data: { merchantId: session.merchantId, environment: 'TEST', name: parsed.data.name, prefix: secret.slice(0, 16), keyHash: hashToken(secret) },
  });
  await audit(session.merchantId, session.userId, 'api_key.created', 'api_key', key.id, { name: key.name }, request.ip);
  return reply.code(201).send({ id: key.id, name: key.name, prefix: key.prefix, secret, environment: 'test', created_at: key.createdAt.toISOString() });
});

app.delete('/dashboard/api_keys/:id', async (request, reply) => {
  const session = await requireSession(request);
  if (!session) return reply.code(401).send(authError('Merchant login required.'));
  const { id } = request.params as { id: string };
  const key = await prisma.apiKey.findFirst({ where: { id, merchantId: session.merchantId } });
  if (!key) return reply.code(404).send(notFound('api_key'));
  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit(session.merchantId, session.userId, 'api_key.revoked', 'api_key', id, undefined, request.ip);
  return { ok: true };
});

app.get('/dashboard/audit_logs', async (request, reply) => {
  const session = await requireSession(request);
  if (!session) return reply.code(401).send(authError('Merchant login required.'));
  const rows = await prisma.auditLog.findMany({ where: { merchantId: session.merchantId }, orderBy: { createdAt: 'desc' }, take: 100 });
  return { data: rows.map((row) => ({ id: row.id, action: row.action, resource: row.resource, resource_id: row.resourceId, ip_address: row.ipAddress, created_at: row.createdAt.toISOString() })) };
});

app.post('/v1/payment_intents', async (request, reply) => {
  const auth = await authenticate(request);
  if (!auth) return reply.code(401).send(authError());
  const parsed = createPaymentIntentSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(validationError(parsed.error.flatten()));

  const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
  if (idempotencyKey) {
    const existing = await prisma.paymentIntent.findUnique({ where: { merchantId_idempotencyKey: { merchantId: auth.merchantId, idempotencyKey } } });
    if (existing) return serializePaymentIntent(existing);
  }

  const paymentIntent = await prisma.paymentIntent.create({
    data: {
      merchantId: auth.merchantId,
      environment: 'TEST',
      amount: BigInt(parsed.data.amount),
      currency: parsed.data.currency.toUpperCase(),
      merchantReference: parsed.data.merchant_reference,
      description: parsed.data.description,
      metadata: parsed.data.metadata,
      checkoutToken: `ct_test_${randomBytes(24).toString('hex')}`,
      idempotencyKey,
    },
  });
  if (auth.source === 'session') await audit(auth.merchantId, auth.userId, 'payment_intent.created', 'payment_intent', paymentIntent.id, { amount: parsed.data.amount, currency: parsed.data.currency }, request.ip);
  return reply.code(201).send(serializePaymentIntent(paymentIntent));
});

app.get('/v1/payment_intents', async (request, reply) => {
  const auth = await authenticate(request);
  if (!auth) return reply.code(401).send(authError());
  const rows = await prisma.paymentIntent.findMany({ where: { merchantId: auth.merchantId }, orderBy: { createdAt: 'desc' }, take: 100 });
  return { object: 'list', data: rows.map(serializePaymentIntent) };
});

app.get('/v1/payment_intents/:id', async (request, reply) => {
  const auth = await authenticate(request);
  if (!auth) return reply.code(401).send(authError());
  const { id } = request.params as { id: string };
  const row = await prisma.paymentIntent.findFirst({ where: { id, merchantId: auth.merchantId } });
  if (!row) return reply.code(404).send(notFound('payment_intent'));
  return serializePaymentIntent(row);
});

app.get('/v1/payments', async (request, reply) => {
  const auth = await authenticate(request);
  if (!auth) return reply.code(401).send(authError());
  const rows = await prisma.payment.findMany({ where: { merchantId: auth.merchantId }, include: { paymentIntent: true }, orderBy: { createdAt: 'desc' }, take: 100 });
  return { object: 'list', data: rows.map(serializePayment) };
});

app.get('/v1/payments/:id', async (request, reply) => {
  const auth = await authenticate(request);
  if (!auth) return reply.code(401).send(authError());
  const { id } = request.params as { id: string };
  const row = await prisma.payment.findFirst({ where: { id, merchantId: auth.merchantId }, include: { refunds: true, paymentIntent: true } });
  if (!row) return reply.code(404).send(notFound('payment'));
  return { ...serializePayment(row), merchant_reference: row.paymentIntent.merchantReference, description: row.paymentIntent.description, refunds: row.refunds.map(serializeRefund) };
});

app.get('/v1/refunds', async (request, reply) => {
  const auth = await authenticate(request);
  if (!auth) return reply.code(401).send(authError());
  const rows = await prisma.refund.findMany({ where: { merchantId: auth.merchantId }, orderBy: { createdAt: 'desc' }, take: 100 });
  return { object: 'list', data: rows.map(serializeRefund) };
});

app.get('/v1/balance', async (request, reply) => {
  const auth = await authenticate(request);
  if (!auth) return reply.code(401).send(authError());
  const account = await prisma.ledgerAccount.findUnique({ where: { merchantId_code_currency: { merchantId: auth.merchantId, code: 'MERCHANT_PAYABLE', currency: 'LKR' } } });
  if (!account) return { object: 'balance', available: '0', currency: 'LKR' };
  const entries = await prisma.ledgerEntry.findMany({ where: { accountId: account.id } });
  const available = entries.reduce((sum, entry) => sum + (entry.direction === 'CREDIT' ? entry.amount : -entry.amount), 0n);
  return { object: 'balance', available: available.toString(), currency: account.currency };
});

app.get('/v1/settlements', async (request, reply) => {
  const auth = await authenticate(request);
  if (!auth) return reply.code(401).send(authError());
  const rows = await prisma.settlement.findMany({ where: { merchantId: auth.merchantId }, orderBy: { createdAt: 'desc' }, take: 100 });
  return { object: 'list', data: rows.map((row) => ({ id: row.id, amount: row.amount.toString(), currency: row.currency, status: row.status.toLowerCase(), period_from: row.periodFrom.toISOString(), period_to: row.periodTo.toISOString(), created_at: row.createdAt.toISOString() })) };
});

app.get('/checkout/:token', async (request, reply) => {
  const { token } = request.params as { token: string };
  const row = await prisma.paymentIntent.findUnique({ where: { checkoutToken: token }, include: { merchant: { select: { name: true } } } });
  if (!row || row.environment !== 'TEST') return reply.code(404).send(notFound('checkout_session'));
  return { id: row.id, merchant_name: row.merchant.name, amount: row.amount.toString(), currency: row.currency, description: row.description, merchant_reference: row.merchantReference, status: row.status.toLowerCase() };
});

app.post('/checkout/:token/confirm', async (request, reply) => {
  const { token } = request.params as { token: string };
  const parsed = cardSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(validationError(parsed.error.flatten()));
  const intent = await prisma.paymentIntent.findUnique({ where: { checkoutToken: token } });
  if (!intent || intent.environment !== 'TEST') return reply.code(404).send(notFound('checkout_session'));
  if (intent.status === 'SUCCEEDED') {
    const payment = await prisma.payment.findFirst({ where: { paymentIntentId: intent.id, status: 'SUCCEEDED' } });
    return { status: 'succeeded', payment: payment ? serializePayment(payment) : null };
  }

  const result = processDemoCard(parsed.data.card_number);
  if (result.outcome === 'requires_action') {
    await prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: 'REQUIRES_ACTION' } });
    return { status: 'requires_action', action_token: result.actionToken, test_only: true };
  }
  if (result.outcome === 'declined') {
    await prisma.$transaction([
      prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: 'FAILED' } }),
      prisma.payment.create({ data: { merchantId: intent.merchantId, paymentIntentId: intent.id, amount: intent.amount, currency: intent.currency, status: 'FAILED', cardBrand: result.brand, cardLast4: result.last4, failureCode: result.code, failureMessage: result.message } }),
    ]);
    return reply.code(402).send({ error: { type: 'card_error', code: result.code, message: result.message } });
  }
  const payment = await recordSuccessfulPayment(intent, result.brand, result.last4, result.processorRef);
  await emitWebhook(intent.merchantId, 'payment.succeeded', serializePayment(payment));
  return { status: 'succeeded', payment: serializePayment(payment) };
});

app.post('/checkout/:token/3ds/complete', async (request, reply) => {
  const { token } = request.params as { token: string };
  const parsed = z.object({ action_token: z.string().min(10) }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(validationError(parsed.error.flatten()));
  const intent = await prisma.paymentIntent.findUnique({ where: { checkoutToken: token } });
  if (!intent || intent.environment !== 'TEST') return reply.code(404).send(notFound('checkout_session'));
  if (intent.status !== 'REQUIRES_ACTION') return reply.code(409).send({ error: { type: 'invalid_state', message: 'Payment does not require 3DS.' } });
  const result = completeDemo3ds(parsed.data.action_token);
  const payment = await recordSuccessfulPayment(intent, 'visa', '3155', result.processorRef);
  await emitWebhook(intent.merchantId, 'payment.succeeded', serializePayment(payment));
  return { status: 'succeeded', payment: serializePayment(payment) };
});

app.post('/v1/payments/:id/refunds', async (request, reply) => {
  const auth = await authenticate(request);
  if (!auth) return reply.code(401).send(authError());
  const { id } = request.params as { id: string };
  const parsed = refundSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send(validationError(parsed.error.flatten()));
  const payment = await prisma.payment.findFirst({ where: { id, merchantId: auth.merchantId } });
  if (!payment || !['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(payment.status)) return reply.code(404).send(notFound('refundable_payment'));
  const remaining = payment.amount - payment.refundedAmount;
  const amount = BigInt(parsed.data.amount ?? Number(remaining));
  if (amount <= 0n || amount > remaining) return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'Refund amount exceeds the refundable balance.' } });

  const refund = await prisma.$transaction(async (tx) => {
    const row = await tx.refund.create({ data: { merchantId: payment.merchantId, paymentId: payment.id, amount, currency: payment.currency, status: 'SUCCEEDED', reason: parsed.data.reason } });
    const newRefunded = payment.refundedAmount + amount;
    await tx.payment.update({ where: { id: payment.id }, data: { refundedAmount: newRefunded, status: newRefunded === payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
    await postRefundLedger(tx, payment.merchantId, payment.currency, amount, row.id);
    return row;
  });
  if (auth.source === 'session') await audit(auth.merchantId, auth.userId, 'refund.created', 'refund', refund.id, { payment_id: payment.id, amount: amount.toString() }, request.ip);
  await emitWebhook(payment.merchantId, 'refund.succeeded', serializeRefund(refund));
  return reply.code(201).send(serializeRefund(refund));
});

app.post('/v1/webhook_endpoints', async (request, reply) => {
  const auth = await authenticate(request);
  if (!auth) return reply.code(401).send(authError());
  const parsed = webhookSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(validationError(parsed.error.flatten()));
  const secret = `whsec_test_${randomBytes(24).toString('hex')}`;
  const endpoint = await prisma.webhookEndpoint.create({ data: { merchantId: auth.merchantId, url: parsed.data.url, secret } });
  if (auth.source === 'session') await audit(auth.merchantId, auth.userId, 'webhook.created', 'webhook_endpoint', endpoint.id, { url: endpoint.url }, request.ip);
  return reply.code(201).send({ id: endpoint.id, url: endpoint.url, enabled: endpoint.enabled, secret, livemode: false });
});

app.get('/v1/webhook_endpoints', async (request, reply) => {
  const auth = await authenticate(request);
  if (!auth) return reply.code(401).send(authError());
  const rows = await prisma.webhookEndpoint.findMany({ where: { merchantId: auth.merchantId }, orderBy: { createdAt: 'desc' } });
  return { object: 'list', data: rows.map((row) => ({ id: row.id, url: row.url, enabled: row.enabled, created_at: row.createdAt.toISOString() })) };
});

app.delete('/v1/webhook_endpoints/:id', async (request, reply) => {
  const auth = await authenticate(request);
  if (!auth) return reply.code(401).send(authError());
  const { id } = request.params as { id: string };
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id, merchantId: auth.merchantId } });
  if (!endpoint) return reply.code(404).send(notFound('webhook_endpoint'));
  await prisma.webhookEndpoint.delete({ where: { id } });
  if (auth.source === 'session') await audit(auth.merchantId, auth.userId, 'webhook.deleted', 'webhook_endpoint', id, undefined, request.ip);
  return { ok: true };
});

app.get('/v1/webhook_deliveries', async (request, reply) => {
  const auth = await authenticate(request);
  if (!auth) return reply.code(401).send(authError());
  const endpoints = await prisma.webhookEndpoint.findMany({ where: { merchantId: auth.merchantId }, select: { id: true } });
  const rows = await prisma.webhookDelivery.findMany({ where: { endpointId: { in: endpoints.map((endpoint) => endpoint.id) } }, orderBy: { createdAt: 'desc' }, take: 100 });
  return { object: 'list', data: rows.map((row) => ({ id: row.id, endpoint_id: row.endpointId, event_id: row.eventId, event_type: row.eventType, status: row.status.toLowerCase(), attempts: row.attempts, last_error: row.lastError, delivered_at: row.deliveredAt?.toISOString() ?? null, created_at: row.createdAt.toISOString() })) };
});

async function recordSuccessfulPayment(intent: { id: string; merchantId: string; amount: bigint; currency: string }, brand: string, last4: string, processorRef: string) {
  const existing = await prisma.payment.findFirst({ where: { paymentIntentId: intent.id, status: 'SUCCEEDED' } });
  if (existing) return existing;
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({ data: { merchantId: intent.merchantId, paymentIntentId: intent.id, amount: intent.amount, currency: intent.currency, status: 'SUCCEEDED', processor: 'DEMO', processorRef, cardBrand: brand, cardLast4: last4 } });
    await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: 'SUCCEEDED' } });
    await postPaymentLedger(tx, intent.merchantId, intent.currency, intent.amount, payment.id);
    return payment;
  });
}

async function postPaymentLedger(tx: any, merchantId: string, currency: string, gross: bigint, paymentId: string) {
  const percentageFee = (gross * 250n) / 10000n;
  const fixedFee = currency === 'LKR' ? 3000n : 30n;
  const fee = percentageFee + fixedFee < gross ? percentageFee + fixedFee : 0n;
  const net = gross - fee;
  const accounts = await getAccounts(tx, merchantId, currency);
  const transactionId = `txn_${randomUUID()}`;
  await tx.ledgerEntry.createMany({ data: [
    { transactionId, accountId: accounts.processor.id, direction: 'DEBIT', amount: gross, currency, referenceType: 'payment', referenceId: paymentId },
    { transactionId, accountId: accounts.merchant.id, direction: 'CREDIT', amount: net, currency, referenceType: 'payment', referenceId: paymentId },
    ...(fee > 0n ? [{ transactionId, accountId: accounts.fee.id, direction: 'CREDIT', amount: fee, currency, referenceType: 'payment', referenceId: paymentId }] : []),
  ] });
}

async function postRefundLedger(tx: any, merchantId: string, currency: string, amount: bigint, refundId: string) {
  const accounts = await getAccounts(tx, merchantId, currency);
  const transactionId = `txn_${randomUUID()}`;
  await tx.ledgerEntry.createMany({ data: [
    { transactionId, accountId: accounts.merchant.id, direction: 'DEBIT', amount, currency, referenceType: 'refund', referenceId: refundId },
    { transactionId, accountId: accounts.processor.id, direction: 'CREDIT', amount, currency, referenceType: 'refund', referenceId: refundId },
  ] });
}

async function getAccounts(tx: any, merchantId: string, currency: string) {
  const specs = [
    ['PROCESSOR_CLEARING', 'Processor clearing'],
    ['MERCHANT_PAYABLE', 'Merchant payable'],
    ['FEE_REVENUE', 'Gateway fee revenue'],
  ] as const;
  const rows: any[] = [];
  for (const [code, name] of specs) {
    rows.push(await tx.ledgerAccount.upsert({ where: { merchantId_code_currency: { merchantId, code, currency } }, update: {}, create: { merchantId, code, name, currency } }));
  }
  return { processor: rows[0], merchant: rows[1], fee: rows[2] };
}

async function emitWebhook(merchantId: string, eventType: string, data: unknown) {
  const endpoints = await prisma.webhookEndpoint.findMany({ where: { merchantId, enabled: true } });
  for (const endpoint of endpoints) {
    const eventId = `evt_test_${randomBytes(12).toString('hex')}`;
    const payload = { id: eventId, type: eventType, created: Math.floor(Date.now() / 1000), data, livemode: false };
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac('sha256', endpoint.secret).update(`${timestamp}.${body}`).digest('hex');
    const delivery = await prisma.webhookDelivery.create({ data: { endpointId: endpoint.id, eventId, eventType, payload: payload as any, attempts: 1 } });
    try {
      const response = await fetch(endpoint.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-retaillink-signature': `t=${timestamp},v1=${signature}` }, body, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
    } catch (error) {
      await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: 'FAILED', lastError: error instanceof Error ? error.message : 'Webhook delivery failed' } });
    }
  }
}

function serializePaymentIntent(row: any) {
  const checkoutBaseUrl = process.env.CHECKOUT_BASE_URL ?? 'http://localhost:3002';
  return { id: row.id, object: 'payment_intent', amount: row.amount.toString(), currency: row.currency, status: row.status.toLowerCase(), merchant_reference: row.merchantReference, description: row.description, checkout_url: `${checkoutBaseUrl}/pay/${row.checkoutToken}`, created_at: row.createdAt.toISOString(), livemode: false };
}

function serializePayment(row: any) {
  return { id: row.id, object: 'payment', payment_intent: row.paymentIntentId, amount: row.amount.toString(), amount_refunded: row.refundedAmount.toString(), currency: row.currency, status: row.status.toLowerCase(), payment_method: row.cardLast4 ? { type: 'card', brand: row.cardBrand, last4: row.cardLast4 } : null, failure_code: row.failureCode ?? null, failure_message: row.failureMessage ?? null, created_at: row.createdAt.toISOString(), livemode: false };
}

function serializeRefund(row: any) {
  return { id: row.id, object: 'refund', payment: row.paymentId, amount: row.amount.toString(), currency: row.currency, status: row.status.toLowerCase(), reason: row.reason, created_at: row.createdAt.toISOString(), livemode: false };
}

function authError(message = 'A valid test API key or merchant session is required.') {
  return { error: { type: 'authentication_error', message } };
}
function validationError(details: unknown) {
  return { error: { type: 'invalid_request_error', message: 'Invalid request.', details } };
}
function notFound(object: string) {
  return { error: { type: 'not_found', message: `No such ${object}.` } };
}

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: '0.0.0.0' }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
