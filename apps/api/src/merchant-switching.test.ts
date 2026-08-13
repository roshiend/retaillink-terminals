import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './bootstrap.js';

const password = 'MerchantSwitch123!';
const sharedEmail = `switch-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
let merchantAId = '';
let merchantBId = '';
let merchantBCookie = '';
let sharedCookieOnB = '';

function ownerBEmail() {
  return `owner-b-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
}

describe.sequential('multi-merchant sessions', () => {
  beforeAll(async () => {
    await app.ready();

    const accountA = await app.inject({
      method: 'POST', url: '/auth/signup',
      payload: { business_name: 'Merchant A', email: sharedEmail, password },
    });
    expect(accountA.statusCode).toBe(201);
    merchantAId = accountA.json().merchant.id;

    const accountB = await app.inject({
      method: 'POST', url: '/auth/signup',
      payload: { business_name: 'Merchant B', email: ownerBEmail(), password: 'OwnerBTest123!' },
    });
    expect(accountB.statusCode).toBe(201);
    merchantBId = accountB.json().merchant.id;
    merchantBCookie = String(accountB.headers['set-cookie']).split(';', 1)[0];

    const invite = await app.inject({
      method: 'POST', url: '/dashboard/team/invites', headers: { cookie: merchantBCookie },
      payload: { email: sharedEmail, role: 'ADMIN' },
    });
    expect(invite.statusCode).toBe(201);

    const accepted = await app.inject({
      method: 'POST', url: '/auth/invitations/accept',
      payload: { token: invite.json().invite_token, password },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().merchant.id).toBe(merchantBId);
    sharedCookieOnB = String(accepted.headers['set-cookie']).split(';', 1)[0];
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists all memberships and switches the current merchant safely', async () => {
    const list = await app.inject({ method: 'GET', url: '/auth/merchants', headers: { cookie: sharedCookieOnB } });
    expect(list.statusCode).toBe(200);
    expect(list.json().current_merchant_id).toBe(merchantBId);
    expect(list.json().data.map((row: { merchant: { id: string } }) => row.merchant.id)).toEqual(expect.arrayContaining([merchantAId, merchantBId]));

    const switched = await app.inject({
      method: 'POST', url: '/auth/switch_merchant', headers: { cookie: sharedCookieOnB }, payload: { merchant_id: merchantAId },
    });
    expect(switched.statusCode).toBe(200);
    expect(switched.json().merchant.id).toBe(merchantAId);
    expect(switched.json().role).toBe('OWNER');

    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: sharedCookieOnB } });
    expect(me.statusCode).toBe(200);
    expect(me.json().merchant.id).toBe(merchantAId);
    expect(me.json().role).toBe('OWNER');
  });
});
