'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Finance = {
  payment: string;
  currency: string;
  gross: string;
  gross_refunded: string;
  original_fee: string;
  fee_reversed: string;
  fee_retained: string;
  original_merchant_net: string;
  merchant_net_reversed: string;
  merchant_net_remaining: string;
  refunds: Array<{ id: string; amount: string; reason: string | null; created_at: string }>;
  ledger: Array<{ id: string; transaction_id: string; account: string; account_name: string; direction: string; amount: string; reference_type: string; reference_id: string; created_at: string }>;
};

export default function PaymentFinancePage({ params }: { params: Promise<{ id: string }> }) {
  const [data, setData] = useState<Finance | null>(null);
  const [message, setMessage] = useState('Loading payment finance…');

  useEffect(() => {
    let active = true;
    params.then(async ({ id }) => {
      try {
        const response = await fetch(`${API_URL}/dashboard/payments/${encodeURIComponent(id)}/finance`, { credentials: 'include' });
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) { window.location.href = '/'; return; }
        if (!response.ok) throw new Error(body.error?.message ?? `Request failed (${response.status})`);
        if (active) { setData(body); setMessage(''); }
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'Could not load payment finance.');
      }
    });
    return () => { active = false; };
  }, [params]);

  if (!data) return <main className="moduleShell"><section className="modulePage"><p className="moduleNotice">{message}</p></section></main>;
  const money = (minor: string) => new Intl.NumberFormat('en-LK', { style: 'currency', currency: data.currency }).format(Number(minor) / 100);

  return <main className="moduleShell"><section className="modulePage">
    <header className="moduleHeader"><div><p className="eyebrow">Payment reconciliation</p><h1>Payment finance</h1><p className="mono">{data.payment}</p></div><div className="moduleHeaderActions"><a className="secondary" href="/finance">Back to Finance</a></div></header>
    <section className="moduleCard"><div className="moduleGrid">
      <div className="moduleStat"><span>Gross</span><strong>{money(data.gross)}</strong></div>
      <div className="moduleStat"><span>Gross refunded</span><strong>{money(data.gross_refunded)}</strong></div>
      <div className="moduleStat"><span>Original gateway fee</span><strong>{money(data.original_fee)}</strong></div>
      <div className="moduleStat"><span>Fee reversed</span><strong>{money(data.fee_reversed)}</strong></div>
      <div className="moduleStat"><span>Fee retained</span><strong>{money(data.fee_retained)}</strong></div>
      <div className="moduleStat"><span>Merchant net remaining</span><strong>{money(data.merchant_net_remaining)}</strong></div>
    </div></section>
    <section className="moduleCard"><p className="eyebrow">Refunds</p><h2>{data.refunds.length} refunds</h2><div className="tableWrap"><table><thead><tr><th>Refund</th><th>Amount</th><th>Reason</th><th>Created</th></tr></thead><tbody>{data.refunds.map((row) => <tr key={row.id}><td className="mono">{row.id}</td><td>{money(row.amount)}</td><td>{row.reason || '—'}</td><td>{new Date(row.created_at).toLocaleString()}</td></tr>)}</tbody></table>{!data.refunds.length && <p className="empty">No refunds for this payment.</p>}</div></section>
    <section className="moduleCard"><p className="eyebrow">Double-entry trace</p><h2>Ledger postings</h2><div className="tableWrap"><table><thead><tr><th>Transaction</th><th>Account</th><th>Direction</th><th>Amount</th><th>Reference</th></tr></thead><tbody>{data.ledger.map((row) => <tr key={row.id}><td className="mono">{row.transaction_id}</td><td><strong>{row.account_name}</strong><small className="mono">{row.account}</small></td><td>{row.direction}</td><td>{money(row.amount)}</td><td className="mono">{row.reference_type}:{row.reference_id}</td></tr>)}</tbody></table></div></section>
  </section></main>;
}
