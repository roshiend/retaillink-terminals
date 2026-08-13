'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Membership = {
  merchant: { id: string; name: string; country: string; currency: string };
  role: string;
  joined_at: string;
};

export default function MerchantsPage() {
  const [rows, setRows] = useState<Membership[]>([]);
  const [currentId, setCurrentId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const response = await fetch(`${API_URL}/auth/merchants`, { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { window.location.href = '/'; return; }
      if (!response.ok) throw new Error(data.error?.message ?? 'Could not load merchant accounts.');
      setRows(data.data ?? []);
      setCurrentId(data.current_merchant_id ?? '');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load merchant accounts.');
    }
  }

  useEffect(() => { void load(); }, []);

  async function switchMerchant(merchantId: string) {
    if (merchantId === currentId) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`${API_URL}/auth/switch_merchant`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ merchant_id: merchantId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message ?? 'Could not switch merchant account.');
      setCurrentId(data.merchant.id);
      setMessage(`Switched to ${data.merchant.name}. Opening the merchant console…`);
      window.setTimeout(() => { window.location.href = '/'; }, 500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not switch merchant account.');
      setBusy(false);
    }
  }

  return <main className="moduleShell"><section className="modulePage">
    <header className="moduleHeader"><div><p className="eyebrow">Account access</p><h1>Merchant accounts</h1><p className="muted">Switch between merchant businesses that your user account is authorised to access.</p></div><a className="secondary" href="/">Back to overview</a></header>
    {message && <p className="moduleNotice">{message}</p>}
    <section className="moduleCard"><p className="eyebrow">Memberships</p><h2>{rows.length} merchant accounts</h2><div className="moduleGrid two">{rows.map((row) => <article className="moduleStat" key={row.merchant.id}><div className="riskRuleSummary"><div><strong>{row.merchant.name}</strong><p>{row.merchant.country} · {row.merchant.currency} · joined {new Date(row.joined_at).toLocaleDateString()}</p></div><span className="roleBadge">{row.role}</span></div><code>{row.merchant.id}</code>{row.merchant.id === currentId ? <span className="status active">Current account</span> : <button disabled={busy} onClick={() => void switchMerchant(row.merchant.id)}>Switch to account</button>}</article>)}</div>{!rows.length && <p className="empty">No merchant memberships found.</p>}</section>
  </section></main>;
}
