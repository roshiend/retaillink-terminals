'use client';

import { useEffect, useState, type FormEvent } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function InvitePage() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') ?? '');
  }, []);

  async function accept(event: FormEvent) {
    event.preventDefault();
    if (!token) return setMessage('This invitation link is missing its token.');
    if (password !== confirmPassword) return setMessage('Passwords do not match.');
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`${API_URL}/auth/invitations/accept`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message ?? 'Could not accept invitation.');
      setMessage(`Joined ${data.merchant.name}. Opening the merchant console…`);
      window.setTimeout(() => { window.location.href = '/'; }, 700);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not accept invitation.'); }
    finally { setBusy(false); }
  }

  return <main className="inviteShell"><section className="inviteCard">
    <div className="brand"><strong>RETAILLINK</strong> TERMINALS <span className="badge">SANDBOX</span></div>
    <p className="eyebrow" style={{ marginTop: 28 }}>Team invitation</p><h1>Join merchant account</h1>
    <p className="muted">Choose a password for a new account. If this email already has a Retaillink account, enter that account's existing password.</p>
    <form onSubmit={accept}><label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></label><label>Confirm password<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={8} required /></label><button disabled={busy || !token}>{busy ? 'Joining…' : 'Accept invitation'}</button></form>
    {!token && <p className="moduleWarning">No invitation token was found in this URL.</p>}
    {message && <p className="moduleNotice">{message}</p>}
  </section></main>;
}
