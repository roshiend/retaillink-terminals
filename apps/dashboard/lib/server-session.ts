import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { cookies } from 'next/headers';

for (const candidate of [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../packages/database/.env'),
  resolve(process.cwd(), 'packages/database/.env'),
]) {
  if (existsSync(candidate)) config({ path: candidate, override: false });
}

declare global {
  // eslint-disable-next-line no-var
  var retaillinkDashboardPrisma: PrismaClient | undefined;
}

export const dashboardPrisma = globalThis.retaillinkDashboardPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.retaillinkDashboardPrisma = dashboardPrisma;

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function getDashboardSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get('rt_session')?.value;
  if (!token) return null;

  const session = await dashboardPrisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true, merchant: true },
  });

  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await dashboardPrisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  const membership = await dashboardPrisma.merchantUser.findUnique({
    where: { userId_merchantId: { userId: session.userId, merchantId: session.merchantId } },
  });
  if (!membership) return null;

  return { session, membership };
}

export async function auditDashboardAction(input: {
  merchantId: string;
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: unknown;
}) {
  return dashboardPrisma.auditLog.create({
    data: {
      merchantId: input.merchantId,
      userId: input.userId,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      metadata: input.metadata as any,
    },
  });
}
