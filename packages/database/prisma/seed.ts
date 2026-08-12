import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

const envCandidates = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), 'packages/database/.env'),
];

for (const envPath of envCandidates) {
  if (existsSync(envPath)) config({ path: envPath, override: false });
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy packages/database/.env.example to packages/database/.env, then rerun pnpm db:seed.');
}

const prisma = new PrismaClient();

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const digest = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${digest}`;
}

async function main() {
  const merchant = await prisma.merchant.upsert({
    where: { id: 'demo_merchant' },
    update: {},
    create: { id: 'demo_merchant', name: 'Retaillink Demo Store', country: 'LK', defaultCurrency: 'LKR' },
  });

  const demoEmail = 'demo@retaillink.local';
  const demoPassword = 'Retaillink123!';
  const demoUser = await prisma.user.upsert({
    where: { email: demoEmail },
    update: { passwordHash: hashPassword(demoPassword) },
    create: { email: demoEmail, passwordHash: hashPassword(demoPassword) },
  });
  await prisma.merchantUser.upsert({
    where: { userId_merchantId: { userId: demoUser.id, merchantId: merchant.id } },
    update: { role: 'OWNER' },
    create: { userId: demoUser.id, merchantId: merchant.id, role: 'OWNER' },
  });

  const existingKey = await prisma.apiKey.findFirst({ where: { merchantId: merchant.id, name: 'Default sandbox key', revokedAt: null } });
  if (!existingKey) {
    const rawKey = `sk_test_${randomBytes(24).toString('hex')}`;
    await prisma.apiKey.create({
      data: { merchantId: merchant.id, environment: 'TEST', name: 'Default sandbox key', prefix: rawKey.slice(0, 16), keyHash: createHash('sha256').update(rawKey).digest('hex') },
    });
    console.log(`\nSecret key: ${rawKey}`);
    console.log('Save this key now. Only its hash is stored in the database.');
  }

  for (const account of [
    { code: 'PROCESSOR_CLEARING', name: 'Processor clearing' },
    { code: 'MERCHANT_PAYABLE', name: 'Merchant payable' },
    { code: 'FEE_REVENUE', name: 'Gateway fee revenue' },
  ]) {
    await prisma.ledgerAccount.upsert({
      where: { merchantId_code_currency: { merchantId: merchant.id, code: account.code, currency: 'LKR' } },
      update: {},
      create: { merchantId: merchant.id, code: account.code, name: account.name, currency: 'LKR' },
    });
  }

  console.log('\nSandbox dashboard login');
  console.log(`Email: ${demoEmail}`);
  console.log(`Password: ${demoPassword}`);
  console.log(`Merchant ID: ${merchant.id}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
