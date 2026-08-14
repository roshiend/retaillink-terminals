import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@retaillink/database';

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function sessionFor(request: FastifyRequest) {
  const token = request.cookies.rt_session;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { merchantId: true, expiresAt: true },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  return session;
}

function signedAccountBalance(code: string, entries: Array<{ direction: string; amount: bigint }>) {
  const debits = entries.filter((entry) => entry.direction === 'DEBIT').reduce((sum, entry) => sum + entry.amount, 0n);
  const credits = entries.filter((entry) => entry.direction === 'CREDIT').reduce((sum, entry) => sum + entry.amount, 0n);
  const balance = code === 'PROCESSOR_CLEARING' ? debits - credits : credits - debits;
  return { debits, credits, balance };
}

export function registerFinanceRoutes(app: FastifyInstance) {
  app.get('/dashboard/finance', async (request, reply) => {
    const session = await sessionFor(request);
    if (!session) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });

    const [accounts, recentEntries, payments, refunds, settlements] = await Promise.all([
      prisma.ledgerAccount.findMany({
        where: { merchantId: session.merchantId },
        include: { entries: { select: { direction: true, amount: true } } },
        orderBy: [{ currency: 'asc' }, { code: 'asc' }],
      }),
      prisma.ledgerEntry.findMany({
        where: { account: { merchantId: session.merchantId } },
        include: { account: { select: { code: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.payment.findMany({
        where: { merchantId: session.merchantId, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
        select: { amount: true, currency: true },
      }),
      prisma.refund.findMany({
        where: { merchantId: session.merchantId, status: 'SUCCEEDED' },
        select: { amount: true, currency: true },
      }),
      prisma.settlement.findMany({
        where: { merchantId: session.merchantId, status: 'PAID' },
        select: { amount: true, currency: true },
      }),
    ]);

    const currencies = new Set([
      ...accounts.map((row) => row.currency),
      ...payments.map((row) => row.currency),
      ...refunds.map((row) => row.currency),
      ...settlements.map((row) => row.currency),
    ]);

    const summary = [...currencies].sort().map((currency) => {
      const accountByCode = new Map(accounts.filter((row) => row.currency === currency).map((row) => [row.code, signedAccountBalance(row.code, row.entries)]));
      const gross = payments.filter((row) => row.currency === currency).reduce((sum, row) => sum + row.amount, 0n);
      const refunded = refunds.filter((row) => row.currency === currency).reduce((sum, row) => sum + row.amount, 0n);
      const settled = settlements.filter((row) => row.currency === currency).reduce((sum, row) => sum + row.amount, 0n);
      return {
        currency,
        gross_volume: gross.toString(),
        refunds: refunded.toString(),
        settled: settled.toString(),
        merchant_payable: (accountByCode.get('MERCHANT_PAYABLE')?.balance ?? 0n).toString(),
        gateway_fee_balance: (accountByCode.get('FEE_REVENUE')?.balance ?? 0n).toString(),
        processor_clearing: (accountByCode.get('PROCESSOR_CLEARING')?.balance ?? 0n).toString(),
      };
    });

    return {
      object: 'finance_summary',
      summary,
      accounts: accounts.map((row) => {
        const values = signedAccountBalance(row.code, row.entries);
        return {
          id: row.id,
          code: row.code,
          name: row.name,
          currency: row.currency,
          debits: values.debits.toString(),
          credits: values.credits.toString(),
          balance: values.balance.toString(),
        };
      }),
      ledger: recentEntries.map((entry) => ({
        id: entry.id,
        transaction_id: entry.transactionId,
        account: entry.account.code,
        account_name: entry.account.name,
        direction: entry.direction.toLowerCase(),
        amount: entry.amount.toString(),
        currency: entry.currency,
        reference_type: entry.referenceType,
        reference_id: entry.referenceId,
        created_at: entry.createdAt.toISOString(),
      })),
    };
  });

  app.get('/dashboard/payments/:id/finance', async (request, reply) => {
    const session = await sessionFor(request);
    if (!session) return reply.code(401).send({ error: { type: 'authentication_error', message: 'Merchant login required.' } });
    const { id } = request.params as { id: string };
    const payment = await prisma.payment.findFirst({
      where: { id, merchantId: session.merchantId },
      include: { refunds: { where: { status: 'SUCCEEDED' }, orderBy: { createdAt: 'asc' } } },
    });
    if (!payment) return reply.code(404).send({ error: { type: 'not_found', message: 'No such payment.' } });

    const refundIds = payment.refunds.map((refund) => refund.id);
    const entries = await prisma.ledgerEntry.findMany({
      where: {
        account: { merchantId: session.merchantId },
        OR: [
          { referenceType: 'payment', referenceId: payment.id },
          ...(refundIds.length ? [{ referenceType: 'refund', referenceId: { in: refundIds } }] : []),
        ],
      },
      include: { account: { select: { code: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const paymentFee = entries
      .filter((entry) => entry.referenceType === 'payment' && entry.account.code === 'FEE_REVENUE' && entry.direction === 'CREDIT')
      .reduce((sum, entry) => sum + entry.amount, 0n);
    const feeReversed = entries
      .filter((entry) => entry.referenceType === 'refund' && entry.account.code === 'FEE_REVENUE' && entry.direction === 'DEBIT')
      .reduce((sum, entry) => sum + entry.amount, 0n);
    const merchantNet = entries
      .filter((entry) => entry.referenceType === 'payment' && entry.account.code === 'MERCHANT_PAYABLE' && entry.direction === 'CREDIT')
      .reduce((sum, entry) => sum + entry.amount, 0n);
    const merchantReversed = entries
      .filter((entry) => entry.referenceType === 'refund' && entry.account.code === 'MERCHANT_PAYABLE' && entry.direction === 'DEBIT')
      .reduce((sum, entry) => sum + entry.amount, 0n);

    return {
      object: 'payment_finance',
      payment: payment.id,
      currency: payment.currency,
      gross: payment.amount.toString(),
      gross_refunded: payment.refundedAmount.toString(),
      original_fee: paymentFee.toString(),
      fee_reversed: feeReversed.toString(),
      fee_retained: (paymentFee - feeReversed).toString(),
      original_merchant_net: merchantNet.toString(),
      merchant_net_reversed: merchantReversed.toString(),
      merchant_net_remaining: (merchantNet - merchantReversed).toString(),
      refunds: payment.refunds.map((refund) => ({ id: refund.id, amount: refund.amount.toString(), reason: refund.reason, created_at: refund.createdAt.toISOString() })),
      ledger: entries.map((entry) => ({
        id: entry.id,
        transaction_id: entry.transactionId,
        account: entry.account.code,
        account_name: entry.account.name,
        direction: entry.direction.toLowerCase(),
        amount: entry.amount.toString(),
        reference_type: entry.referenceType,
        reference_id: entry.referenceId,
        created_at: entry.createdAt.toISOString(),
      })),
    };
  });
}
