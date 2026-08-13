'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Customer = { id: string; name: string | null; email: string | null };
type Invoice = {
  id: string;
  customer: string;
  subscription: string | null;
  payment_intent: string | null;
  amount_due: string;
  amount_paid: string;
  currency: string;
  status: string;
  description: string | null;
  period_start: string;
  period_end: string;
  checkout_url: string | null;
  created_at: string;
};
type Subscription = {
  id: string;
  customer: string;
  amount: string;
  currency: string;
  interval: string;
  interval_count: number;
  description: string | null;
  status: string;
  current_period_start: string;
  current_period_end: string;
  next_billing_at: string;
  cancel_at_period_end: boolean;
  latest_invoice: Invoice | null;
  created_at: string;
};

export default function BillingPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [amount, setAmount] = useState('2500.00');
  const [interval, setInterval] = useState('month');
  const [intervalCount, setIntervalCount] = useState('1');
  const [description, setDescription] = useState('Sandbox membership');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

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
      const [customerData, subscriptionData, invoiceData] = await Promise.all([
        request('/v1/customers'),
        request('/v1/subscriptions'),
        request('/v1/invoices'),
      ]);
      const customerRows = customerData.data ?? [];
      setCustomers(customerRows);
      setSubscriptions(subscriptionData.data ?? []);
      setInvoices(invoiceData.data ?? []);
      setCustomerId((current) => current || customerRows[0]?.id || '');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load billing data.');
    }
  }

  useEffect(() => { void load(); }, []);

  async function createSubscription(event: FormEvent) {
    event.preventDefault();
    const minorUnits = Math.round(Number(amount) * 100);
    const count = Number(intervalCount);
    if (!customerId) return setMessage('Create or select a customer first.');
    if (!Number.isFinite(minorUnits) || minorUnits <= 0) return setMessage('Enter a valid amount.');
    if (!Number.isInteger(count) || count < 1 || count > 36) return setMessage('Interval count must be between 1 and 36.');

    setBusy(true); setMessage('');
    try {
      const created = await request('/v1/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          customer: customerId,
          amount: minorUnits,
          currency: 'LKR',
          interval,
          interval_count: count,
          description: description || undefined,
        }),
      });
      await load();
      setMessage(`Subscription created. Invoice ${created.latest_invoice?.id ?? ''} is ready for sandbox checkout.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create subscription.');
    } finally { setBusy(false); }
  }

  async function runCycle(id: string) {
    if (!window.confirm('Generate the next sandbox billing cycle now? This simulates the scheduler.')) return;
    setBusy(true); setMessage('');
    try {
      const result = await request(`/v1/subscriptions/${id}/run_cycle`, { method: 'POST', body: '{}' });
      await load();
      setMessage(result.result === 'invoice_generated' ? 'Next sandbox invoice generated.' : 'Subscription canceled at the end of its period.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not run billing cycle.');
    } finally { setBusy(false); }
  }

  async function cancel(id: string, atPeriodEnd: boolean) {
    const wording = atPeriodEnd ? 'cancel at the end of the current period' : 'cancel immediately';
    if (!window.confirm(`Are you sure you want to ${wording}?`)) return;
    setBusy(true); setMessage('');
    try {
      await request(`/v1/subscriptions/${id}/cancel`, { method: 'POST', body: JSON.stringify({ at_period_end: atPeriodEnd }) });
      await load();
      setMessage(atPeriodEnd ? 'Subscription will cancel at period end.' : 'Subscription canceled immediately.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not cancel subscription.');
    } finally { setBusy(false); }
  }

  async function voidInvoice(id: string) {
    if (!window.confirm('Void this unpaid invoice? Its hosted checkout will become unusable.')) return;
    setBusy(true); setMessage('');
    try {
      await request(`/v1/invoices/${id}/void`, { method: 'POST', body: '{}' });
      await load();
      setMessage('Invoice voided.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not void invoice.');
    } finally { setBusy(false); }
  }

  const customerById = useMemo(() => new Map(customers.map((row) => [row.id, row])), [customers]);
  const money = (minor: string, currency = 'LKR') => new Intl.NumberFormat('en-LK', { style: 'currency', currency }).format(Number(minor) / 100);

  return <main className="moduleShell"><section className="modulePage">
    <header className="moduleHeader"><div><p className="eyebrow">Recurring payments</p><h1>Billing</h1><p className="muted">Subscriptions create invoices and hosted checkout links. This sandbox never silently reuses or stores a real card.</p></div><div className="moduleHeaderActions"><a className="secondary" href="/">Back to overview</a><button disabled={busy} onClick={() => void load()}>Refresh</button></div></header>
    <p className="moduleNotice"><strong>Sandbox scheduler:</strong> use “Run next cycle” to simulate the next billing date. Each new invoice still requires the customer to complete hosted checkout.</p>
    {message && <p className="moduleNotice">{message}</p>}

    <section className="moduleCard"><p className="eyebrow">New recurring schedule</p><h2>Create subscription</h2>
      {customers.length ? <form className="moduleForm" onSubmit={createSubscription}>
        <label>Customer<select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>{customers.map((row) => <option key={row.id} value={row.id}>{row.name || row.email || row.id}</option>)}</select></label>
        <label>Amount (LKR)<input value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label>Interval<div className="billingInterval"><input value={intervalCount} onChange={(e) => setIntervalCount(e.target.value)} /><select value={interval} onChange={(e) => setInterval(e.target.value)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="year">Year</option></select></div></label>
        <label>Description<input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <button disabled={busy}>Create subscription</button>
      </form> : <p className="empty">Create a customer first in the Customers module before creating a subscription.</p>}
    </section>

    <section className="moduleCard"><div className="panelTitle"><div><p className="eyebrow">Recurring schedules</p><h2>{subscriptions.length} subscriptions</h2></div></div><div className="tableWrap"><table><thead><tr><th>Customer</th><th>Plan</th><th>Status</th><th>Next billing</th><th>Latest invoice</th><th></th></tr></thead><tbody>{subscriptions.map((row) => {
      const customer = customerById.get(row.customer);
      return <tr key={row.id}><td><strong>{customer?.name || customer?.email || row.customer}</strong><small className="mono">{row.id}</small></td><td>{money(row.amount,row.currency)}<small>every {row.interval_count > 1 ? `${row.interval_count} ` : ''}{row.interval}{row.interval_count > 1 ? 's' : ''}</small></td><td><span className={`status ${row.status}`}>{row.status}</span>{row.cancel_at_period_end && <small>Cancels at period end</small>}</td><td>{new Date(row.next_billing_at).toLocaleString()}</td><td>{row.latest_invoice ? <><span className={`status ${row.latest_invoice.status}`}>{row.latest_invoice.status}</span>{row.latest_invoice.checkout_url && row.latest_invoice.status === 'open' && <small><a href={row.latest_invoice.checkout_url} target="_blank" rel="noreferrer">Open checkout</a></small>}</> : '—'}</td><td className="billingActions">{row.status === 'active' && !row.cancel_at_period_end && <><button className="linkButton" disabled={busy} onClick={() => void runCycle(row.id)}>Run next cycle</button><button className="linkButton" disabled={busy} onClick={() => void cancel(row.id,true)}>Cancel at period end</button><button className="linkButton danger" disabled={busy} onClick={() => void cancel(row.id,false)}>Cancel now</button></>}</td></tr>;
    })}</tbody></table>{!subscriptions.length && <p className="empty">No subscriptions yet.</p>}</div></section>

    <section className="moduleCard"><p className="eyebrow">Billing documents</p><h2>{invoices.length} invoices</h2><div className="tableWrap"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Amount</th><th>Status</th><th>Period</th><th></th></tr></thead><tbody>{invoices.map((row) => {
      const customer = customerById.get(row.customer);
      return <tr key={row.id}><td><strong className="mono">{row.id}</strong><small>{new Date(row.created_at).toLocaleString()}</small></td><td>{customer?.name || customer?.email || row.customer}</td><td>{money(row.amount_due,row.currency)}{Number(row.amount_paid) > 0 && <small>Paid {money(row.amount_paid,row.currency)}</small>}</td><td><span className={`status ${row.status}`}>{row.status}</span></td><td>{new Date(row.period_start).toLocaleDateString()}<small>to {new Date(row.period_end).toLocaleDateString()}</small></td><td className="billingActions">{row.status === 'open' && row.checkout_url && <a href={row.checkout_url} target="_blank" rel="noreferrer">Open checkout</a>}{row.status === 'open' && <button className="linkButton danger" disabled={busy} onClick={() => void voidInvoice(row.id)}>Void</button>}</td></tr>;
    })}</tbody></table>{!invoices.length && <p className="empty">No invoices yet.</p>}</div></section>
  </section></main>;
}
