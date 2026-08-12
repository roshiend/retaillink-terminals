import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const merchant = await prisma.merchant.upsert({
    where: { id: 'demo_merchant' },
    update: {},
    create: {
      id: 'demo_merchant',
      name: 'Retaillink Demo Store',
      country: 'LK',
      defaultCurrency: 'LKR',
    },
  });

  const existingKey = await prisma.apiKey.findFirst({
    where: { merchantId: merchant.id, name: 'Default sandbox key', revokedAt: null },
  });

  if (!existingKey) {
    const rawKey = `sk_test_${randomBytes(24).toString('hex')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    await prisma.apiKey.create({
      data: {
        merchantId: merchant.id,
        environment: 'TEST',
        name: 'Default sandbox key',
        prefix: rawKey.slice(0, 16),
        keyHash,
      },
    });

    console.log('\nSandbox merchant created.');
    console.log(`Merchant ID: ${merchant.id}`);
    console.log(`Secret key: ${rawKey}`);
    console.log('Save this key now. Only its hash is stored in the database.\n');
  } else {
    console.log('\nDemo merchant already exists.');
    console.log('A sandbox key already exists; its full secret cannot be recovered.');
    console.log('Delete/revoke it and rerun the seed if you need a new one.\n');
  }

  for (const account of [
    { code: 'PROCESSOR_CLEARING', name: 'Processor clearing' },
    { code: 'MERCHANT_PAYABLE', name: 'Merchant payable' },
    { code: 'FEE_REVENUE', name: 'Gateway fee revenue' },
  ]) {
    await prisma.ledgerAccount.upsert({
      where: {
        merchantId_code_currency: {
          merchantId: merchant.id,
          code: account.code,
          currency: 'LKR',
        },
      },
      update: {},
      create: {
        merchantId: merchant.id,
        code: account.code,
        name: account.name,
        currency: 'LKR',
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
