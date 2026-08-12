import 'dotenv/config';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { prisma } from '@retaillink/database';
import { completeDemo3ds, processDemoCard, sandboxCards } from '@retaillink/payment-core';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

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

async function authenticate(request: { headers: Record<string, unknown> }) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer sk_test_')) return null;
  const rawKey = authorization.slice('Bearer '.length);
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });
  if (!apiKey || apiKey.revokedAt || apiKey.environment !== 'TEST') return null;
  await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });
  return apiKey;
}

app.post('/v1/payment_intents', async (request, reply) => {
  const apiKey = await authenticate(request as never);
  if (!apiKey) return reply.code(401).send(authError());

  const parsed = createPaymentIntentSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(validationError(parsed.error.flatten()));

  const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
  if (idempotencyKey) {
    const existing = await prisma.paymentIntent.findUnique({
      where: { merchantId_idempotencyKey: { merchantId: apiKey.merchantId, idempotencyKey } },
    });
    if (existing) return serializePaymentIntent(existing);
  }

  const paymentIntent = await prisma.paymentIntent.create({
    data: {
      merchantId: apiKey.merchantId,
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

  return reply.code(201).send(serializePaymentIntent(paymentIntent));
});

app.get('/v1/payment_intents', async (request, reply) => {
  const apiKey = await authenticate(request as never);
  if (!apiKey) return reply.code(401).send(authError());
  const rows = await prisma.paymentIntent.findMany({
    where: { merchantId: apiKey.merchantId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return { object: 'list', data: rows.map(serializePaymentIntent) };
});

app.get('/v1/payment_intents/:id', async (request, reply) => {
  const apiKey = await authenticate(request as never);
  if (!apiKey) return reply.code(401).send(authError());
  const { id } = request.params as { id: string };
  const row = await prisma.paymentIntent.findFirst({ where: { id, merchantId: apiKey.merchantId } });
  if (!row) return reply.code(404).send(notFound('payment_intent'));
  return serializePaymentIntent(row);
});

app.get('/v1/payments', async (request, reply) => {
  const apiKey = await authenticate(request as never);
  if (!apiKey) return reply.code(401).send(authError());
  const rows = await prisma.payment.findMany({
    where: { merchantId: apiKey.merchantId },
    include: { paymentIntent: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return { object: 'list', data: rows.map(serializePayment) };
});

app.get('/checkout/:token', async (request, reply) => {
  const { token } = request.params as { token: string };
  const row = await prisma.paymentIntent.findUnique({
    where: { checkoutToken: token },
    include: { merchant: { select: { name: true } } },
  });
  if (!row || row.environment !== 'TEST') return reply.code(404).send(notFound('checkout_session'));
  return {
    id: row.id,
    merchant_name: row.merchant.name,
    amount: row.amount.toString(),
    currency: row.currency,
    description: row.description,
    merchant_reference: row.merchantReference,
    status: row.status.toLowerCase(),
  };
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
      prisma.payment.create({
        data: {
          merchantId: intent.merchantId,
          paymentIntentId: intent.id,
          amount: intent.amount,
          currency: intent.currency,
          status: 'FAILED',
          cardBrand: result.brand,
          cardLast4: result.last4,
          failureCode: result.code,
          failureMessage: result.message,
        },
      }),
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
  const apiKey = await authenticate(request as never);
  if (!apiKey) return reply.code(401).send(authError());
  const { id } = request.params as { id: string };
  const parsed = refundSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send(validationError(parsed.error.flatten()));

  const payment = await prisma.payment.findFirst({ where: { id, merchantId: apiKey.merchantId } });
  if (!payment || !['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(payment.status)) return reply.code(404).send(notFound('refundable_payment'));

  const remaining = payment.amount - payment.refundedAmount;
  const amount = BigInt(parsed.data.amount ?? Number(remaining));
  if (amount <= 0n || amount > remaining) {
    return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'Refund amount exceeds the refundable balance.' } });
  }

  const refund = await prisma.$transaction(async (tx) => {
    const row = await tx.refund.create({
      data: {
        merchantId: payment.merchantId,
        paymentId: payment.id,
        amount,
        currency: payment.currency,
        status: 'SUCCEEDED',
        reason: parsed.data.reason,
      },
    });
    const newRefunded = payment.refundedAmount + amount;
    await tx.payment.update({
      where: { id: payment.id },
      data: { refundedAmount: newRefunded, status: newRefunded === payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
    });
    await postRefundLedger(tx, payment.merchantId, payment.currency, amount, row.id);
    return row;
  });

  await emitWebhook(payment.merchantId, 'refund.succeeded', serializeRefund(refund));
  return reply.code(201).send(serializeRefund(refund));
});

app.post('/v1/webhook_endpoints', async (request, reply) => {
  const apiKey = await authenticate(request as never);
  if (!apiKey) return reply.code(401).send(authError());
  const parsed = webhookSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(validationError(parsed.error.flatten()));
  const secret = `whsec_test_${randomBytes(24).toString('hex')}`;
  const endpoint = await prisma.webhookEndpoint.create({ data: { merchantId: apiKey.merchantId, url: parsed.data.url, secret } });
  return reply.code(201).send({ id: endpoint.id, url: endpoint.url, enabled: endpoint.enabled, secret, livemode: false });
});

app.get('/v1/webhook_endpoints', async (request, reply) => {
  const apiKey = await authenticate(request as never);
  if (!apiKey) return reply.code(401).send(authError());
  const rows = await prisma.webhookEndpoint.findMany({ where: { merchantId: apiKey.merchantId }, orderBy: { createdAt: 'desc' } });
  return { object: 'list', data: rows.map((row) => ({ id: row.id, url: row.url, enabled: row.enabled, created_at: row.createdAt.toISOString() })) };
});

async function recordSuccessfulPayment(
  intent: { id: string; merchantId: string; amount: bigint; currency: string },
  brand: string,
  last4: string,
  processorRef: string,
) {
  const existing = await prisma.payment.findFirst({ where: { paymentIntentId: intent.id, status: 'SUCCEEDED' } });
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        merchantId: intent.merchantId,
        paymentIntentId: intent.id,
        amount: intent.amount,
        currency: intent.currency,
        status: 'SUCCEEDED',
        processor: 'DEMO',
        processorRef,
        cardBrand: brand,
        cardLast4: last4,
      },
    });
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
    rows.push(await tx.ledgerAccount.upsert({
      where: { merchantId_code_currency: { merchantId, code, currency } },
      update: {},
      create: { merchantId, code, name, currency },
    }));
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
    const delivery = await prisma.webhookDelivery.create({
      data: { endpointId: endpoint.id, eventId, eventType, payload: payload as any, attempts: 1 },
    });
    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-retaillink-signature': `t=${timestamp},v1=${signature}` },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
    } catch (error) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'FAILED', lastError: error instanceof Error ? error.message : 'Webhook delivery failed' },
      });
    }
  }
}

function serializePaymentIntent(row: any) {
  const checkoutBaseUrl = process.env.CHECKOUT_BASE_URL ?? 'http://localhost:3002';
  return {
    id: row.id,
    object: 'payment_intent',
    amount: row.amount.toString(),
    currency: row.currency,
    status: row.status.toLowerCase(),
    merchant_reference: row.merchantReference,
    description: row.description,
    checkout_url: `${checkoutBaseUrl}/pay/${row.checkoutToken}`,
    created_at: row.createdAt.toISOString(),
    livemode: false,
  };
}

function serializePayment(row: any) {
  return {
    id: row.id,
    object: 'payment',
    payment_intent: row.paymentIntentId,
    amount: row.amount.toString(),
    amount_refunded: row.refundedAmount.toString(),
    currency: row.currency,
    status: row.status.toLowerCase(),
    payment_method: row.cardLast4 ? { type: 'card', brand: row.cardBrand, last4: row.cardLast4 } : null,
    created_at: row.createdAt.toISOString(),
    livemode: false,
  };
}

function serializeRefund(row: any) {
  return {
    id: row.id,
    object: 'refund',
    payment: row.paymentId,
    amount: row.amount.toString(),
    currency: row.currency,
    status: row.status.toLowerCase(),
    reason: row.reason,
    created_at: row.createdAt.toISOString(),
    livemode: false,
  };
}

function authError() {
  return { error: { type: 'authentication_error', message: 'A valid test secret API key is required.' } };
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
