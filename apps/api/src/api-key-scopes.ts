import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@retaillink/database';
import { z } from 'zod';

export const API_KEY_SCOPES = [
  'payments:read',
  'payments:write',
  'refunds:read',
  'refunds:write',
  'customers:read',
  'customers:write',
  'payment_links:read',
  'payment_links:write',
  'billing:read',
  'billing:write',
  'webhooks:read',
  'webhooks:write',
  'balance:read',
  'settlements:read',
] as const;

type Scope = typeof API_KEY_SCOPES[number];

const scopedKeySchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(API_KEY_SCOPES.length),
});

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function requiredScope(method: string, route: string): Scope | null {
  const read = ['GET', 'HEAD'].includes(method);

  if (route === '/v1/payment_intents' || route === '/v1/payment_intents/:id' || route === '/v1/payments' || route === '/v1/payments/:id') {
    return read ? 'payments:read' : 'payments:write';
  }
  if (route === '/v1/payment_intents/:id/cancel') return 'payments:write';
  if (route === '/v1/refunds') return 'refunds:read';
  if (route === '/v1/payments/:id/refunds') return 'refunds:write';
  if (route === '/v1/customers' || route === '/v1/customers/:id') return read ? 'customers:read' : 'customers:write';
  if (route === '/v1/payment_links' || route === '/v1/payment_links/:id') return read ? 'payment_links:read' : 'payment_links:write';
  if (route === '/v1/payment_links/:id/state') return 'payment_links:write';
  if (route === '/v1/subscriptions' || route === '/v1/subscriptions/:id' || route === '/v1/invoices' || route === '/v1/invoices/:id') {
    return read ? 'billing:read' : 'billing:write';
  }
  if (route === '/v1/subscriptions/:id/cancel' || route === '/v1/subscriptions/:id/run_cycle' || route === '/v1/subscriptions/:id/resume' || route === '/v1/invoices/:id/void') {
    return 'billing:write';
  }
  if (route === '/v1/webhook_endpoints' || route === '/v1/webhook_deliveries') return read ? 'webhooks:read' : 'webhooks:write';
  if (route === '/v1/webhook_endpoints/:id') return 'webhooks:write';
  if (route === '/v1/balance') return 'balance:read';
  if (route === '/v1/settlements') return 'settlements:read';
  return null;
}

async function sessionFor(request: FastifyRequest) {
  const token = request.cookies.rt_session;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { merchantId: true, userId: true, expiresAt: true },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  return session;
}

export function registerApiKeyScopes(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer sk_test_')) return;

    const route = request.routeOptions.url ?? request.url.split('?', 1)[0];
    if (!route.startsWith('/v1/')) return;
    const needed = requiredScope(request.method, route);
    if (!needed) {
      return reply.code(403).send({
        error: { type: 'permission_error', code: 'api_key_scope_unmapped', message: 'This API route is not available to restricted API keys.' },
      });
    }

    const key = await prisma.apiKey.findUnique({
      where: { keyHash: hashToken(authorization.slice('Bearer '.length)) },
      select: { scopes: true, revokedAt: true, environment: true },
    });
    if (!key || key.revokedAt || key.environment !== 'TEST') return;
    if (key.scopes.includes('*') || key.scopes.includes(needed)) return;

    return reply.code(403).send({
      error: {
        type: 'permission_error',
        code: 'insufficient_api_key_scope',
        message: `This API key requires the ${needed} scope for ${request.method} ${route}.`,
        required_scope: needed,
      },
    });
  });

  app.post('/dashboard/api_keys/scoped', async (request, reply) => {
    const session = await sessionFor(request);
    if (!session) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    const parsed = scopedKeySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'Choose a name and at least one valid API-key scope.', details: parsed.error.flatten() } });
    }

    const rawKey = `sk_test_${randomBytes(24).toString('hex')}`;
    const row = await prisma.apiKey.create({
      data: {
        merchantId: session.merchantId,
        environment: 'TEST',
        name: parsed.data.name,
        prefix: rawKey.slice(0, 16),
        keyHash: hashToken(rawKey),
        scopes: [...new Set(parsed.data.scopes)].sort(),
      },
    });
    await prisma.auditLog.create({
      data: {
        merchantId: session.merchantId,
        userId: session.userId,
        action: 'api_key.scoped_created',
        resource: 'api_key',
        resourceId: row.id,
        metadata: { scopes: row.scopes },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      scopes: row.scopes,
      secret: rawKey,
      environment: 'test',
      created_at: row.createdAt.toISOString(),
      message: 'Copy this secret now. Only its hash is stored.',
    });
  });

  app.get('/dashboard/api_keys/scoped', async (request, reply) => {
    const session = await sessionFor(request);
    if (!session) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    const rows = await prisma.apiKey.findMany({
      where: { merchantId: session.merchantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      object: 'list',
      available_scopes: API_KEY_SCOPES,
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        scopes: row.scopes,
        revoked: Boolean(row.revokedAt),
        last_used_at: row.lastUsedAt?.toISOString() ?? null,
        created_at: row.createdAt.toISOString(),
      })),
    };
  });
}
