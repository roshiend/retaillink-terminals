import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './bootstrap.js';

let cookie = '';

function uniqueEmail() {
  return `finance-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
}

describe.sequential('finance reconciliation', () => {
  beforeAll(async () => {
    await app.ready();
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { business_name: 'Finance Test', email: uniqueEmail(), password: 'IntegrationTest123!' },
    });
    expect(signup.statusCode).toBe(201);
    cookie = String(signup.headers['set-cookie']).split(';', 1)[0];
  });

  afterAll(async () => {
    await app.close();
  });

  it('reconciles gross, fee, merchant net and partial refund from ledger entries', async () => {
    const intent = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: { cookie, 'idempotency-key': `finance-intent-${Date.now()}` },
      payload: { amount: 100_000, currency: 'LKR' },
    });
    expect(intent.statusCode).toBe(201);
    const token = new URL(intent.json().checkout_url).pathname.split('/').at(-1)!;
    const paid = await app.inject({
      method: 'POST',
      url: `/checkout/${token}/confirm`,
      payload: { card_number: '4242424242424242', expiry: '12/30', cvc: '123' },
    });
    expect(paid.statusCode).toBe(200);
    const paymentId = paid.json().payment.id as string;

    const refund = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/refunds`,
      headers: { cookie, 'idempotency-key': `finance-refund-${Date.now()}` },
      payload: { amount: 20_000, reason: 'finance_test' },
    });
    expect(refund.statusCode).toBe(201);

    const detail = await app.inject({ method: 'GET', url: `/dashboard/payments/${paymentId}/finance`, headers: { cookie } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      gross: '100000',
      gross_refunded: '20000',
      original_fee: '5500',
      fee_reversed: '1100',
      fee_retained: '4400',
      original_merchant_net: '94500',
      merchant_net_reversed: '18900',
      merchant_net_remaining: '75600',
    });
    expect(detail.json().ledger).toHaveLength(6);

    const finance = await app.inject({ method: 'GET', url: '/dashboard/finance', headers: { cookie } });
    expect(finance.statusCode).toBe(200);
    const lkr = finance.json().summary.find((row: { currency: string }) => row.currency === 'LKR');
    expect(lkr).toMatchObject({
      gross_volume: '100000',
      refunds: '20000',
      merchant_payable: '75600',
      gateway_fee_balance: '4400',
      processor_clearing: '80000',
    });
  });
});
