import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './bootstrap.js';

const email = `security-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
const originalPassword = 'IntegrationTest123!';
const newPassword = 'IntegrationTest456!';
let primaryCookie = '';
let secondaryCookie = '';

describe.sequential('account security', () => {
  beforeAll(async () => {
    await app.ready();
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { business_name: 'Security Test', email, password: originalPassword },
    });
    expect(signup.statusCode).toBe(201);
    primaryCookie = String(signup.headers['set-cookie']).split(';', 1)[0];

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: originalPassword } });
    expect(login.statusCode).toBe(200);
    secondaryCookie = String(login.headers['set-cookie']).split(';', 1)[0];
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists active sessions and identifies the current session', async () => {
    const response = await app.inject({ method: 'GET', url: '/account/sessions', headers: { cookie: primaryCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(2);
    expect(response.json().data.filter((row: { current: boolean }) => row.current)).toHaveLength(1);
  });

  it('rejects a password change with the wrong current password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/account/password',
      headers: { cookie: primaryCookie },
      payload: { current_password: 'wrong-password', new_password: newPassword },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('incorrect_current_password');
  });

  it('changes the password and revokes every other active session', async () => {
    const changed = await app.inject({
      method: 'POST',
      url: '/account/password',
      headers: { cookie: primaryCookie },
      payload: { current_password: originalPassword, new_password: newPassword },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().other_sessions_revoked).toBe(true);

    const current = await app.inject({ method: 'GET', url: '/account/sessions', headers: { cookie: primaryCookie } });
    expect(current.statusCode).toBe(200);
    expect(current.json().data).toHaveLength(1);

    const revoked = await app.inject({ method: 'GET', url: '/account/sessions', headers: { cookie: secondaryCookie } });
    expect(revoked.statusCode).toBe(401);

    const oldLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: originalPassword } });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: newPassword } });
    expect(newLogin.statusCode).toBe(200);
  });

  it('can revoke all remaining sessions', async () => {
    const response = await app.inject({ method: 'POST', url: '/account/logout_all', headers: { cookie: primaryCookie }, payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json().revoked).toBeGreaterThanOrEqual(1);

    const after = await app.inject({ method: 'GET', url: '/account/sessions', headers: { cookie: primaryCookie } });
    expect(after.statusCode).toBe(401);
  });
});
