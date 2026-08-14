import { afterEach, describe, expect, it } from 'vitest';
import { decryptWebhookSecret, encryptWebhookSecret, prisma } from './index';

const previousKey = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;

afterEach(() => {
  if (previousKey === undefined) delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  else process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = previousKey;
});

describe('webhook signing secret encryption', () => {
  it('round-trips AES-256-GCM ciphertext without exposing plaintext', () => {
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    const plaintext = 'whsec_test_unit_only';
    const encrypted = encryptWebhookSecret(plaintext);

    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptWebhookSecret(encrypted)).toBe(plaintext);
  });

  it('preserves Prisma Date values while storing webhook secrets encrypted', async () => {
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    const merchant = await prisma.merchant.create({ data: { name: `Encryption Test ${Date.now()}` } });
    try {
      const plaintext = 'whsec_test_database_roundtrip';
      const endpoint = await prisma.webhookEndpoint.create({
        data: { merchantId: merchant.id, url: 'https://8.8.8.8/encryption-test', secret: plaintext },
      });

      expect(endpoint.createdAt).toBeInstanceOf(Date);
      expect(endpoint.updatedAt).toBeInstanceOf(Date);
      expect(endpoint.secret).toBe(plaintext);

      const raw = await prisma.$queryRaw<Array<{ secret: string; createdAt: Date }>>`
        SELECT "secret", "createdAt" FROM "WebhookEndpoint" WHERE "id" = ${endpoint.id}
      `;
      expect(raw[0]?.secret).toMatch(/^enc:v1:/);
      expect(raw[0]?.secret).not.toContain(plaintext);
      expect(raw[0]?.createdAt).toBeInstanceOf(Date);
    } finally {
      await prisma.merchant.delete({ where: { id: merchant.id } }).catch(() => undefined);
    }
  });

  it('keeps local sandbox values plaintext when no encryption key is configured', () => {
    delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    expect(encryptWebhookSecret('whsec_test_local')).toBe('whsec_test_local');
  });

  it('rejects invalid encryption-key length', () => {
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = Buffer.alloc(16, 3).toString('base64');
    expect(() => encryptWebhookSecret('whsec_test_invalid_key')).toThrow(/32-byte key/);
  });
});
