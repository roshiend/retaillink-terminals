import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const ENCRYPTED_PREFIX = 'enc:v1:';

function webhookEncryptionKey() {
  const raw = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return key;
}

export function encryptWebhookSecret(value: string) {
  if (value.startsWith(ENCRYPTED_PREFIX)) return value;
  const key = webhookEncryptionKey();
  if (!key) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptWebhookSecret(value: string) {
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value;
  const key = webhookEncryptionKey();
  if (!key) throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEY is required to decrypt stored webhook secrets.');
  const [ivRaw, tagRaw, ciphertextRaw] = value.slice(ENCRYPTED_PREFIX.length).split(':');
  if (!ivRaw || !tagRaw || !ciphertextRaw) throw new Error('Stored webhook secret is malformed.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextRaw, 'base64')), decipher.final()]).toString('utf8');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function encryptSecretFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(encryptSecretFields);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    key === 'secret' && typeof entry === 'string' ? encryptWebhookSecret(entry) : encryptSecretFields(entry),
  ]));
}

function decryptSecretFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decryptSecretFields);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    key === 'secret' && typeof entry === 'string' ? decryptWebhookSecret(entry) : decryptSecretFields(entry),
  ]));
}

function createPrismaClient() {
  const base = new PrismaClient();
  return base.$extends({
    name: 'retaillink-webhook-secret-encryption',
    query: {
      $allModels: {
        async $allOperations({ model, args, query }) {
          const safeArgs = model === 'WebhookEndpoint' ? encryptSecretFields(args) : args;
          const result = await query(safeArgs as typeof args);
          return decryptSecretFields(result) as typeof result;
        },
      },
    },
  });
}

type RetaillinkPrismaClient = ReturnType<typeof createPrismaClient>;

declare global {
  // eslint-disable-next-line no-var
  var retaillinkPrisma: RetaillinkPrismaClient | undefined;
}

export const prisma = globalThis.retaillinkPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.retaillinkPrisma = prisma;
}

export * from '@prisma/client';
