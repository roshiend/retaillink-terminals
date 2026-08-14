import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@retaillink/database';
import { app } from './bootstrap.js';

let cookie = '';
let merchantId = '';

function uniqueEmail() {
  return `ledger-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
}

describe.sequential('double-entry ledger invariants', () => {
  beforeAll(async () => {
    await app.ready();
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { business_name: 'Ledger Invariant Test', email: uniqueEmail(), password: 'IntegrationTest123!' },
    });
    expect(signup.statusCode).toBe(201);
    cookie = String(signup.headers['set-cookie']).split(';', 1)[0];
    merchantId = signup.json().merchant.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps every payment/refund/settlement transaction exactly balanced', async () => {
    const intent = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: { cookie, 'idempotency-key': `ledger-payment-${Date.now()}` },
      payload: { amount: 100_000, currency: 'LKR' },
    });
    expect(intent.statusCode).toBe(201);
    const checkoutToken = new URL(intent.json().checkout_url).pathname.split('/').at(-1)!;
    const paid = await app.inject({
      method: 'POST',
      url: `/checkout/${checkoutToken}/confirm`,
      payload: { card_number: '4242424242424242', expiry: '12/30', cvc: '123' },
    });
    expect(paid.statusCode).toBe(200);
    const paymentId = paid.json().payment.id;

    const refund = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/refunds`,
      headers: { cookie, 'idempotency-key': `ledger-refund-${Date.now()}` },
      payload: { amount: 20_000, reason: 'ledger_invariant_test' },
    });
    expect(refund.statusCode).toBe(201);

    const settlement = await app.inject({
      method: 'POST',
      url: '/dashboard/settlements',
      headers: { cookie },
      payload: { currency: 'LKR' },
    });
    expect(settlement.statusCode).toBe(201);

    const entries = await prisma.ledgerEntry.findMany({
      where: { account: { merchantId } },
      select: { transactionId: true, direction: true, amount: true },
    });
    expect(entries.length).toBeGreaterThanOrEqual(8);

    const transactions = new Map<string, { debit: bigint; credit: bigint }>();
    for (const entry of entries) {
      const totals = transactions.get(entry.transactionId) ?? { debit: 0n, credit: 0n };
      totals[entry.direction === 'DEBIT' ? 'debit' : 'credit'] += entry.amount;
      transactions.set(entry.transactionId, totals);
    }

    expect(transactions.size).toBeGreaterThanOrEqual(3);
    for (const [transactionId, totals] of transactions) {
      expect(totals.debit, `${transactionId} debit/credit mismatch`).toBe(totals.credit);
      expect(totals.debit, `${transactionId} must not be zero`).toBeGreaterThan(0n);
    }
  });
});
