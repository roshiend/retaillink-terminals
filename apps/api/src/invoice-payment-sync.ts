import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@retaillink/database';

function parsePayload(payload: unknown) {
  try {
    if (typeof payload === 'string') return JSON.parse(payload);
    if (Buffer.isBuffer(payload)) return JSON.parse(payload.toString('utf8'));
  } catch {
    return null;
  }
  return null;
}

async function paymentIntentForCheckout(request: FastifyRequest) {
  const { token } = request.params as { token?: string };
  if (!token) return null;
  return prisma.paymentIntent.findUnique({
    where: { checkoutToken: token },
    select: { id: true, status: true, invoice: { select: { id: true, status: true } } },
  });
}

export function registerInvoicePaymentSync(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    const route = request.routeOptions.url;
    if (request.method !== 'POST' || (route !== '/checkout/:token/confirm' && route !== '/checkout/:token/3ds/complete')) return;

    const intent = await paymentIntentForCheckout(request);
    if (!intent) return;
    if (intent.status === 'CANCELED' || intent.invoice?.status === 'VOID') {
      return reply.code(409).send({
        error: {
          type: 'invalid_state',
          code: 'invoice_not_payable',
          message: 'This invoice is no longer payable.',
        },
      });
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const route = request.routeOptions.url;
    if (request.method !== 'POST' || (route !== '/checkout/:token/confirm' && route !== '/checkout/:token/3ds/complete')) return payload;
    if (reply.statusCode < 200 || reply.statusCode >= 300) return payload;

    const data = parsePayload(payload);
    const payment = data?.payment;
    if (!payment?.payment_intent || payment.status !== 'succeeded') return payload;

    const amount = typeof payment.amount === 'string' ? BigInt(payment.amount) : null;
    if (amount === null) return payload;

    await prisma.invoice.updateMany({
      where: { paymentIntentId: payment.payment_intent, status: 'OPEN' },
      data: { status: 'PAID', amountPaid: amount, paidAt: new Date() },
    });

    return payload;
  });
}
