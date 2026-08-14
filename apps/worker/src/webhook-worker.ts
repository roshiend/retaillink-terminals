import { createHmac, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { prisma, type Prisma } from '@retaillink/database';

const PROCESSING_PREFIX = 'worker:processing:';

function numberEnv(name: string, fallback: number, minimum = 1) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= minimum ? Math.floor(value) : fallback;
}

function ipv4Private(address: string) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || a >= 224;
}

function ipv6Private(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::' || /^fe[89ab]/.test(normalized)) return true;
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
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Webhook URL must use HTTP or HTTPS.');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Production webhook URLs must use HTTPS.');
  if (url.username || url.password) throw new Error('Webhook URL must not contain credentials.');
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) throw new Error('Local webhook destinations are not allowed.');
  if (isIP(hostname)) {
    if (privateAddress(hostname)) throw new Error('Private or reserved webhook destinations are not allowed.');
    return;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((result) => privateAddress(result.address))) {
    throw new Error('Webhook hostname resolves to a private or reserved address.');
  }
}

function payloadBody(payload: Prisma.JsonValue) {
  return JSON.stringify(payload);
}

function markerTimestamp(lastError: string | null) {
  if (!lastError?.startsWith(PROCESSING_PREFIX)) return null;
  const value = Number(lastError.slice(PROCESSING_PREFIX.length).split(':', 1)[0]);
  return Number.isFinite(value) ? value : null;
}

function retryDelayMs(attempts: number) {
  const base = numberEnv('WEBHOOK_RETRY_BASE_MS', 30_000, 1000);
  const maximum = numberEnv('WEBHOOK_RETRY_MAX_MS', 30 * 60_000, base);
  return Math.min(maximum, base * (2 ** Math.max(0, attempts - 1)));
}

function deliveryIsDue(row: { attempts: number; updatedAt: Date; lastError: string | null }, now: number) {
  const marker = markerTimestamp(row.lastError);
  if (marker !== null) {
    const claimTtl = numberEnv('WEBHOOK_CLAIM_TTL_MS', 60_000, 5000);
    return marker + claimTtl <= now;
  }
  return row.updatedAt.getTime() + retryDelayMs(row.attempts) <= now;
}

export async function runWebhookBatch() {
  const maxAttempts = numberEnv('WEBHOOK_MAX_ATTEMPTS', 6);
  const batchSize = numberEnv('WEBHOOK_WORKER_BATCH_SIZE', 20);
  const now = Date.now();
  const candidates = await prisma.webhookDelivery.findMany({
    where: {
      status: { in: ['PENDING', 'FAILED'] },
      attempts: { lt: maxAttempts },
      endpoint: { enabled: true },
    },
    include: { endpoint: true },
    orderBy: { updatedAt: 'asc' },
    take: batchSize * 3,
  });

  let processed = 0;
  for (const row of candidates) {
    if (processed >= batchSize || !deliveryIsDue(row, now)) continue;
    const marker = `${PROCESSING_PREFIX}${Date.now()}:${randomUUID()}`;
    const claimed = await prisma.webhookDelivery.updateMany({
      where: { id: row.id, attempts: row.attempts, status: row.status, lastError: row.lastError },
      data: { attempts: { increment: 1 }, status: 'PENDING', lastError: marker },
    });
    if (claimed.count !== 1) continue;
    processed += 1;

    try {
      await assertSafeWebhookTarget(row.endpoint.url);
      const body = payloadBody(row.payload);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = createHmac('sha256', row.endpoint.secret).update(`${timestamp}.${body}`).digest('hex');
      const response = await fetch(row.endpoint.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-retaillink-signature': `t=${timestamp},v1=${signature}` },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(numberEnv('WEBHOOK_TIMEOUT_MS', 5000, 1000)),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await prisma.webhookDelivery.update({
        where: { id: row.id },
        data: { status: 'DELIVERED', deliveredAt: new Date(), lastError: null },
      });
    } catch (error) {
      await prisma.webhookDelivery.update({
        where: { id: row.id },
        data: { status: 'FAILED', deliveredAt: null, lastError: error instanceof Error ? error.message : 'Webhook delivery failed.' },
      });
    }
  }
  return processed;
}
