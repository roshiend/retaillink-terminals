import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './bootstrap.js';

let cookie = '';
let customerId = '';

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
}

describe.sequential('sandbox recurring billing', () => {
  beforeAll(async () => {
    await app.ready();
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { business_name: 'Billing Test Merchant', email: uniqueEmail('billing-owner'), password: 'BillingTest123!' },
    });
    expect(signup.statusCode).toBe(201);
    cookie = String(signup.headers['set-cookie']).split(';', 1)[0];

    const customer = await app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: { cookie },
      payload: { name: 'Recurring Customer', email: uniqueEmail('subscriber') },
    });
    expect(customer.statusCode).toBe(201);
    customerId = customer.json().id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a subscription with an open hosted invoice and marks it paid after checkout', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/subscriptions',
      headers: { cookie },
      payload: {
        customer: customerId,
        amount: 125_000,
        currency: 'LKR',
        interval: 'month',
        interval_count: 1,
        description: 'Monthly sandbox plan',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ customer: customerId, status: 'active', interval: 'month', amount: '125000' });
    expect(created.json().latest_invoice).toMatchObject({ status: 'open', customer: customerId, amount_due: '125000' });
    expect(created.json().latest_invoice.checkout_url).toContain('/pay/ct_test_');

    const invoiceId = created.json().latest_invoice.id;
    const checkoutToken = new URL(created.json().latest_invoice.checkout_url).pathname.split('/').at(-1)!;
    const paid = await app.inject({
      method: 'POST',
      url: `/checkout/${checkoutToken}/confirm`,
      payload: { card_number: '4242424242424242', expiry: '12/30', cvc: '123' },
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().status).toBe('succeeded');

    const invoice = await app.inject({ method: 'GET', url: `/v1/invoices/${invoiceId}`, headers: { cookie } });
    expect(invoice.statusCode).toBe(200);
    expect(invoice.json()).toMatchObject({ status: 'paid', amount_due: '125000', amount_paid: '125000' });
    expect(invoice.json().paid_at).toBeTruthy();
  });

  it('simulates the next billing cycle and prevents payment after an invoice is voided', async () => {
    const subscription = await app.inject({
      method: 'POST',
      url: '/v1/subscriptions',
      headers: { cookie },
      payload: { customer: customerId, amount: 80_000, currency: 'LKR', interval: 'week', interval_count: 2 },
    });
    expect(subscription.statusCode).toBe(201);
    const subscriptionId = subscription.json().id;
    const firstPeriodEnd = subscription.json().current_period_end;

    const advanced = await app.inject({ method: 'POST', url: `/v1/subscriptions/${subscriptionId}/run_cycle`, headers: { cookie }, payload: {} });
    expect(advanced.statusCode).toBe(200);
    expect(advanced.json().result).toBe('invoice_generated');
    expect(advanced.json().subscription.current_period_start).toBe(firstPeriodEnd);
    expect(advanced.json().subscription.latest_invoice.status).toBe('open');

    const invoice = advanced.json().subscription.latest_invoice;
    const voided = await app.inject({ method: 'POST', url: `/v1/invoices/${invoice.id}/void`, headers: { cookie }, payload: {} });
    expect(voided.statusCode).toBe(200);
    expect(voided.json().status).toBe('void');

    const token = new URL(invoice.checkout_url).pathname.split('/').at(-1)!;
    const blockedCheckout = await app.inject({
      method: 'POST',
      url: `/checkout/${token}/confirm`,
      payload: { card_number: '4242424242424242', expiry: '12/30', cvc: '123' },
    });
    expect(blockedCheckout.statusCode).toBe(409);
    expect(blockedCheckout.json().error.code).toBe('invoice_not_payable');
  });

  it('honours cancel-at-period-end without generating another invoice', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/subscriptions',
      headers: { cookie },
      payload: { customer: customerId, amount: 60_000, currency: 'LKR', interval: 'month' },
    });
    expect(created.statusCode).toBe(201);
    const subscriptionId = created.json().id;
    const invoiceId = created.json().latest_invoice.id;

    const cancel = await app.inject({
      method: 'POST', url: `/v1/subscriptions/${subscriptionId}/cancel`, headers: { cookie }, payload: { at_period_end: true },
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().cancel_at_period_end).toBe(true);

    const cycle = await app.inject({ method: 'POST', url: `/v1/subscriptions/${subscriptionId}/run_cycle`, headers: { cookie }, payload: {} });
    expect(cycle.statusCode).toBe(200);
    expect(cycle.json().result).toBe('canceled_at_period_end');
    expect(cycle.json().subscription.status).toBe('canceled');
    expect(cycle.json().subscription.latest_invoice.id).toBe(invoiceId);
  });

  it('applies BLOCK risk rules before creating a subscription invoice', async () => {
    const rule = await app.inject({
      method: 'POST',
      url: '/dashboard/risk_rules',
      headers: { cookie },
      payload: { name: 'Block costly subscriptions', type: 'AMOUNT_GTE', action: 'BLOCK', threshold: 500_000, currency: 'LKR' },
    });
    expect(rule.statusCode).toBe(201);

    const blocked = await app.inject({
      method: 'POST',
      url: '/v1/subscriptions',
      headers: { cookie },
      payload: { customer: customerId, amount: 600_000, currency: 'LKR', interval: 'month' },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.type).toBe('risk_blocked');

    await app.inject({ method: 'DELETE', url: `/dashboard/risk_rules/${rule.json().id}`, headers: { cookie } });
  });
});
