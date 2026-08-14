'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Summary = {
  currency: string;
  gross_volume: string;
  refunds: string;
  settled: string;
  merchant_payable: string;
  gateway_fee_balance: string;
  processor_clearing: string;
};
type Account = { id: string; code: string; name: string; currency: string; debits: string; credits: string; balance: string };
type Entry = {
  id: string;
  transaction_id: string;
  account: string;
  account_name: string;
  direction: string;
  amount: string;
  currency: string;
  reference_type: string;
  reference_id: string;
  created_at: string;
};

export default function FinancePage() {
  const [summary, setSummary] = useState<Summary[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ledger, setLedger] = useState<Entry[]>([]);
  const [message, setMessage] = useState('');

  async function load() {
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/dashboard/finance`, { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { window.location.href = '/'; return; }
      if (!response.ok) throw new Error(data.error?.message ?? `Request failed (${response.status})`);
      setSummary(data.summary ?? []);
      setAccounts(data.accounts ?? []);
      setLedger(data.ledger ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load finance data.');
    }
  }

  useEffect(() => { void load(); }, []);
  const money = (minor: string, currency: string) => new Intl.NumberFormat('en-LK', { style: 'currency', currency }).format(Number(minor) / 100);

  return <main className="moduleShell"><section className="modulePage">
    <header className="moduleHeader"><div><p className="eyebrow">Reconciliation</p><h1>Finance</h1><p className="muted">Ledger-backed balances, gateway fee revenue, merchant payable and recent journal entries. These figures come from immutable double-entry postings rather than browser-side fee calculations.</p></div><div className="moduleHeaderActions"><a className="secondary" href="/">Back to overview</a><button onClick={() => void load()}>Refresh</button></div></header>
    {message && <p className="moduleNotice">{message}</p>}

    {summary.map((row) => <section className="moduleCard" key={row.currency}><p className="eyebrow">{row.currency} position</p><h2>{row.currency} reconciliation</h2><div className="moduleGrid">
      <div className="moduleStat"><span>Gross processed</span><strong>{money(row.gross_volume,row.currency)}</strong></div>
      <div className="moduleStat"><span>Refunded</span><strong>{money(row.refunds,row.currency)}</strong></div>
      <div className="moduleStat"><span>Merchant payable</span><strong>{money(row.merchant_payable,row.currency)}</strong></div>
      <div className="moduleStat"><span>Gateway fees</span><strong>{money(row.gateway_fee_balance,row.currency)}</strong></div>
      <div className="moduleStat"><span>Processor clearing</span><strong>{money(row.processor_clearing,row.currency)}</strong></div>
      <div className="moduleStat"><span>Settled</span><strong>{money(row.settled,row.currency)}</strong></div>
    </div></section>)}

    <section className="moduleCard"><p className="eyebrow">Chart of accounts</p><h2>{accounts.length} ledger accounts</h2><div className="tableWrap"><table><thead><tr><th>Account</th><th>Currency</th><th>Debits</th><th>Credits</th><th>Balance</th></tr></thead><tbody>{accounts.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><small className="mono">{row.code}</small></td><td>{row.currency}</td><td>{money(row.debits,row.currency)}</td><td>{money(row.credits,row.currency)}</td><td><strong>{money(row.balance,row.currency)}</strong></td></tr>)}</tbody></table>{!accounts.length && <p className="empty">Ledger accounts appear after the first successful payment.</p>}</div></section>

    <section className="moduleCard"><p className="eyebrow">Journal</p><h2>Recent ledger entries</h2><div className="tableWrap"><table><thead><tr><th>Time</th><th>Transaction</th><th>Account</th><th>Direction</th><th>Amount</th><th>Reference</th></tr></thead><tbody>{ledger.map((row) => <tr key={row.id}><td>{new Date(row.created_at).toLocaleString()}</td><td><span className="mono">{row.transaction_id}</span></td><td><strong>{row.account_name}</strong><small className="mono">{row.account}</small></td><td><span className={`status ${row.direction}`}>{row.direction}</span></td><td>{money(row.amount,row.currency)}</td><td><span className="mono">{row.reference_type}:{row.reference_id}</span>{row.reference_type === 'payment' && <small><a href={`/finance/payments/${row.reference_id}`}>Payment breakdown</a></small>}</td></tr>)}</tbody></table>{!ledger.length && <p className="empty">No ledger entries yet.</p>}</div></section>
  </section></main>;
}
