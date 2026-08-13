'use client';

import { useEffect, useMemo, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Payment = { id: string; amount: string; amount_refunded: string; currency: string; status: string; created_at: string };
type Customer = { id: string; created_at: string };
type Subscription = { id: string; amount: string; currency: string; status: string; created_at: string };
type Invoice = { id: string; amount_due: string; amount_paid: string; currency: string; status: string; created_at: string };
type Settlement = { id: string; amount: string; currency: string; status: string; created_at: string };

export default function AnalyticsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [balance, setBalance] = useState('0');
  const [currency, setCurrency] = useState('LKR');
  const [message, setMessage] = useState('');

  async function request(path: string) {
    const response = await fetch(`${API_URL}${path}`, { credentials: 'include' });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { window.location.href = '/'; throw new Error('Sign in required.'); }
    if (!response.ok) throw new Error(data.error?.message ?? `Request failed (${response.status})`);
    return data;
  }

  async function load() {
    setMessage('');
    try {
      const [paymentData, customerData, subscriptionData, invoiceData, settlementData, balanceData] = await Promise.all([
        request('/v1/payments'), request('/v1/customers'), request('/v1/subscriptions'), request('/v1/invoices'), request('/v1/settlements'), request('/v1/balance'),
      ]);
      setPayments(paymentData.data ?? []);
      setCustomers(customerData.data ?? []);
      setSubscriptions(subscriptionData.data ?? []);
      setInvoices(invoiceData.data ?? []);
      setSettlements(settlementData.data ?? []);
      setBalance(balanceData.available ?? '0');
      setCurrency(balanceData.currency ?? 'LKR');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load analytics.');
    }
  }

  useEffect(() => { void load(); }, []);

  const metrics = useMemo(() => {
    const successful = payments.filter((row) => ['succeeded','partially_refunded','refunded'].includes(row.status));
    const gross = successful.reduce((sum,row) => sum + Number(row.amount), 0);
    const refunded = successful.reduce((sum,row) => sum + Number(row.amount_refunded), 0);
    const paidInvoices = invoices.filter((row) => row.status === 'paid');
    const invoicePaid = paidInvoices.reduce((sum,row) => sum + Number(row.amount_paid), 0);
    const openInvoiceValue = invoices.filter((row) => row.status === 'open').reduce((sum,row) => sum + Number(row.amount_due), 0);
    const succeededAttempts = payments.filter((row) => ['succeeded','partially_refunded','refunded'].includes(row.status)).length;
    const attempted = payments.length;
    const successRate = attempted ? (succeededAttempts / attempted) * 100 : 0;
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const recentGross = successful.filter((row) => now - new Date(row.created_at).getTime() <= thirtyDays).reduce((sum,row) => sum + Number(row.amount),0);
    return {
      gross, refunded, net: gross - refunded, successRate, recentGross, invoicePaid, openInvoiceValue,
      activeSubscriptions: subscriptions.filter((row) => row.status === 'active').length,
      paidInvoices: paidInvoices.length,
      openInvoices: invoices.filter((row) => row.status === 'open').length,
      paidSettlements: settlements.filter((row) => row.status === 'paid').reduce((sum,row) => sum + Number(row.amount),0),
    };
  }, [payments, subscriptions, invoices, settlements]);

  const money = (minor: number | string, cur = currency) => new Intl.NumberFormat('en-LK',{ style:'currency', currency: cur }).format(Number(minor)/100);

  function exportPayments() {
    const header = ['payment_id','status','amount_minor','refunded_minor','currency','created_at'];
    const rows = payments.map((row) => [row.id,row.status,row.amount,row.amount_refunded,row.currency,row.created_at]);
    const escape = (value: string) => `"${value.replaceAll('"','""')}"`;
    const csv = [header,...rows].map((row) => row.map((value) => escape(String(value))).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `retaillink-payments-${new Date().toISOString().slice(0,10)}.csv`; anchor.click();
    URL.revokeObjectURL(url);
  }

  return <main className="moduleShell"><section className="modulePage">
    <header className="moduleHeader"><div><p className="eyebrow">Reports</p><h1>Analytics</h1><p className="muted">Operational sandbox metrics calculated from the current merchant's payment, customer, invoice and settlement records.</p></div><div className="moduleHeaderActions"><a className="secondary" href="/console">Console</a><button onClick={() => void load()}>Refresh</button><button onClick={exportPayments} disabled={!payments.length}>Export payments CSV</button></div></header>
    {message && <p className="moduleNotice">{message}</p>}
    <section className="moduleGrid analyticsGrid">
      <div className="moduleStat"><span>Available balance</span><strong>{money(balance)}</strong></div>
      <div className="moduleStat"><span>Gross processed</span><strong>{money(metrics.gross)}</strong></div>
      <div className="moduleStat"><span>Net after refunds</span><strong>{money(metrics.net)}</strong></div>
      <div className="moduleStat"><span>Refunded</span><strong>{money(metrics.refunded)}</strong></div>
      <div className="moduleStat"><span>30-day gross</span><strong>{money(metrics.recentGross)}</strong></div>
      <div className="moduleStat"><span>Payment success rate</span><strong>{metrics.successRate.toFixed(1)}%</strong></div>
      <div className="moduleStat"><span>Customers</span><strong>{customers.length}</strong></div>
      <div className="moduleStat"><span>Active subscriptions</span><strong>{metrics.activeSubscriptions}</strong></div>
      <div className="moduleStat"><span>Open invoices</span><strong>{metrics.openInvoices}</strong><small>{money(metrics.openInvoiceValue)} outstanding</small></div>
      <div className="moduleStat"><span>Paid invoices</span><strong>{metrics.paidInvoices}</strong><small>{money(metrics.invoicePaid)} collected</small></div>
      <div className="moduleStat"><span>Settled</span><strong>{money(metrics.paidSettlements)}</strong></div>
      <div className="moduleStat"><span>Payment attempts</span><strong>{payments.length}</strong></div>
    </section>
    <section className="moduleCard"><p className="eyebrow">Interpretation</p><h2>Sandbox metrics only</h2><p className="muted">These figures describe simulated Retaillink activity. They are useful for testing dashboards, business logic and reconciliation workflows, but they do not represent real processed funds or bank settlement.</p></section>
  </section></main>;
}
