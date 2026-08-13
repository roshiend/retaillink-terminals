import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@retaillink/database';

const started = new WeakMap<FastifyRequest, number>();

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function resolveMerchant(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer sk_test_')) {
    const key = await prisma.apiKey.findUnique({
      where: { keyHash: hashToken(authorization.slice('Bearer '.length)) },
      select: { merchantId: true, revokedAt: true, environment: true },
    });
    if (key && !key.revokedAt && key.environment === 'TEST') return { merchantId: key.merchantId, source: 'api_key' };
  }

  const token = request.cookies.rt_session;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { merchantId: true, expiresAt: true },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  return { merchantId: session.merchantId, source: 'session' };
}

function publicApiPath(request: FastifyRequest) {
  const path = request.routeOptions.url ?? request.url.split('?', 1)[0];
  return path.startsWith('/v1/') ? path : null;
}

export function registerApiObservability(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    if (publicApiPath(request)) started.set(request, Date.now());
  });

  // Persist before Fastify completes the response so a merchant can immediately
  // query API Logs after an API call and deterministically see that request.
  app.addHook('onSend', async (request, reply, payload) => {
    const path = publicApiPath(request);
    if (!path || path.startsWith('/v1/customers')) return payload;

    const auth = await resolveMerchant(request);
    if (!auth) return payload;

    await prisma.apiRequestLog.create({
      data: {
        merchantId: auth.merchantId,
        requestId: request.id,
        method: request.method,
        path,
        status: reply.statusCode,
        source: auth.source,
        durationMs: Math.max(0, Date.now() - (started.get(request) ?? Date.now())),
      },
    }).catch((error) => request.log.warn({ err: error }, 'Unable to persist API request log'));

    return payload;
  });
}
