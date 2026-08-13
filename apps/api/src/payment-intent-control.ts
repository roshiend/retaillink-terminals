import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@retaillink/database';

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function authenticate(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer sk_test_')) {
    const key = await prisma.apiKey.findUnique({
      where: { keyHash: hashToken(authorization.slice('Bearer '.length)) },
    });
    if (key && !key.revokedAt && key.environment === 'TEST') {
      return { merchantId: key.merchantId, userId: null as string | null, source: 'api_key' as const };
    }
  }

  const token = request.cookies.rt_session;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session || session.expiresAt <= new Date()) return null;
  return { merchantId: session.merchantId, userId: session.userId, source: 'session' as const };
}

function serialize(row: {
  id: string;
  amount: bigint;
  currency: string;
  status: string;
  merchantReference: string | null;
  description: string | null;
  checkoutToken: string;
  createdAt: Date;
}) {
  const checkoutBaseUrl = (process.env.CHECKOUT_BASE_URL ?? 'http://localhost:3002').replace(/\/$/, '');
  return {
    id: row.id,
    object: 'payment_intent',
    amount: row.amount.toString(),
    currency: row.currency,
    status: row.status.toLowerCase(),
    merchant_reference: row.merchantReference,
    description: row.description,
    checkout_url: `${checkoutBaseUrl}/pay/${row.checkoutToken}`,
    livemode: false,
    created_at: row.createdAt.toISOString(),
  };
}

export function registerPaymentIntentControl(app: FastifyInstance) {
  app.post('/v1/payment_intents/:id/cancel', async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth) {
      return reply.code(401).send({
        error: { type: 'authentication_error', message: 'A valid sandbox API key or merchant session is required.' },
      });
    }

    const { id } = request.params as { id: string };
    const intent = await prisma.paymentIntent.findFirst({
      where: { id, merchantId: auth.merchantId },
      include: { invoice: { select: { id: true, status: true } } },
    });
    if (!intent) {
      return reply.code(404).send({ error: { type: 'not_found', message: 'No such payment_intent.' } });
    }

    if (intent.invoice && intent.invoice.status === 'OPEN') {
      return reply.code(409).send({
        error: {
          type: 'invalid_state',
          code: 'invoice_payment_intent',
          message: 'This Payment Intent belongs to an open invoice. Void the invoice instead of canceling its Payment Intent directly.',
        },
      });
    }

    if (intent.status === 'CANCELED') return serialize(intent);
    if (intent.status === 'SUCCEEDED') {
      return reply.code(409).send({
        error: { type: 'invalid_state', code: 'payment_already_succeeded', message: 'A succeeded Payment Intent cannot be canceled.' },
      });
    }
    if (intent.status === 'PROCESSING') {
      return reply.code(409).send({
        error: { type: 'invalid_state', code: 'payment_processing', message: 'A processing Payment Intent cannot be canceled.' },
      });
    }

    const updated = await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: 'CANCELED',
        actionToken: null,
        actionCardBrand: null,
        actionCardLast4: null,
      },
    });

    if (auth.source === 'session') {
      await prisma.auditLog.create({
        data: {
          merchantId: auth.merchantId,
          userId: auth.userId ?? undefined,
          action: 'payment_intent.canceled',
          resource: 'payment_intent',
          resourceId: updated.id,
          ipAddress: request.ip,
        },
      });
    }

    return serialize(updated);
  });
}
