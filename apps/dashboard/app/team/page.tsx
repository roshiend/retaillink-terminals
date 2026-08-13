'use client';

import { useEffect, useState, type FormEvent } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Member = { id: string; user_id: string; email: string; role: string; created_at: string };
type Invite = { id: string; email: string; role: string; expires_at: string; created_at: string };

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('VIEWER');
  const [inviteLink, setInviteLink] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      ...options, credentials: 'include',
      headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { window.location.href = '/'; throw new Error('Sign in required.'); }
    if (!response.ok) throw new Error(data.error?.message ?? `Request failed (${response.status})`);
    return data;
  }

  async function load() {
    try {
      const data = await request('/dashboard/team');
      setMembers(data.members ?? []);
      setInvites(data.invites ?? []);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load team.'); }
  }

  useEffect(() => { void load(); }, []);

  async function invite(event: FormEvent) {
    event.preventDefault(); setBusy(true); setInviteLink(''); setMessage('');
    try {
      const data = await request('/dashboard/team/invites', { method: 'POST', body: JSON.stringify({ email, role }) });
      const localLink = `${window.location.origin}/invite?token=${encodeURIComponent(data.invite_token)}`;
      setInviteLink(localLink); setEmail(''); await load();
      setMessage('Invitation created. Copy the one-time link below and send it to the team member.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create invitation.'); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm('Remove this team member and invalidate their merchant sessions?')) return;
    setBusy(true);
    try { await request(`/dashboard/team/members/${id}`, { method: 'DELETE' }); await load(); setMessage('Team member removed.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not remove team member.'); }
    finally { setBusy(false); }
  }

  return <main className="moduleShell"><section className="modulePage">
    <header className="moduleHeader"><div><p className="eyebrow">Access control</p><h1>Team</h1><p className="muted">Invite staff to the merchant account without sharing your owner password or API keys.</p></div><a className="secondary" href="/">Back to overview</a></header>
    {message && <p className="moduleNotice">{message}</p>}
    <section className="moduleCard"><p className="eyebrow">Owner action</p><h2>Invite team member</h2><form className="moduleForm two" onSubmit={invite}><label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><label>Role<select value={role} onChange={(e) => setRole(e.target.value)}><option value="ADMIN">Admin</option><option value="DEVELOPER">Developer</option><option value="FINANCE">Finance</option><option value="VIEWER">Viewer</option></select></label><button disabled={busy}>Create invitation</button></form>
      {inviteLink && <div className="copyRow"><code>{inviteLink}</code><button onClick={() => void navigator.clipboard.writeText(inviteLink)}>Copy link</button></div>}
    </section>
    <section className="moduleCard"><p className="eyebrow">Members</p><h2>{members.length} team members</h2><div className="tableWrap"><table><thead><tr><th>Email</th><th>Role</th><th>Added</th><th></th></tr></thead><tbody>{members.map((row) => <tr key={row.id}><td><strong>{row.email}</strong><small className="mono">{row.user_id}</small></td><td><span className="roleBadge">{row.role}</span></td><td>{new Date(row.created_at).toLocaleString()}</td><td>{row.role !== 'OWNER' && <button className="linkButton danger" disabled={busy} onClick={() => void remove(row.id)}>Remove</button>}</td></tr>)}</tbody></table></div></section>
    <section className="moduleCard"><p className="eyebrow">Pending</p><h2>Active invitations</h2><div className="tableWrap"><table><thead><tr><th>Email</th><th>Role</th><th>Expires</th></tr></thead><tbody>{invites.map((row) => <tr key={row.id}><td>{row.email}</td><td><span className="roleBadge">{row.role}</span></td><td>{new Date(row.expires_at).toLocaleString()}</td></tr>)}</tbody></table>{!invites.length && <p className="empty">No pending invitations.</p>}</div></section>
  </section></main>;
}
