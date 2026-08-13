import { NextResponse } from 'next/server';
import { auditDashboardAction, dashboardPrisma, getDashboardSession } from '../../../lib/server-session';

export async function GET() {
  const auth = await getDashboardSession();
  if (!auth) return NextResponse.json({ error: { message: 'Merchant login required.' } }, { status: 401 });

  return NextResponse.json({
    merchant: {
      id: auth.session.merchant.id,
      name: auth.session.merchant.name,
      country: auth.session.merchant.country,
      currency: auth.session.merchant.defaultCurrency,
    },
    role: auth.membership.role,
  });
}

export async function POST(request: Request) {
  const auth = await getDashboardSession();
  if (!auth) return NextResponse.json({ error: { message: 'Merchant login required.' } }, { status: 401 });
  if (auth.membership.role !== 'OWNER') return NextResponse.json({ error: { message: 'Only the merchant owner can change business settings.' } }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (name.length < 2 || name.length > 120) {
    return NextResponse.json({ error: { message: 'Business name must be between 2 and 120 characters.' } }, { status: 400 });
  }

  const merchant = await dashboardPrisma.merchant.update({
    where: { id: auth.session.merchantId },
    data: { name },
  });

  await auditDashboardAction({
    merchantId: merchant.id,
    userId: auth.session.userId,
    action: 'merchant.updated',
    resource: 'merchant',
    resourceId: merchant.id,
    metadata: { name },
  });

  return NextResponse.json({
    merchant: { id: merchant.id, name: merchant.name, country: merchant.country, currency: merchant.defaultCurrency },
  });
}
