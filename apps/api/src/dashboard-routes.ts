import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma, prisma } from '@retaillink/database';
import { z } from 'zod';

const SESSION_COOKIE = 'rt_session';
const SESSION_DAYS = 7;
const settingsSchema = z.object({ name: z.string().trim().min(2).max(120) });
const customerSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().email().max(255).optional(),
  phone: z.string().trim().min(5).max(40).optional(),
  metadata: z.record(z.string(), z.json()).optional(),
}).refine((value) => value.name || value.email || value.phone, { message: 'Provide at least a name, email or phone number.' });
const customerUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).nullable().optional(),
  email: z.string().email().max(255).nullable().optional(),
  phone: z.string().trim().min(5).max(40).nullable().optional(),
  metadata: z.record(z.string(), z.json()).nullable().optional(),
});
const inviteSchema = z.object({
  email: z.string().email().max(255),
  role: z.enum(['ADMIN', 'DEVELOPER', 'FINANCE', 'VIEWER']).default('VIEWER'),
});
const acceptInviteSchema = z.object({ token: z.string().min(20), password: z.string().min(8).max(128) });
const riskRuleSchema = z.object({
  name: z.string().trim().min(2).max(100),
  type: z.enum(['AMOUNT_GTE', 'REFERENCE_CONTAINS']),
  action: z.enum(['BLOCK', 'REVIEW']).default('BLOCK'),
  threshold: z.number().int().positive().optional(),
  text_value: z.string().trim().min(1).max(120).optional(),
  currency: z.string().length(3).optional(),
}).superRefine((value, ctx) => {
  if (value.type === 'AMOUNT_GTE' && value.threshold === undefined) ctx.addIssue({ code: 'custom', message: 'threshold is required for AMOUNT_GTE rules.' });
  if (value.type === 'REFERENCE_CONTAINS' && !value.text_value) ctx.addIssue({ code: 'custom', message: 'text_value is required for REFERENCE_CONTAINS rules.' });
});

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
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

function sessionExpiry() {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}

function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

async function createSession(userId: string, merchantId: string) {
  const token = `sess_${randomBytes(32).toString('hex')}`;
  await prisma.session.create({ data: { tokenHash: hashToken(token), userId, merchantId, expiresAt: sessionExpiry() } });
  return token;
}

async function getDashboardSession(request: FastifyRequest) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true, merchant: true },
  });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  const membership = await prisma.merchantUser.findUnique({
    where: { userId_merchantId: { userId: session.userId, merchantId: session.merchantId } },
  });
  if (!membership) return null;
  return { session, membership };
}

async function getMerchantAuth(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer sk_test_')) {
    const key = await prisma.apiKey.findUnique({ where: { keyHash: hashToken(authorization.slice('Bearer '.length)) } });
    if (key && !key.revokedAt && key.environment === 'TEST') {
      await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
      return { merchantId: key.merchantId, userId: null as string | null, source: 'api_key' as const };
    }
  }
  const session = await getDashboardSession(request);
  if (!session) return null;
  return { merchantId: session.session.merchantId, userId: session.session.userId, source: 'session' as const };
}

async function audit(input: {
  merchantId: string;
  userId: string | null;
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: unknown;
  ipAddress?: string;
}) {
  await prisma.auditLog.create({
    data: {
      merchantId: input.merchantId,
      userId: input.userId ?? undefined,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
      ipAddress: input.ipAddress,
    },
  });
}

async function apiLog(request: FastifyRequest, merchantId: string, source: string, status: number, startedAt: number) {
  await prisma.apiRequestLog.create({
    data: {
      merchantId,
      requestId: request.id,
      method: request.method,
      path: request.routeOptions.url ?? request.url,
      status,
      source,
      durationMs: Math.max(0, Date.now() - startedAt),
    },
  }).catch(() => undefined);
}

function serializeSettlement(row: { id: string; amount: bigint; currency: string; status: string; periodFrom: Date; periodTo: Date; createdAt: Date }) {
  return { id: row.id, amount: row.amount.toString(), currency: row.currency, status: row.status.toLowerCase(), period_from: row.periodFrom.toISOString(), period_to: row.periodTo.toISOString(), created_at: row.createdAt.toISOString() };
}

function serializeCustomer(row: { id: string; name: string | null; email: string | null; phone: string | null; metadata: unknown; createdAt: Date; updatedAt: Date }) {
  return { id: row.id, object: 'customer', name: row.name, email: row.email, phone: row.phone, metadata: row.metadata, created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(), livemode: false };
}

export function registerDashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard/settings', async (request, reply) => {
    const auth = await getDashboardSession(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    return { merchant: { id: auth.session.merchant.id, name: auth.session.merchant.name, country: auth.session.merchant.country, currency: auth.session.merchant.defaultCurrency }, role: auth.membership.role };
  });

  app.post('/dashboard/settings', async (request, reply) => {
    const auth = await getDashboardSession(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    if (auth.membership.role !== 'OWNER') return reply.code(403).send({ error: { type: 'permission_error', message: 'Only the merchant owner can change business settings.' } });
    const parsed = settingsSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'Invalid business settings.', details: parsed.error.flatten() } });
    const merchant = await prisma.merchant.update({ where: { id: auth.session.merchantId }, data: { name: parsed.data.name } });
    await audit({ merchantId: merchant.id, userId: auth.session.userId, action: 'merchant.updated', resource: 'merchant', resourceId: merchant.id, metadata: { name: merchant.name }, ipAddress: request.ip });
    return { merchant: { id: merchant.id, name: merchant.name, country: merchant.country, currency: merchant.defaultCurrency } };
  });

  app.get('/dashboard/settlements', async (request, reply) => {
    const auth = await getDashboardSession(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    const rows = await prisma.settlement.findMany({ where: { merchantId: auth.session.merchantId }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { data: rows.map(serializeSettlement) };
  });

  app.post('/dashboard/settlements', async (request, reply) => {
    const auth = await getDashboardSession(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    if (auth.membership.role !== 'OWNER') return reply.code(403).send({ error: { type: 'permission_error', message: 'Only the merchant owner can run a settlement.' } });
    const now = new Date();
    const merchantId = auth.session.merchantId;
    const currency = auth.session.merchant.defaultCurrency;
    const settlement = await prisma.$transaction(async (tx) => {
      const merchantAccount = await tx.ledgerAccount.upsert({ where: { merchantId_code_currency: { merchantId, code: 'MERCHANT_PAYABLE', currency } }, update: {}, create: { merchantId, code: 'MERCHANT_PAYABLE', name: 'Merchant payable', currency } });
      const processorAccount = await tx.ledgerAccount.upsert({ where: { merchantId_code_currency: { merchantId, code: 'PROCESSOR_CLEARING', currency } }, update: {}, create: { merchantId, code: 'PROCESSOR_CLEARING', name: 'Processor clearing', currency } });
      const entries = await tx.ledgerEntry.findMany({ where: { accountId: merchantAccount.id } });
      const available = entries.reduce((sum, entry) => sum + (entry.direction === 'CREDIT' ? entry.amount : -entry.amount), 0n);
      if (available <= 0n) return null;
      const previous = await tx.settlement.findFirst({ where: { merchantId }, orderBy: { periodTo: 'desc' } });
      const row = await tx.settlement.create({ data: { merchantId, amount: available, currency, status: 'PAID', periodFrom: previous?.periodTo ?? auth.session.merchant.createdAt, periodTo: now } });
      const transactionId = `txn_${randomUUID()}`;
      await tx.ledgerEntry.createMany({ data: [
        { transactionId, accountId: merchantAccount.id, direction: 'DEBIT', amount: available, currency, referenceType: 'settlement', referenceId: row.id },
        { transactionId, accountId: processorAccount.id, direction: 'CREDIT', amount: available, currency, referenceType: 'settlement', referenceId: row.id },
      ] });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!settlement) return reply.code(409).send({ error: { type: 'invalid_state', message: 'There is no available balance to settle.' } });
    await audit({ merchantId, userId: auth.session.userId, action: 'settlement.paid', resource: 'settlement', resourceId: settlement.id, metadata: { amount: settlement.amount.toString(), currency: settlement.currency }, ipAddress: request.ip });
    return reply.code(201).send({ settlement: serializeSettlement(settlement) });
  });

  app.get('/v1/customers', async (request, reply) => {
    const startedAt = Date.now();
    const auth = await getMerchantAuth(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'A valid test API key or merchant session is required.' } });
    const rows = await prisma.customer.findMany({ where: { merchantId: auth.merchantId }, orderBy: { createdAt: 'desc' }, take: 100 });
    await apiLog(request, auth.merchantId, auth.source, 200, startedAt);
    return { object: 'list', data: rows.map(serializeCustomer) };
  });

  app.post('/v1/customers', async (request, reply) => {
    const startedAt = Date.now();
    const auth = await getMerchantAuth(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'A valid test API key or merchant session is required.' } });
    const parsed = customerSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'Invalid customer.', details: parsed.error.flatten() } });
    try {
      const row = await prisma.customer.create({ data: { merchantId: auth.merchantId, name: parsed.data.name, email: parsed.data.email?.toLowerCase(), phone: parsed.data.phone, metadata: parsed.data.metadata as Prisma.InputJsonValue | undefined } });
      if (auth.source === 'session') await audit({ merchantId: auth.merchantId, userId: auth.userId, action: 'customer.created', resource: 'customer', resourceId: row.id, ipAddress: request.ip });
      await apiLog(request, auth.merchantId, auth.source, 201, startedAt);
      return reply.code(201).send(serializeCustomer(row));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return reply.code(409).send({ error: { type: 'conflict', message: 'A customer with this email already exists.' } });
      throw error;
    }
  });

  app.get('/v1/customers/:id', async (request, reply) => {
    const startedAt = Date.now();
    const auth = await getMerchantAuth(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'A valid test API key or merchant session is required.' } });
    const { id } = request.params as { id: string };
    const row = await prisma.customer.findFirst({ where: { id, merchantId: auth.merchantId } });
    if (!row) return reply.code(404).send({ error: { type: 'not_found', message: 'No such customer.' } });
    await apiLog(request, auth.merchantId, auth.source, 200, startedAt);
    return serializeCustomer(row);
  });

  app.post('/v1/customers/:id', async (request, reply) => {
    const startedAt = Date.now();
    const auth = await getMerchantAuth(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'A valid test API key or merchant session is required.' } });
    const parsed = customerUpdateSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'Invalid customer update.', details: parsed.error.flatten() } });
    const { id } = request.params as { id: string };
    const existing = await prisma.customer.findFirst({ where: { id, merchantId: auth.merchantId } });
    if (!existing) return reply.code(404).send({ error: { type: 'not_found', message: 'No such customer.' } });
    try {
      const row = await prisma.customer.update({ where: { id }, data: { name: parsed.data.name, email: parsed.data.email?.toLowerCase() ?? parsed.data.email, phone: parsed.data.phone, metadata: parsed.data.metadata as Prisma.InputJsonValue | Prisma.JsonNullValueInput | undefined } });
      if (auth.source === 'session') await audit({ merchantId: auth.merchantId, userId: auth.userId, action: 'customer.updated', resource: 'customer', resourceId: id, ipAddress: request.ip });
      await apiLog(request, auth.merchantId, auth.source, 200, startedAt);
      return serializeCustomer(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return reply.code(409).send({ error: { type: 'conflict', message: 'A customer with this email already exists.' } });
      throw error;
    }
  });

  app.delete('/v1/customers/:id', async (request, reply) => {
    const startedAt = Date.now();
    const auth = await getMerchantAuth(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'A valid test API key or merchant session is required.' } });
    const { id } = request.params as { id: string };
    const existing = await prisma.customer.findFirst({ where: { id, merchantId: auth.merchantId } });
    if (!existing) return reply.code(404).send({ error: { type: 'not_found', message: 'No such customer.' } });
    await prisma.customer.delete({ where: { id } });
    if (auth.source === 'session') await audit({ merchantId: auth.merchantId, userId: auth.userId, action: 'customer.deleted', resource: 'customer', resourceId: id, ipAddress: request.ip });
    await apiLog(request, auth.merchantId, auth.source, 200, startedAt);
    return { ok: true };
  });

  app.get('/dashboard/team', async (request, reply) => {
    const auth = await getDashboardSession(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    const [members, invites] = await Promise.all([
      prisma.merchantUser.findMany({ where: { merchantId: auth.session.merchantId }, include: { user: { select: { id: true, email: true } } }, orderBy: { createdAt: 'asc' } }),
      prisma.teamInvite.findMany({ where: { merchantId: auth.session.merchantId, acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } }),
    ]);
    return { members: members.map((row) => ({ id: row.id, user_id: row.userId, email: row.user.email, role: row.role, created_at: row.createdAt.toISOString() })), invites: invites.map((row) => ({ id: row.id, email: row.email, role: row.role, expires_at: row.expiresAt.toISOString(), created_at: row.createdAt.toISOString() })) };
  });

  app.post('/dashboard/team/invites', async (request, reply) => {
    const auth = await getDashboardSession(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    if (auth.membership.role !== 'OWNER') return reply.code(403).send({ error: { type: 'permission_error', message: 'Only the merchant owner can invite team members.' } });
    const parsed = inviteSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'Invalid invitation.', details: parsed.error.flatten() } });
    const email = parsed.data.email.toLowerCase();
    const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser) {
      const membership = await prisma.merchantUser.findUnique({ where: { userId_merchantId: { userId: existingUser.id, merchantId: auth.session.merchantId } } });
      if (membership) return reply.code(409).send({ error: { type: 'conflict', message: 'This user is already a member of the merchant account.' } });
    }
    await prisma.teamInvite.updateMany({ where: { merchantId: auth.session.merchantId, email, acceptedAt: null }, data: { expiresAt: new Date() } });
    const rawToken = `invite_test_${randomBytes(24).toString('hex')}`;
    const invite = await prisma.teamInvite.create({ data: { merchantId: auth.session.merchantId, invitedByUserId: auth.session.userId, email, role: parsed.data.role, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
    await audit({ merchantId: auth.session.merchantId, userId: auth.session.userId, action: 'team_invite.created', resource: 'team_invite', resourceId: invite.id, metadata: { email, role: invite.role }, ipAddress: request.ip });
    const dashboardOrigin = process.env.DASHBOARD_ORIGIN ?? 'http://localhost:3000';
    return reply.code(201).send({ id: invite.id, email, role: invite.role, invite_token: rawToken, invite_url: `${dashboardOrigin}/?invite=${encodeURIComponent(rawToken)}`, expires_at: invite.expiresAt.toISOString() });
  });

  app.delete('/dashboard/team/members/:id', async (request, reply) => {
    const auth = await getDashboardSession(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    if (auth.membership.role !== 'OWNER') return reply.code(403).send({ error: { type: 'permission_error', message: 'Only the merchant owner can remove team members.' } });
    const { id } = request.params as { id: string };
    const member = await prisma.merchantUser.findFirst({ where: { id, merchantId: auth.session.merchantId }, include: { user: true } });
    if (!member) return reply.code(404).send({ error: { type: 'not_found', message: 'No such team member.' } });
    if (member.userId === auth.session.userId || member.role === 'OWNER') return reply.code(409).send({ error: { type: 'invalid_state', message: 'The owner membership cannot be removed here.' } });
    await prisma.$transaction([prisma.session.deleteMany({ where: { merchantId: auth.session.merchantId, userId: member.userId } }), prisma.merchantUser.delete({ where: { id } })]);
    await audit({ merchantId: auth.session.merchantId, userId: auth.session.userId, action: 'team_member.removed', resource: 'merchant_user', resourceId: id, metadata: { email: member.user.email }, ipAddress: request.ip });
    return { ok: true };
  });

  app.post('/auth/invitations/accept', async (request, reply) => {
    const parsed = acceptInviteSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'Invalid invitation acceptance.', details: parsed.error.flatten() } });
    const invite = await prisma.teamInvite.findUnique({ where: { tokenHash: hashToken(parsed.data.token) }, include: { merchant: true } });
    if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) return reply.code(404).send({ error: { type: 'not_found', message: 'This invitation is invalid or has expired.' } });
    const existingUser = await prisma.user.findUnique({ where: { email: invite.email } });
    if (existingUser && !verifyPassword(parsed.data.password, existingUser.passwordHash)) return reply.code(401).send({ error: { type: 'authentication_error', message: 'The password for this existing account is incorrect.' } });
    const result = await prisma.$transaction(async (tx) => {
      const acceptedUser = existingUser ?? await tx.user.create({ data: { email: invite.email, passwordHash: hashPassword(parsed.data.password) } });
      const membership = await tx.merchantUser.upsert({ where: { userId_merchantId: { userId: acceptedUser.id, merchantId: invite.merchantId } }, update: { role: invite.role }, create: { userId: acceptedUser.id, merchantId: invite.merchantId, role: invite.role } });
      await tx.teamInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
      return { membership, user: acceptedUser };
    });
    const token = await createSession(result.user.id, invite.merchantId);
    setSessionCookie(reply, token);
    await audit({ merchantId: invite.merchantId, userId: result.user.id, action: 'team_invite.accepted', resource: 'merchant_user', resourceId: result.membership.id, ipAddress: request.ip });
    return { user: { id: result.user.id, email: result.user.email }, merchant: { id: invite.merchant.id, name: invite.merchant.name, country: invite.merchant.country, currency: invite.merchant.defaultCurrency }, role: result.membership.role };
  });

  app.get('/dashboard/risk_rules', async (request, reply) => {
    const auth = await getDashboardSession(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    const rows = await prisma.riskRule.findMany({ where: { merchantId: auth.session.merchantId }, orderBy: { createdAt: 'desc' } });
    return { data: rows.map((row) => ({ id: row.id, name: row.name, type: row.type.toLowerCase(), action: row.action.toLowerCase(), threshold: row.threshold?.toString() ?? null, text_value: row.textValue, currency: row.currency, enabled: row.enabled, created_at: row.createdAt.toISOString() })) };
  });

  app.post('/dashboard/risk_rules', async (request, reply) => {
    const auth = await getDashboardSession(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    if (!['OWNER', 'ADMIN'].includes(auth.membership.role)) return reply.code(403).send({ error: { type: 'permission_error', message: 'Owner or admin access is required.' } });
    const parsed = riskRuleSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'Invalid risk rule.', details: parsed.error.flatten() } });
    const row = await prisma.riskRule.create({ data: { merchantId: auth.session.merchantId, name: parsed.data.name, type: parsed.data.type, action: parsed.data.action, threshold: parsed.data.threshold === undefined ? undefined : BigInt(parsed.data.threshold), textValue: parsed.data.text_value, currency: parsed.data.currency?.toUpperCase() } });
    await audit({ merchantId: auth.session.merchantId, userId: auth.session.userId, action: 'risk_rule.created', resource: 'risk_rule', resourceId: row.id, ipAddress: request.ip });
    return reply.code(201).send({ id: row.id, name: row.name, type: row.type.toLowerCase(), action: row.action.toLowerCase(), threshold: row.threshold?.toString() ?? null, text_value: row.textValue, currency: row.currency, enabled: row.enabled });
  });

  app.delete('/dashboard/risk_rules/:id', async (request, reply) => {
    const auth = await getDashboardSession(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    if (!['OWNER', 'ADMIN'].includes(auth.membership.role)) return reply.code(403).send({ error: { type: 'permission_error', message: 'Owner or admin access is required.' } });
    const { id } = request.params as { id: string };
    const row = await prisma.riskRule.findFirst({ where: { id, merchantId: auth.session.merchantId } });
    if (!row) return reply.code(404).send({ error: { type: 'not_found', message: 'No such risk rule.' } });
    await prisma.riskRule.delete({ where: { id } });
    await audit({ merchantId: auth.session.merchantId, userId: auth.session.userId, action: 'risk_rule.deleted', resource: 'risk_rule', resourceId: id, ipAddress: request.ip });
    return { ok: true };
  });

  app.get('/dashboard/risk_events', async (request, reply) => {
    const auth = await getDashboardSession(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    const rows = await prisma.riskEvent.findMany({ where: { merchantId: auth.session.merchantId }, include: { rule: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { data: rows.map((row) => ({ id: row.id, rule_name: row.rule?.name ?? null, outcome: row.outcome.toLowerCase(), reason: row.reason, amount: row.amount.toString(), currency: row.currency, merchant_reference: row.merchantReference, created_at: row.createdAt.toISOString() })) };
  });

  app.get('/dashboard/api_logs', async (request, reply) => {
    const auth = await getDashboardSession(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    const rows = await prisma.apiRequestLog.findMany({ where: { merchantId: auth.session.merchantId }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { data: rows.map((row) => ({ id: row.id, request_id: row.requestId, method: row.method, path: row.path, status: row.status, source: row.source, duration_ms: row.durationMs, created_at: row.createdAt.toISOString() })) };
  });
}
