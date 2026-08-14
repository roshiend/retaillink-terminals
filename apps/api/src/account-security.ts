import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@retaillink/database';
import { z } from 'zod';

const SESSION_COOKIE = 'rt_session';
const passwordSchema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: z.string().min(12).max(128),
});

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

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

async function currentSession(request: FastifyRequest) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true, merchant: true },
  });
  if (!row || row.expiresAt <= new Date()) return null;
  return { row, tokenHash };
}

function allowedOrigin(request: FastifyRequest) {
  if (process.env.NODE_ENV === 'test') return true;
  const origin = request.headers.origin;
  if (!origin) return false;
  const allowed = (process.env.DASHBOARD_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

function invalidOrigin(reply: FastifyReply) {
  return reply.code(403).send({
    error: {
      type: 'permission_error',
      code: 'invalid_origin',
      message: 'This account-security request did not originate from an allowed dashboard origin.',
    },
  });
}

async function audit(session: { merchantId: string; userId: string }, action: string, resourceId: string | undefined, request: FastifyRequest) {
  await prisma.auditLog.create({
    data: {
      merchantId: session.merchantId,
      userId: session.userId,
      action,
      resource: 'account_security',
      resourceId,
      ipAddress: request.ip,
    },
  });
}

export function registerAccountSecurity(app: FastifyInstance) {
  app.get('/account/sessions', async (request, reply) => {
    const current = await currentSession(request);
    if (!current) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });

    const sessions = await prisma.session.findMany({
      where: { userId: current.row.userId, expiresAt: { gt: new Date() } },
      include: { merchant: { select: { id: true, name: true } } },
      orderBy: { lastSeenAt: 'desc' },
    });

    return {
      object: 'list',
      data: sessions.map((session) => ({
        id: session.id,
        merchant: { id: session.merchant.id, name: session.merchant.name },
        current: session.id === current.row.id,
        created_at: session.createdAt.toISOString(),
        last_seen_at: session.lastSeenAt.toISOString(),
        expires_at: session.expiresAt.toISOString(),
      })),
    };
  });

  app.delete('/account/sessions/:id', async (request, reply) => {
    if (!allowedOrigin(request)) return invalidOrigin(reply);
    const current = await currentSession(request);
    if (!current) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    const { id } = request.params as { id: string };
    const target = await prisma.session.findFirst({ where: { id, userId: current.row.userId } });
    if (!target) return reply.code(404).send({ error: { type: 'not_found', message: 'No such session.' } });

    await prisma.session.delete({ where: { id: target.id } });
    await audit(current.row, 'session.revoked', target.id, request);
    if (target.id === current.row.id) reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true, current_session_revoked: target.id === current.row.id };
  });

  app.post('/account/logout_all', async (request, reply) => {
    if (!allowedOrigin(request)) return invalidOrigin(reply);
    const current = await currentSession(request);
    if (!current) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    await audit(current.row, 'session.revoked_all', undefined, request);
    const result = await prisma.session.deleteMany({ where: { userId: current.row.userId } });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true, revoked: result.count };
  });

  app.post('/account/password', async (request, reply) => {
    if (!allowedOrigin(request)) return invalidOrigin(reply);
    const current = await currentSession(request);
    if (!current) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    const parsed = passwordSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'New password must be between 12 and 128 characters.', details: parsed.error.flatten() } });
    }
    if (!verifyPassword(parsed.data.current_password, current.row.user.passwordHash)) {
      return reply.code(401).send({ error: { type: 'authentication_error', code: 'incorrect_current_password', message: 'Current password is incorrect.' } });
    }
    if (parsed.data.current_password === parsed.data.new_password) {
      return reply.code(400).send({ error: { type: 'invalid_request_error', code: 'password_unchanged', message: 'Choose a different new password.' } });
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: current.row.userId }, data: { passwordHash: hashPassword(parsed.data.new_password) } });
      await tx.session.deleteMany({ where: { userId: current.row.userId, id: { not: current.row.id } } });
    });
    await audit(current.row, 'password.changed', current.row.userId, request);
    return { ok: true, other_sessions_revoked: true };
  });
}
