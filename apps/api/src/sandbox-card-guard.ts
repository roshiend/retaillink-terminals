import type { FastifyInstance } from 'fastify';
import { sandboxCards } from '@retaillink/payment-core';
import { z } from 'zod';

const bodySchema = z.object({
  card_number: z.string().min(12).max(24),
  expiry: z.string().min(4).max(7),
}).passthrough();

const allowed = new Set(Object.values(sandboxCards));

function normalizeCard(value: string) {
  return value.replace(/\s|-/g, '');
}

function validFutureExpiry(value: string) {
  const match = value.trim().match(/^(0[1-9]|1[0-2])\/(\d{2}|\d{4})$/);
  if (!match) return false;
  const month = Number(match[1]);
  let year = Number(match[2]);
  if (year < 100) year += 2000;
  const expiryBoundary = new Date(Date.UTC(year, month, 1));
  return expiryBoundary > new Date();
}

export function registerSandboxCardGuard(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'POST' || request.routeOptions.url !== '/checkout/:token/confirm') return;
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return;

    const normalized = normalizeCard(parsed.data.card_number);
    if (!allowed.has(normalized as (typeof sandboxCards)[keyof typeof sandboxCards])) {
      return reply.code(400).send({
        error: {
          type: 'invalid_request_error',
          code: 'invalid_test_card',
          message: 'Use one of the documented Retaillink sandbox card numbers. Real or undocumented card numbers are rejected before payment processing.',
        },
      });
    }

    if (!validFutureExpiry(parsed.data.expiry)) {
      return reply.code(400).send({
        error: {
          type: 'invalid_request_error',
          code: 'invalid_expiry',
          message: 'Use a valid future sandbox expiry in MM/YY or MM/YYYY format.',
        },
      });
    }
  });
}
