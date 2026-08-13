import { createHash, createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma, prisma } from '@retaillink/database';

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function dashboardSession(request: FastifyRequest) {
  const token = request.cookies.rt_session;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session || session.expiresAt <= new Date()) return null;
  const membership = await prisma.merchantUser.findUnique({
    where: { userId_merchantId: { userId: session.userId, merchantId: session.merchantId } },
  });
  if (!membership) return null;
  return { session, membership };
}

function ipv4Private(address: string) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = octets;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224;
}

function ipv6Private(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::' || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    if (isIP(mapped) === 4) return ipv4Private(mapped);
  }
  return false;
}

function privateAddress(address: string) {
  const version = isIP(address);
  if (version === 4) return ipv4Private(address);
  if (version === 6) return ipv6Private(address);
  return true;
}

async function assertSafeWebhookTarget(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Webhook URL is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Webhook URL must use HTTP or HTTPS.');
  if (url.username || url.password) throw new Error('Webhook URL must not contain credentials.');
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) throw new Error('Local webhook destinations are not allowed.');

  if (isIP(hostname)) {
    if (privateAddress(hostname)) throw new Error('Private or reserved webhook destinations are not allowed.');
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((result) => privateAddress(result.address))) throw new Error('Webhook hostname resolves to a private or reserved address.');
}

function payloadBody(payload: Prisma.JsonValue) {
  return JSON.stringify(payload);
}

export function registerWebhookRetry(app: FastifyInstance) {
  app.post('/dashboard/webhook_deliveries/:id/retry', async (request, reply) => {
    const auth = await dashboardSession(request);
    if (!auth) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    if (!['OWNER', 'ADMIN', 'DEVELOPER'].includes(auth.membership.role)) {
      return reply.code(403).send({ error: { type: 'permission_error', message: 'Developer, admin or owner access is required to retry webhooks.' } });
    }

    const { id } = request.params as { id: string };
    const delivery = await prisma.webhookDelivery.findFirst({
      where: { id, endpoint: { merchantId: auth.session.merchantId } },
      include: { endpoint: true },
    });
    if (!delivery) return reply.code(404).send({ error: { type: 'not_found', message: 'No such webhook delivery.' } });
    if (!delivery.endpoint.enabled) return reply.code(409).send({ error: { type: 'invalid_state', message: 'The webhook endpoint is disabled.' } });

    const nextAttempt = delivery.attempts + 1;
    try {
      await assertSafeWebhookTarget(delivery.endpoint.url);
      const body = payloadBody(delivery.payload);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = createHmac('sha256', delivery.endpoint.secret).update(`${timestamp}.${body}`).digest('hex');
      const response = await fetch(delivery.endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-retaillink-signature': `t=${timestamp},v1=${signature}`,
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const updated = await prisma.webhookDelivery.update({
        where: { id },
        data: { attempts: nextAttempt, status: 'DELIVERED', deliveredAt: new Date(), lastError: null },
      });
      await prisma.auditLog.create({
        data: {
          merchantId: auth.session.merchantId,
          userId: auth.session.userId,
          action: 'webhook_delivery.retried',
          resource: 'webhook_delivery',
          resourceId: id,
          metadata: { result: 'delivered', attempt: nextAttempt },
          ipAddress: request.ip,
        },
      });
      return { id: updated.id, status: updated.status.toLowerCase(), attempts: updated.attempts, delivered_at: updated.deliveredAt?.toISOString() ?? null, last_error: updated.lastError };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Webhook retry failed.';
      const updated = await prisma.webhookDelivery.update({
        where: { id },
        data: { attempts: nextAttempt, status: 'FAILED', lastError: message },
      });
      await prisma.auditLog.create({
        data: {
          merchantId: auth.session.merchantId,
          userId: auth.session.userId,
          action: 'webhook_delivery.retried',
          resource: 'webhook_delivery',
          resourceId: id,
          metadata: { result: 'failed', attempt: nextAttempt, error: message },
          ipAddress: request.ip,
        },
      });
      return reply.code(502).send({
        error: { type: 'webhook_delivery_error', message },
        delivery: { id: updated.id, status: updated.status.toLowerCase(), attempts: updated.attempts, last_error: updated.lastError },
      });
    }
  });
}
