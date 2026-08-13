import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { auditDashboardAction, dashboardPrisma, getDashboardSession } from '../../../lib/server-session';

function serializeSettlement(row: { id: string; amount: bigint; currency: string; status: string; periodFrom: Date; periodTo: Date; createdAt: Date }) {
  return {
    id: row.id,
    amount: row.amount.toString(),
    currency: row.currency,
    status: row.status.toLowerCase(),
    period_from: row.periodFrom.toISOString(),
    period_to: row.periodTo.toISOString(),
    created_at: row.createdAt.toISOString(),
  };
}

export async function GET() {
  const auth = await getDashboardSession();
  if (!auth) return NextResponse.json({ error: { message: 'Merchant login required.' } }, { status: 401 });

  const rows = await dashboardPrisma.settlement.findMany({
    where: { merchantId: auth.session.merchantId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return NextResponse.json({ data: rows.map(serializeSettlement) });
}

export async function POST() {
  const auth = await getDashboardSession();
  if (!auth) return NextResponse.json({ error: { message: 'Merchant login required.' } }, { status: 401 });
  if (auth.membership.role !== 'OWNER') return NextResponse.json({ error: { message: 'Only the merchant owner can run a settlement.' } }, { status: 403 });

  const now = new Date();
  const merchantId = auth.session.merchantId;
  const currency = auth.session.merchant.defaultCurrency;

  const settlement = await dashboardPrisma.$transaction(async (tx) => {
    const merchantAccount = await tx.ledgerAccount.upsert({
      where: { merchantId_code_currency: { merchantId, code: 'MERCHANT_PAYABLE', currency } },
      update: {},
      create: { merchantId, code: 'MERCHANT_PAYABLE', name: 'Merchant payable', currency },
    });
    const processorAccount = await tx.ledgerAccount.upsert({
      where: { merchantId_code_currency: { merchantId, code: 'PROCESSOR_CLEARING', currency } },
      update: {},
      create: { merchantId, code: 'PROCESSOR_CLEARING', name: 'Processor clearing', currency },
    });

    const entries = await tx.ledgerEntry.findMany({ where: { accountId: merchantAccount.id } });
    const available = entries.reduce((sum, entry) => sum + (entry.direction === 'CREDIT' ? entry.amount : -entry.amount), 0n);
    if (available <= 0n) return null;

    const previous = await tx.settlement.findFirst({
      where: { merchantId },
      orderBy: { periodTo: 'desc' },
    });

    const row = await tx.settlement.create({
      data: {
        merchantId,
        amount: available,
        currency,
        status: 'PAID',
        periodFrom: previous?.periodTo ?? auth.session.merchant.createdAt,
        periodTo: now,
      },
    });

    const transactionId = `txn_${randomUUID()}`;
    await tx.ledgerEntry.createMany({
      data: [
        {
          transactionId,
          accountId: merchantAccount.id,
          direction: 'DEBIT',
          amount: available,
          currency,
          referenceType: 'settlement',
          referenceId: row.id,
        },
        {
          transactionId,
          accountId: processorAccount.id,
          direction: 'CREDIT',
          amount: available,
          currency,
          referenceType: 'settlement',
          referenceId: row.id,
        },
      ],
    });

    return row;
  });

  if (!settlement) {
    return NextResponse.json({ error: { message: 'There is no available balance to settle.' } }, { status: 409 });
  }

  await auditDashboardAction({
    merchantId,
    userId: auth.session.userId,
    action: 'settlement.paid',
    resource: 'settlement',
    resourceId: settlement.id,
    metadata: { amount: settlement.amount.toString(), currency: settlement.currency },
  });

  return NextResponse.json({ settlement: serializeSettlement(settlement) }, { status: 201 });
}
