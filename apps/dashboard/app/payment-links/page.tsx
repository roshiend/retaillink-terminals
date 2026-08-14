'use client';

import { useEffect, useState, type FormEvent } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type PaymentLink = {
  id: string;
  title: string;
  description: string | null;
  amount: string;
  currency: string;
  merchant_reference_prefix: string | null;
  active: boolean;
  url: string;
  created_at: string;
};

export default function PaymentLinksPage() {
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [title, setTitle] = useState('Online order');
  const [description, setDescription] = useState('Sandbox payment link');
  const [amount, setAmount] = useState('2500.00');
  const [referencePrefix, setReferencePrefix] = useState('ORDER');
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
      const data = await request('/v1/payment_links');
      setLinks(data.data ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load Payment Links.');
    }
  }

  useEffect(() => { void load(); }, []);

  async function createLink(event: FormEvent) {
    event.preventDefault();
    const minor = Math.round(Number(amount) * 100);
    if (!Number.isFinite(minor) || minor <= 0) return setMessage('Enter a valid amount.');
    setBusy(true); setMessage('');
    try {
      const row = await request('/v1/payment_links', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description: description || undefined,
          amount: minor,
          currency: 'LKR',
          merchant_reference_prefix: referencePrefix || undefined,
        }),
      });
      setLinks((items) => [row, ...items]);
      setMessage('Payment Link created. Copy its public URL and share it with a sandbox customer.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create Payment Link.');
    } finally { setBusy(false); }
  }

  async function setActive(row: PaymentLink, active: boolean) {
    setBusy(true); setMessage('');
    try {
      const updated = await request(`/v1/payment_links/${row.id}/state`, { method: 'POST', body: JSON.stringify({ active }) });
      setLinks((items) => items.map((item) => item.id === row.id ? updated : item));
      setMessage(active ? 'Payment Link reactivated.' : 'Payment Link disabled. Existing payments are not changed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not change Payment Link state.');
    } finally { setBusy(false); }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setMessage('Payment Link copied to clipboard.');
    } catch {
      setMessage(url);
    }
  }

  const money = (minor: string, currency: string) => new Intl.NumberFormat('en-LK', { style: 'currency', currency }).format(Number(minor) / 100);

  return <main className="moduleShell"><section className="modulePage">
    <header className="moduleHeader"><div><p className="eyebrow">Hosted commerce</p><h1>Payment Links</h1><p className="muted">Create reusable sandbox payment URLs. Opening a link does not create a transaction; a Payment Intent is created only when the customer continues to checkout.</p></div><div className="moduleHeaderActions"><a className="secondary" href="/">Back to overview</a><button disabled={busy} onClick={() => void load()}>Refresh</button></div></header>
    {message && <p className="moduleNotice">{message}</p>}
    <section className="moduleCard"><p className="eyebrow">New hosted link</p><h2>Create Payment Link</h2><form className="moduleForm" onSubmit={createLink}>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required /></label>
      <label>Description<input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} /></label>
      <label>Amount (LKR)<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required /></label>
      <label>Reference prefix<input value={referencePrefix} onChange={(e) => setReferencePrefix(e.target.value)} maxLength={80} /></label>
      <button disabled={busy}>Create Payment Link</button>
    </form></section>
    <section className="moduleCard"><div className="panelTitle"><div><p className="eyebrow">Reusable checkout URLs</p><h2>{links.length} links</h2></div></div><div className="tableWrap"><table><thead><tr><th>Link</th><th>Amount</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>{links.map((row) => <tr key={row.id}><td><strong>{row.title}</strong><small>{row.description || '—'}</small><small className="mono">{row.url}</small></td><td>{money(row.amount,row.currency)}</td><td><span className={`status ${row.active ? 'active' : 'canceled'}`}>{row.active ? 'active' : 'disabled'}</span></td><td>{new Date(row.created_at).toLocaleString()}</td><td className="billingActions"><button className="linkButton" onClick={() => void copy(row.url)}>Copy</button><a href={row.url} target="_blank" rel="noreferrer">Open</a>{row.active ? <button className="linkButton danger" disabled={busy} onClick={() => void setActive(row,false)}>Disable</button> : <button className="linkButton" disabled={busy} onClick={() => void setActive(row,true)}>Reactivate</button>}</td></tr>)}</tbody></table>{!links.length && <p className="empty">No Payment Links yet.</p>}</div></section>
  </section></main>;
}
