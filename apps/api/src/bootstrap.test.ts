import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './bootstrap.js';

let ownerCookie = '';

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
}

describe.sequential('merchant administration routes', () => {
  beforeAll(async () => {
    await app.ready();
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { business_name: 'Admin Route Test', email: uniqueEmail('owner'), password: 'IntegrationTest123!' },
    });
    expect(signup.statusCode).toBe(201);
    ownerCookie = String(signup.headers['set-cookie']).split(';', 1)[0];
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates, updates, lists and deletes customers while recording API logs', async () => {
    const email = uniqueEmail('customer');
    const created = await app.inject({
      method: 'POST', url: '/v1/customers', headers: { cookie: ownerCookie },
      payload: { name: 'Customer One', email, phone: '+94770000000' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Customer One', email });

    const id = created.json().id;
    const updated = await app.inject({
      method: 'POST', url: `/v1/customers/${id}`, headers: { cookie: ownerCookie }, payload: { name: 'Customer Updated' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().name).toBe('Customer Updated');

    const list = await app.inject({ method: 'GET', url: '/v1/customers', headers: { cookie: ownerCookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((row: { id: string }) => row.id === id)).toBe(true);

    const logs = await app.inject({ method: 'GET', url: '/dashboard/api_logs', headers: { cookie: ownerCookie } });
    expect(logs.statusCode).toBe(200);
    expect(logs.json().data.some((row: { path: string }) => row.path === '/v1/customers')).toBe(true);

    const removed = await app.inject({ method: 'DELETE', url: `/v1/customers/${id}`, headers: { cookie: ownerCookie } });
    expect(removed.statusCode).toBe(200);
  });

  it('invites a new team member and accepts the invitation into the merchant', async () => {
    const inviteEmail = uniqueEmail('staff');
    const invitation = await app.inject({
      method: 'POST', url: '/dashboard/team/invites', headers: { cookie: ownerCookie }, payload: { email: inviteEmail, role: 'DEVELOPER' },
    });
    expect(invitation.statusCode).toBe(201);
    expect(invitation.json().invite_token).toMatch(/^invite_test_/);

    const accepted = await app.inject({
      method: 'POST', url: '/auth/invitations/accept',
      payload: { token: invitation.json().invite_token, password: 'DeveloperTest123!' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ user: { email: inviteEmail }, role: 'DEVELOPER' });

    const team = await app.inject({ method: 'GET', url: '/dashboard/team', headers: { cookie: ownerCookie } });
    expect(team.statusCode).toBe(200);
    expect(team.json().members.some((row: { email: string; role: string }) => row.email === inviteEmail && row.role === 'DEVELOPER')).toBe(true);
  });

  it('creates and removes a merchant risk rule', async () => {
    const created = await app.inject({
      method: 'POST', url: '/dashboard/risk_rules', headers: { cookie: ownerCookie },
      payload: { name: 'Large payment review', type: 'AMOUNT_GTE', action: 'REVIEW', threshold: 1_000_000, currency: 'LKR' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ type: 'amount_gte', action: 'review', threshold: '1000000' });

    const listed = await app.inject({ method: 'GET', url: '/dashboard/risk_rules', headers: { cookie: ownerCookie } });
    expect(listed.json().data.some((row: { id: string }) => row.id === created.json().id)).toBe(true);

    const removed = await app.inject({ method: 'DELETE', url: `/dashboard/risk_rules/${created.json().id}`, headers: { cookie: ownerCookie } });
    expect(removed.statusCode).toBe(200);
  });

  it('enforces BLOCK rules and records REVIEW decisions on the canonical payment-intent route', async () => {
    const blockRule = await app.inject({
      method: 'POST', url: '/dashboard/risk_rules', headers: { cookie: ownerCookie },
      payload: { name: 'Blocked reference marker', type: 'REFERENCE_CONTAINS', action: 'BLOCK', text_value: 'BLOCKME' },
    });
    expect(blockRule.statusCode).toBe(201);

    const blocked = await app.inject({
      method: 'POST', url: '/v1/payment_intents', headers: { cookie: ownerCookie, 'idempotency-key': `risk-block-${Date.now()}` },
      payload: { amount: 25_000, currency: 'LKR', merchant_reference: 'ORDER-BLOCKME-1001' },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.type).toBe('risk_blocked');

    const blockedEvents = await app.inject({ method: 'GET', url: '/dashboard/risk_events', headers: { cookie: ownerCookie } });
    expect(blockedEvents.json().data.some((row: { outcome: string; rule_name: string | null }) => row.outcome === 'blocked' && row.rule_name === 'Blocked reference marker')).toBe(true);

    await app.inject({ method: 'DELETE', url: `/dashboard/risk_rules/${blockRule.json().id}`, headers: { cookie: ownerCookie } });

    const reviewRule = await app.inject({
      method: 'POST', url: '/dashboard/risk_rules', headers: { cookie: ownerCookie },
      payload: { name: 'Review medium payments', type: 'AMOUNT_GTE', action: 'REVIEW', threshold: 20_000, currency: 'LKR' },
    });
    expect(reviewRule.statusCode).toBe(201);

    const reviewed = await app.inject({
      method: 'POST', url: '/v1/payment_intents', headers: { cookie: ownerCookie, 'idempotency-key': `risk-review-${Date.now()}` },
      payload: { amount: 30_000, currency: 'LKR', merchant_reference: 'ORDER-REVIEW-1002' },
    });
    expect(reviewed.statusCode).toBe(201);

    const reviewEvents = await app.inject({ method: 'GET', url: '/dashboard/risk_events', headers: { cookie: ownerCookie } });
    expect(reviewEvents.json().data.some((row: { outcome: string; rule_name: string | null; merchant_reference: string | null }) => row.outcome === 'review' && row.rule_name === 'Review medium payments' && row.merchant_reference === 'ORDER-REVIEW-1002')).toBe(true);

    await app.inject({ method: 'DELETE', url: `/dashboard/risk_rules/${reviewRule.json().id}`, headers: { cookie: ownerCookie } });
  });

  it('settles the full positive ledger balance and reduces available balance to zero', async () => {
    const intent = await app.inject({
      method: 'POST', url: '/v1/payment_intents', headers: { cookie: ownerCookie, 'idempotency-key': `settlement-${Date.now()}` },
      payload: { amount: 50_000, currency: 'LKR' },
    });
    expect(intent.statusCode).toBe(201);
    const token = new URL(intent.json().checkout_url).pathname.split('/').at(-1)!;
    const paid = await app.inject({
      method: 'POST', url: `/checkout/${token}/confirm`, payload: { card_number: '4242424242424242', expiry: '12/30', cvc: '123' },
    });
    expect(paid.statusCode).toBe(200);

    const before = await app.inject({ method: 'GET', url: '/v1/balance', headers: { cookie: ownerCookie } });
    expect(Number(before.json().available)).toBeGreaterThan(0);

    const settlement = await app.inject({ method: 'POST', url: '/dashboard/settlements', headers: { cookie: ownerCookie }, payload: {} });
    expect(settlement.statusCode).toBe(201);
    expect(settlement.json().settlement.status).toBe('paid');

    const after = await app.inject({ method: 'GET', url: '/v1/balance', headers: { cookie: ownerCookie } });
    expect(after.json().available).toBe('0');
  });
});
