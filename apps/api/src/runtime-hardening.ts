import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@retaillink/database';

const windows = new Map<string, { count: number; resetAt: number }>();

function numberEnv(name: string, fallback: number, minimum = 1) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= minimum ? Math.floor(value) : fallback;
}

function clientAddress(request: FastifyRequest) {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = request.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',', 1)[0];
    if (first?.trim()) return first.trim();
  }
  return request.ip;
}

function rateBucket(request: FastifyRequest) {
  const route = request.routeOptions.url ?? request.url.split('?', 1)[0];
  if (route.startsWith('/auth/')) return 'auth';
  if (route.startsWith('/public/')) return 'public';
  return 'api';
}

export function validateRuntimeConfig() {
  if (process.env.NODE_ENV !== 'production') return;

  const problems: string[] = [];
  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL is required');

  const checkout = process.env.CHECKOUT_BASE_URL;
  if (!checkout || !checkout.startsWith('https://')) problems.push('CHECKOUT_BASE_URL must be an https:// URL');

  const origins = (process.env.DASHBOARD_ORIGIN ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!origins.length || origins.some((origin) => !origin.startsWith('https://'))) {
    problems.push('DASHBOARD_ORIGIN must contain one or more https:// origins');
  }

  if (process.env.REQUIRE_IDEMPOTENCY_KEYS !== 'true') {
    problems.push('REQUIRE_IDEMPOTENCY_KEYS=true is required in production');
  }

  if (problems.length) throw new Error(`Invalid production configuration: ${problems.join('; ')}`);
}

export function registerRuntimeHardening(app: FastifyInstance) {
  app.get('/ready', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', database: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'not_ready', database: 'unavailable' });
    }
  });

  app.addHook('onRequest', async (request, reply) => {
    const maxBodyBytes = numberEnv('MAX_BODY_BYTES', 1_048_576);
    const contentLength = Number(request.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      return reply.code(413).send({
        error: { type: 'invalid_request_error', code: 'payload_too_large', message: `Request body exceeds the ${maxBodyBytes}-byte limit.` },
      });
    }

    const enabled = process.env.ENABLE_RATE_LIMIT === 'true' || process.env.NODE_ENV === 'production';
    const route = request.routeOptions.url ?? request.url.split('?', 1)[0];
    if (!enabled || route === '/health' || route === '/ready') return;

    const windowMs = numberEnv('RATE_LIMIT_WINDOW_MS', 60_000, 1000);
    const bucket = rateBucket(request);
    const max = bucket === 'auth'
      ? numberEnv('RATE_LIMIT_AUTH_MAX', 30)
      : bucket === 'public'
        ? numberEnv('RATE_LIMIT_PUBLIC_MAX', 120)
        : numberEnv('RATE_LIMIT_API_MAX', 300);
    const now = Date.now();
    const key = `${bucket}:${clientAddress(request)}`;
    const current = windows.get(key);
    const state = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
    state.count += 1;
    windows.set(key, state);

    reply.header('X-RateLimit-Limit', String(max));
    reply.header('X-RateLimit-Remaining', String(Math.max(0, max - state.count)));
    reply.header('X-RateLimit-Reset', String(Math.ceil(state.resetAt / 1000)));

    if (state.count > max) {
      reply.header('Retry-After', String(Math.max(1, Math.ceil((state.resetAt - now) / 1000))));
      return reply.code(429).send({
        error: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'Too many requests. Retry after the current rate-limit window.' },
      });
    }

    if (windows.size > 10_000) {
      for (const [entryKey, entry] of windows) if (entry.resetAt <= now) windows.delete(entryKey);
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    reply.header('Cache-Control', 'no-store');
    if (process.env.NODE_ENV === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    if (!reply.hasHeader('X-Request-Id')) reply.header('X-Request-Id', request.id);
    return payload;
  });
}
