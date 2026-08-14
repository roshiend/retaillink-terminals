import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@retaillink/database';

type Role = 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'FINANCE' | 'VIEWER';

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function sessionRole(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer sk_test_')) return null;

  const token = request.cookies.rt_session;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { userId: true, merchantId: true, expiresAt: true },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  const membership = await prisma.merchantUser.findUnique({
    where: { userId_merchantId: { userId: session.userId, merchantId: session.merchantId } },
    select: { role: true },
  });
  return membership?.role as Role | undefined;
}

function allowedRoles(method: string, route: string): Role[] | null {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return null;

  if (route === '/v1/payment_intents' && method === 'POST') return ['OWNER', 'ADMIN', 'DEVELOPER'];
  if (route === '/v1/payment_intents/:id/cancel' && method === 'POST') return ['OWNER', 'ADMIN', 'DEVELOPER'];
  if (route === '/v1/payment_links' && method === 'POST') return ['OWNER', 'ADMIN', 'DEVELOPER'];
  if (route === '/v1/payment_links/:id/state' && method === 'POST') return ['OWNER', 'ADMIN', 'DEVELOPER'];
  if (route === '/v1/payments/:id/refunds' && method === 'POST') return ['OWNER', 'ADMIN', 'FINANCE'];
  if (route === '/v1/webhook_endpoints' && method === 'POST') return ['OWNER', 'ADMIN', 'DEVELOPER'];
  if (route === '/v1/webhook_endpoints/:id' && method === 'DELETE') return ['OWNER', 'ADMIN', 'DEVELOPER'];
  if (route === '/v1/customers' && method === 'POST') return ['OWNER', 'ADMIN', 'DEVELOPER'];
  if (route === '/v1/customers/:id' && ['POST', 'DELETE'].includes(method)) return ['OWNER', 'ADMIN', 'DEVELOPER'];
  if (route === '/v1/subscriptions' && method === 'POST') return ['OWNER', 'ADMIN', 'DEVELOPER'];
  if (route === '/v1/subscriptions/:id/cancel' && method === 'POST') return ['OWNER', 'ADMIN', 'FINANCE'];
  if (route === '/v1/subscriptions/:id/run_cycle' && method === 'POST') return ['OWNER', 'ADMIN', 'FINANCE'];
  if (route === '/v1/subscriptions/:id/resume' && method === 'POST') return ['OWNER', 'ADMIN', 'FINANCE'];
  if (route === '/v1/invoices/:id/void' && method === 'POST') return ['OWNER', 'ADMIN', 'FINANCE'];

  if (route === '/dashboard/api_keys' && method === 'POST') return ['OWNER', 'ADMIN', 'DEVELOPER'];
  if (route === '/dashboard/api_keys/:id' && method === 'DELETE') return ['OWNER', 'ADMIN', 'DEVELOPER'];
  if (route === '/dashboard/settings' && method === 'POST') return ['OWNER'];
  if (route === '/dashboard/settlements' && method === 'POST') return ['OWNER'];
  if (route === '/dashboard/team/invites' && method === 'POST') return ['OWNER'];
  if (route === '/dashboard/team/members/:id' && method === 'DELETE') return ['OWNER'];
  if (route === '/dashboard/risk_rules' && method === 'POST') return ['OWNER', 'ADMIN'];
  if (route === '/dashboard/risk_rules/:id' && method === 'DELETE') return ['OWNER', 'ADMIN'];
  if (route === '/dashboard/webhook_deliveries/:id/retry' && method === 'POST') return ['OWNER', 'ADMIN', 'DEVELOPER'];
  if (route === '/dashboard/webhook_endpoints/:id/state' && method === 'POST') return ['OWNER', 'ADMIN', 'DEVELOPER'];
  if (route === '/dashboard/webhook_endpoints/:id/rotate_secret' && method === 'POST') return ['OWNER', 'ADMIN', 'DEVELOPER'];

  if (route.startsWith('/v1/') || route.startsWith('/dashboard/')) return ['OWNER', 'ADMIN'];
  return null;
}

function deny(reply: FastifyReply, role: string, route: string) {
  return reply.code(403).send({
    error: {
      type: 'permission_error',
      code: 'insufficient_role',
      message: `${role} access is not permitted to perform this action on ${route}.`,
    },
  });
}

function allowedBrowserOrigin(request: FastifyRequest) {
  const origin = request.headers.origin;
  if (!origin) return process.env.NODE_ENV === 'test';
  const allowed = (process.env.DASHBOARD_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

function denyOrigin(reply: FastifyReply) {
  return reply.code(403).send({
    error: {
      type: 'permission_error',
      code: 'invalid_origin',
      message: 'This session-authenticated write request did not originate from an allowed merchant dashboard origin.',
    },
  });
}

export function registerRbac(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    const route = request.routeOptions.url ?? request.url.split('?', 1)[0];
    const required = allowedRoles(request.method, route);
    if (!required) return;

    const role = await sessionRole(request);
    if (!role) return;
    if (!allowedBrowserOrigin(request)) return denyOrigin(reply);
    if (!required.includes(role)) return deny(reply, role, route);
  });
}
