import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var retaillinkPrisma: PrismaClient | undefined;
}

export const prisma = globalThis.retaillinkPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.retaillinkPrisma = prisma;
}

export * from '@prisma/client';
