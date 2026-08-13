import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './bootstrap.js';

let ownerCookie = '';
let refundablePaymentId = '';

function email(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
}

async function inviteAndAccept(role: 'VIEWER' | 'FINANCE' | 'DEVELOPER') {
  const invitedEmail = email(role.toLowerCase());
  const invitation = await app.inject({
    method: 'POST',
    url: '/dashboard/team/invites',
    headers: { cookie: ownerCookie },
    payload: { email: invitedEmail, role },
  });
  expect(invitation.statusCode).toBe(201);

  const accepted = await app.inject({
    method: 'POST',
    url: '/auth/invitations/accept',
    payload: { token: invitation.json().invite_token, password: 'RoleTest123!' },
  });
  expect(accepted.statusCode).toBe(200);
  return String(accepted.headers['set-cookie']).split(';', 1)[0];
}

describe.sequential('merchant role-based access', () => {
  beforeAll(async () => {
    await app.ready();
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { business_name: 'RBAC Test Merchant', email: email('owner'), password: 'OwnerRoleTest123!' },
    });
    expect(signup.statusCode).toBe(201);
    ownerCookie = String(signup.headers['set-cookie']).split(';', 1)[0];

    const intent = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: { cookie: ownerCookie, 'idempotency-key': `rbac-payment-${Date.now()}` },
      payload: { amount: 75_000, currency: 'LKR', merchant_reference: 'RBAC-REFUND' },
    });
    expect(intent.statusCode).toBe(201);
    const token = new URL(intent.json().checkout_url).pathname.split('/').at(-1)!;
    const paid = await app.inject({
      method: 'POST',
      url: `/checkout/${token}/confirm`,
      payload: { card_number: '4242424242424242', expiry: '12/30', cvc: '123' },
    });
    expect(paid.statusCode).toBe(200);
    refundablePaymentId = paid.json().payment.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps VIEWER read-only', async () => {
    const viewerCookie = await inviteAndAccept('VIEWER');

    const readable = await app.inject({ method: 'GET', url: '/v1/payments', headers: { cookie: viewerCookie } });
    expect(readable.statusCode).toBe(200);

    const createIntent = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: { cookie: viewerCookie },
      payload: { amount: 10_000, currency: 'LKR' },
    });
    expect(createIntent.statusCode).toBe(403);
    expect(createIntent.json().error.code).toBe('insufficient_role');

    const createKey = await app.inject({
      method: 'POST',
      url: '/dashboard/api_keys',
      headers: { cookie: viewerCookie },
      payload: { name: 'Viewer should not create this' },
    });
    expect(createKey.statusCode).toBe(403);
  });

  it('allows FINANCE to refund but not create payment intents', async () => {
    const financeCookie = await inviteAndAccept('FINANCE');

    const createIntent = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: { cookie: financeCookie },
      payload: { amount: 10_000, currency: 'LKR' },
    });
    expect(createIntent.statusCode).toBe(403);

    const refund = await app.inject({
      method: 'POST',
      url: `/v1/payments/${refundablePaymentId}/refunds`,
      headers: { cookie: financeCookie },
      payload: {},
    });
    expect(refund.statusCode).toBe(201);
  });
});
