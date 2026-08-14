'use client';

import { useEffect, useState, type FormEvent } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Session = {
  id: string;
  merchant: { id: string; name: string };
  current: boolean;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
};

export default function SecurityPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && path !== '/account/password') {
      window.location.href = '/';
      throw new Error('Sign in required.');
    }
    if (!response.ok) throw new Error(data.error?.message ?? `Request failed (${response.status})`);
    return data;
  }

  async function load() {
    try {
      const data = await request('/account/sessions');
      setSessions(data.data ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load sessions.');
    }
  }

  useEffect(() => { void load(); }, []);

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword.length < 12) return setMessage('New password must be at least 12 characters.');
    setBusy('password'); setMessage('');
    try {
      await request('/account/password', {
        method: 'POST',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      setCurrentPassword(''); setNewPassword('');
      setMessage('Password changed. Every other active session was revoked.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not change password.');
    } finally { setBusy(''); }
  }

  async function revoke(session: Session) {
    if (!window.confirm(session.current ? 'Revoke this current session and sign out?' : 'Revoke this session?')) return;
    setBusy(session.id); setMessage('');
    try {
      const result = await request(`/account/sessions/${session.id}`, { method: 'DELETE' });
      if (result.current_session_revoked) { window.location.href = '/'; return; }
      setMessage('Session revoked.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not revoke session.');
    } finally { setBusy(''); }
  }

  async function logoutAll() {
    if (!window.confirm('Log out every active Retaillink session, including this browser?')) return;
    setBusy('all'); setMessage('');
    try {
      await request('/account/logout_all', { method: 'POST', body: '{}' });
      window.location.href = '/';
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not revoke sessions.');
    } finally { setBusy(''); }
  }

  return <main className="moduleShell"><section className="modulePage">
    <header className="moduleHeader"><div><p className="eyebrow">Account protection</p><h1>Security</h1><p className="muted">Manage your password and active browser sessions. Password changes revoke every other session automatically.</p></div><div className="moduleHeaderActions"><a className="secondary" href="/">Back to overview</a><button onClick={() => void load()}>Refresh</button></div></header>
    {message && <p className="moduleNotice">{message}</p>}

    <section className="moduleCard"><p className="eyebrow">Credentials</p><h2>Change password</h2><form className="moduleForm" onSubmit={changePassword}>
      <label>Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></label>
      <label>New password<input type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required /></label>
      <button disabled={busy === 'password'}>{busy === 'password' ? 'Changing…' : 'Change password'}</button>
    </form></section>

    <section className="moduleCard"><div className="panelTitle"><div><p className="eyebrow">Active access</p><h2>{sessions.length} sessions</h2></div><button className="danger" disabled={busy === 'all'} onClick={() => void logoutAll()}>Log out everywhere</button></div><div className="tableWrap"><table><thead><tr><th>Merchant context</th><th>Session</th><th>Last seen</th><th>Expires</th><th></th></tr></thead><tbody>{sessions.map((row) => <tr key={row.id}><td><strong>{row.merchant.name}</strong><small className="mono">{row.merchant.id}</small></td><td><span className={`status ${row.current ? 'active' : ''}`}>{row.current ? 'current' : 'active'}</span><small className="mono">{row.id}</small></td><td>{new Date(row.last_seen_at).toLocaleString()}</td><td>{new Date(row.expires_at).toLocaleString()}</td><td><button className="linkButton danger" disabled={busy === row.id} onClick={() => void revoke(row)}>{row.current ? 'Sign out' : 'Revoke'}</button></td></tr>)}</tbody></table>{!sessions.length && <p className="empty">No active sessions.</p>}</div></section>
  </section></main>;
}
