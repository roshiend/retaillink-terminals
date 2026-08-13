'use client';

import { useEffect, useState, type FormEvent } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Customer = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
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
    try {
      const data = await request('/v1/customers');
      setCustomers(data.data ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load customers.');
    }
  }

  useEffect(() => { void load(); }, []);

  async function createCustomer(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const row = await request('/v1/customers', { method: 'POST', body: JSON.stringify({ name: name || undefined, email: email || undefined, phone: phone || undefined }) });
      setCustomers((rows) => [row, ...rows]);
      setName(''); setEmail(''); setPhone('');
      setMessage('Customer created.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create customer.');
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this sandbox customer?')) return;
    setBusy(true);
    try {
      await request(`/v1/customers/${id}`, { method: 'DELETE' });
      setCustomers((rows) => rows.filter((row) => row.id !== id));
      setMessage('Customer deleted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete customer.');
    } finally { setBusy(false); }
  }

  return <main className="moduleShell"><section className="modulePage">
    <header className="moduleHeader"><div><p className="eyebrow">Merchant data</p><h1>Customers</h1><p className="muted">Store reusable customer identity and metadata without storing payment card details.</p></div><div className="moduleHeaderActions"><a className="secondary" href="/">Back to overview</a><button disabled={busy} onClick={() => void load()}>Refresh</button></div></header>
    {message && <p className="moduleNotice">{message}</p>}
    <section className="moduleCard"><p className="eyebrow">New record</p><h2>Create customer</h2><form className="moduleForm" onSubmit={createCustomer}><label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nimal Perera" /></label><label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nimal@example.com" /></label><label>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+94 77 000 0000" /></label><button disabled={busy || (!name && !email && !phone)}>Create customer</button></form></section>
    <section className="moduleCard"><div className="panelTitle"><div><p className="eyebrow">Directory</p><h2>{customers.length} customers</h2></div></div><div className="tableWrap"><table><thead><tr><th>Customer</th><th>Email</th><th>Phone</th><th>Created</th><th></th></tr></thead><tbody>{customers.map((row) => <tr key={row.id}><td><strong>{row.name || 'Unnamed customer'}</strong><small className="mono">{row.id}</small></td><td>{row.email || '—'}</td><td>{row.phone || '—'}</td><td>{new Date(row.created_at).toLocaleString()}</td><td><button className="linkButton danger" disabled={busy} onClick={() => void remove(row.id)}>Delete</button></td></tr>)}</tbody></table>{!customers.length && <p className="empty">No customers yet.</p>}</div></section>
  </section></main>;
}
