import 'dotenv/config';
import { randomBytes, createHash } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import { prisma } from '@retaillink/database';

const app = Fastify({ logger: true });

app.get('/health', async () => ({
  status: 'ok',
  service: 'retaillink-terminal-api',
  environment: 'sandbox',
}));

const createPaymentIntentSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().length(3).default('LKR'),
  merchant_reference: z.string().max(255).optional(),
  description: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

app.post('/v1/payment_intents', async (request, reply) => {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer sk_test_')) {
    return reply.code(401).send({
      error: { type: 'authentication_error', message: 'A valid test secret API key is required.' },
    });
  }

  const rawKey = authorization.slice('Bearer '.length);
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });

  if (!apiKey || apiKey.revokedAt || apiKey.environment !== 'TEST') {
    return reply.code(401).send({
      error: { type: 'authentication_error', message: 'Invalid or revoked API key.' },
    });
  }

  const parsed = createPaymentIntentSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: { type: 'invalid_request_error', details: parsed.error.flatten() },
    });
  }

  const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

  if (idempotencyKey) {
    const existing = await prisma.paymentIntent.findUnique({
      where: { merchantId_idempotencyKey: { merchantId: apiKey.merchantId, idempotencyKey } },
    });
    if (existing) return serializePaymentIntent(existing);
  }

  const checkoutToken = `ct_test_${randomBytes(24).toString('hex')}`;
  const paymentIntent = await prisma.paymentIntent.create({
    data: {
      merchantId: apiKey.merchantId,
      environment: 'TEST',
      amount: BigInt(parsed.data.amount),
      currency: parsed.data.currency.toUpperCase(),
      merchantReference: parsed.data.merchant_reference,
      description: parsed.data.description,
      metadata: parsed.data.metadata,
      checkoutToken,
      idempotencyKey,
    },
  });

  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  return reply.code(201).send(serializePaymentIntent(paymentIntent));
});

function serializePaymentIntent(paymentIntent: {
  id: string;
  amount: bigint;
  currency: string;
  status: string;
  merchantReference: string | null;
  description: string | null;
  checkoutToken: string;
  createdAt: Date;
}) {
  const checkoutBaseUrl = process.env.CHECKOUT_BASE_URL ?? 'http://localhost:3002';
  return {
    id: paymentIntent.id,
    object: 'payment_intent',
    amount: paymentIntent.amount.toString(),
    currency: paymentIntent.currency,
    status: paymentIntent.status.toLowerCase(),
    merchant_reference: paymentIntent.merchantReference,
    description: paymentIntent.description,
    checkout_url: `${checkoutBaseUrl}/pay/${paymentIntent.checkoutToken}`,
    created_at: paymentIntent.createdAt.toISOString(),
    livemode: false,
  };
}

const port = Number(process.env.PORT ?? 3001);

app.listen({ port, host: '0.0.0.0' }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
