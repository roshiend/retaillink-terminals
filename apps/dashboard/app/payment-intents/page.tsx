'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Me = { role: string };
type Intent = {
  id: string;
  amount: string;
  currency: string;
  status: string;
  customer?: string | null;
  merchant_reference: string | null;
  description: string | null;
  checkout_url: string;
  created_at: string;
};

export default function PaymentIntentsPage() {
  const [intents, setIntents] = useState<Intent[]>([]);
  const [role, setRole] = useState('VIEWER');
  const [busyId, setBusyId] = useState('');
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
      const [me, result] = await Promise.all([request('/auth/me'), request('/v1/payment_intents')]);
      setRole((me as Me).role ?? 'VIEWER');
      setIntents(result.data ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load Payment Intents.');
    }
  }

  useEffect(() => { void load(); }, []);

  async function cancel(intent: Intent) {
    if (!window.confirm('Cancel this unpaid Payment Intent? Its hosted checkout will stop accepting payment.')) return;
    setBusyId(intent.id); setMessage('');
    try {
      await request(`/v1/payment_intents/${intent.id}/cancel`, { method: 'POST', body: '{}' });
      setMessage('Payment Intent canceled.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not cancel Payment Intent.');
    } finally { setBusyId(''); }
  }

  const money = (minor: string, currency: string) => new Intl.NumberFormat('en-LK', { style: 'currency', currency }).format(Number(minor) / 100);
  const canCancel = ['OWNER', 'ADMIN', 'DEVELOPER'].includes(role);
  const cancelable = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action', 'failed']);

  return <main className="moduleShell"><section className="modulePage">
    <header className="moduleHeader"><div><p className="eyebrow">Payments</p><h1>Payment Intents</h1><p className="muted">Inspect the payment lifecycle before it becomes a successful payment. Open hosted checkout or cancel eligible unpaid intents.</p></div><div className="moduleHeaderActions"><a className="secondary" href="/">Back to overview</a><button onClick={() => void load()}>Refresh</button></div></header>
    {message && <p className="moduleNotice">{message}</p>}
    {!canCancel && <p className="moduleWarning">Your {role} role can inspect Payment Intents but cannot cancel them.</p>}
    <section className="moduleCard"><div className="panelTitle"><div><p className="eyebrow">Lifecycle records</p><h2>{intents.length} intents</h2></div></div><div className="tableWrap"><table><thead><tr><th>Intent</th><th>Amount</th><th>Status</th><th>Reference</th><th>Customer</th><th>Created</th><th></th></tr></thead><tbody>{intents.map((row) => <tr key={row.id}>
      <td><strong className="mono">{row.id}</strong><small>{row.description || '—'}</small></td>
      <td>{money(row.amount,row.currency)}</td>
      <td><span className={`status ${row.status}`}>{row.status}</span></td>
      <td>{row.merchant_reference || '—'}</td>
      <td><span className="mono">{row.customer || '—'}</span></td>
      <td>{new Date(row.created_at).toLocaleString()}</td>
      <td className="billingActions">{cancelable.has(row.status) && <a href={row.checkout_url} target="_blank" rel="noreferrer">Open checkout</a>}{canCancel && cancelable.has(row.status) && <button className="linkButton danger" disabled={busyId === row.id} onClick={() => void cancel(row)}>{busyId === row.id ? 'Canceling…' : 'Cancel'}</button>}</td>
    </tr>)}</tbody></table>{!intents.length && <p className="empty">No Payment Intents yet.</p>}</div></section>
  </section></main>;
}
