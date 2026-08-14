'use client';

import { useEffect, useState, type FormEvent } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  revoked: boolean;
  last_used_at: string | null;
  created_at: string;
};

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [availableScopes, setAvailableScopes] = useState<string[]>([]);
  const [name, setName] = useState('Website integration');
  const [selected, setSelected] = useState<string[]>(['payments:read', 'payments:write']);
  const [oneTimeSecret, setOneTimeSecret] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { window.location.href = '/'; throw new Error('Sign in required.'); }
    if (!response.ok) throw new Error(data.error?.message ?? `Request failed (${response.status})`);
    return data;
  }

  async function load() {
    setMessage('');
    try {
      const data = await request('/dashboard/api_keys/scoped');
      setKeys(data.data ?? []);
      setAvailableScopes(data.available_scopes ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load API keys.');
    }
  }

  useEffect(() => { void load(); }, []);

  function toggleScope(scope: string) {
    setSelected((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]);
  }

  async function createKey(event: FormEvent) {
    event.preventDefault();
    if (!selected.length) return setMessage('Choose at least one API-key scope.');
    setBusy('create'); setMessage(''); setOneTimeSecret('');
    try {
      const data = await request('/dashboard/api_keys/scoped', {
        method: 'POST',
        body: JSON.stringify({ name, scopes: selected }),
      });
      setOneTimeSecret(data.secret);
      setMessage('Restricted key created. Copy the secret now; it will not be shown again.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create API key.');
    } finally { setBusy(''); }
  }

  async function revoke(key: ApiKey) {
    if (key.revoked || !window.confirm(`Revoke ${key.name}? Existing integrations using it will stop working immediately.`)) return;
    setBusy(key.id); setMessage('');
    try {
      await request(`/dashboard/api_keys/${key.id}`, { method: 'DELETE' });
      setMessage('API key revoked.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not revoke API key.');
    } finally { setBusy(''); }
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setMessage('Secret copied to clipboard.'); }
    catch { setMessage(value); }
  }

  return <main className="moduleShell"><section className="modulePage">
    <header className="moduleHeader"><div><p className="eyebrow">Developer access</p><h1>API Keys</h1><p className="muted">Create least-privilege sandbox keys. Give each integration only the read/write resources it actually needs.</p></div><div className="moduleHeaderActions"><a className="secondary" href="/">Back to overview</a><button onClick={() => void load()}>Refresh</button></div></header>
    <p className="moduleNotice"><strong>Recommended:</strong> use separate keys for separate services, choose the minimum scopes required, and revoke a key immediately if it is exposed.</p>
    {message && <p className="moduleNotice">{message}</p>}
    {oneTimeSecret && <section className="moduleCard"><p className="eyebrow">One-time secret</p><h2>Copy this key now</h2><p className="mono">{oneTimeSecret}</p><button onClick={() => void copy(oneTimeSecret)}>Copy secret</button></section>}

    <section className="moduleCard"><p className="eyebrow">New restricted credential</p><h2>Create API key</h2><form className="moduleForm" onSubmit={createKey}>
      <label>Name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required /></label>
      <div><strong>Scopes</strong><div className="scopeGrid">{availableScopes.map((scope) => <label key={scope} className="scopeOption"><input type="checkbox" checked={selected.includes(scope)} onChange={() => toggleScope(scope)} /><span className="mono">{scope}</span></label>)}</div></div>
      <button disabled={busy === 'create'}>{busy === 'create' ? 'Creating…' : 'Create restricted key'}</button>
    </form></section>

    <section className="moduleCard"><div className="panelTitle"><div><p className="eyebrow">Credentials</p><h2>{keys.length} keys</h2></div></div><div className="tableWrap"><table><thead><tr><th>Key</th><th>Scopes</th><th>Status</th><th>Last used</th><th>Created</th><th></th></tr></thead><tbody>{keys.map((key) => <tr key={key.id}><td><strong>{key.name}</strong><small className="mono">{key.prefix}…</small></td><td><small>{key.scopes.join(', ')}</small></td><td><span className={`status ${key.revoked ? 'canceled' : 'active'}`}>{key.revoked ? 'revoked' : 'active'}</span></td><td>{key.last_used_at ? new Date(key.last_used_at).toLocaleString() : 'Never'}</td><td>{new Date(key.created_at).toLocaleString()}</td><td>{!key.revoked && <button className="linkButton danger" disabled={busy === key.id} onClick={() => void revoke(key)}>Revoke</button>}</td></tr>)}</tbody></table>{!keys.length && <p className="empty">No API keys yet.</p>}</div></section>
  </section></main>;
}
