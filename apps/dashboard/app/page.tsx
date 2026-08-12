'use client';

import { useEffect, useMemo, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type PaymentIntent = {
  id: string;
  amount: string;
  currency: string;
  status: string;
  merchant_reference?: string | null;
  description?: string | null;
  checkout_url: string;
  created_at: string;
};

type Payment = {
  id: string;
  payment_intent: string;
  amount: string;
  amount_refunded: string;
  currency: string;
  status: string;
  payment_method?: { brand?: string; last4?: string } | null;
  created_at: string;
};

export default function DashboardPage() {
  const [secretKey, setSecretKey] = useState('');
  const [connected, setConnected] = useState(false);
  const [intents, setIntents] = useState<PaymentIntent[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [amount, setAmount] = useState('5000.00');
  const [reference, setReference] = useState('ORDER-1001');
  const [description, setDescription] = useState('Demo order');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem('retaillink_demo_secret');
    if (stored) setSecretKey(stored);
  }, []);

  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secretKey}`,
        ...(options.headers ?? {}),
      },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message ?? `Request failed (${response.status})`);
    return data;
  }

  async function refresh() {
    if (!secretKey) return;
    setBusy(true);
    setMessage('');
    try {
      const [intentData, paymentData] = await Promise.all([
        request('/v1/payment_intents'),
        request('/v1/payments'),
      ]);
      setIntents(intentData.data ?? []);
      setPayments(paymentData.data ?? []);
      setConnected(true);
      window.localStorage.setItem('retaillink_demo_secret', secretKey);
    } catch (error) {
      setConnected(false);
      setMessage(error instanceof Error ? error.message : 'Unable to connect.');
    } finally {
      setBusy(false);
    }
  }

  async function createPaymentIntent(event: React.FormEvent) {
    event.preventDefault();
    const minorUnits = Math.round(Number(amount) * 100);
    if (!Number.isFinite(minorUnits) || minorUnits <= 0) {
      setMessage('Enter a valid positive amount.');
      return;
    }
    setBusy(true);
    try {
      const result = await request('/v1/payment_intents', {
        method: 'POST',
        headers: { 'idempotency-key': `dashboard-${Date.now()}` },
        body: JSON.stringify({
          amount: minorUnits,
          currency: 'LKR',
          merchant_reference: reference || undefined,
          description: description || undefined,
        }),
      });
      setMessage('Payment intent created. Open the checkout link to complete the sandbox payment.');
      setIntents((rows) => [result, ...rows]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create payment.');
    } finally {
      setBusy(false);
    }
  }

  async function refund(payment: Payment) {
    if (!window.confirm('Refund the remaining sandbox payment amount?')) return;
    setBusy(true);
    try {
      await request(`/v1/payments/${payment.id}/refunds`, { method: 'POST', body: '{}' });
      setMessage('Sandbox refund completed.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Refund failed.');
      setBusy(false);
    }
  }

  function forgetKey() {
    window.localStorage.removeItem('retaillink_demo_secret');
    setSecretKey('');
    setConnected(false);
    setIntents([]);
    setPayments([]);
  }

  const totals = useMemo(() => {
    const successful = payments.filter((payment) => ['succeeded', 'partially_refunded', 'refunded'].includes(payment.status));
    const gross = successful.reduce((sum, row) => sum + Number(row.amount), 0);
    const refunded = successful.reduce((sum, row) => sum + Number(row.amount_refunded), 0);
    return { gross, refunded, net: gross - refunded };
  }, [payments]);

  const money = (minor: number | string, currency = 'LKR') =>
    new Intl.NumberFormat('en-LK', { style: 'currency', currency }).format(Number(minor) / 100);

  return (
    <main className="dashboard">
      <header className="topbar">
        <div><strong>RETAILLINK</strong> TERMINALS <span className="badge">SANDBOX</span></div>
        {connected && <button className="secondary small" onClick={forgetKey}>Disconnect</button>}
      </header>

      <section className="content">
        <div className="heading">
          <div><p className="eyebrow">Merchant dashboard</p><h1>Payments overview</h1></div>
          {connected && <button className="secondary" disabled={busy} onClick={refresh}>Refresh</button>}
        </div>

        {!connected ? (
          <section className="panel connect">
            <h2>Connect your sandbox merchant</h2>
            <p>Run the database seed once, copy the generated <code>sk_test_...</code> key, and enter it below.</p>
            <label>Sandbox secret key<input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder="sk_test_..." /></label>
            <button disabled={busy || !secretKey} onClick={refresh}>{busy ? 'Connecting…' : 'Connect sandbox'}</button>
            {message && <p className="notice">{message}</p>}
          </section>
        ) : (
          <>
            <section className="metrics">
              <div className="metric"><span>Gross volume</span><strong>{money(totals.gross)}</strong></div>
              <div className="metric"><span>Refunded</span><strong>{money(totals.refunded)}</strong></div>
              <div className="metric"><span>Net collected</span><strong>{money(totals.net)}</strong></div>
              <div className="metric"><span>Payments</span><strong>{payments.length}</strong></div>
            </section>

            <section className="panel">
              <div className="panelTitle"><div><p className="eyebrow">Create test payment</p><h2>New payment intent</h2></div></div>
              <form className="createForm" onSubmit={createPaymentIntent}>
                <label>Amount (LKR)<input value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
                <label>Order reference<input value={reference} onChange={(e) => setReference(e.target.value)} /></label>
                <label>Description<input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
                <button disabled={busy}>Create payment</button>
              </form>
              {message && <p className="notice">{message}</p>}
            </section>

            <section className="panel">
              <div className="panelTitle"><div><p className="eyebrow">Checkout sessions</p><h2>Payment intents</h2></div></div>
              <div className="tableWrap">
                <table><thead><tr><th>Reference</th><th>Amount</th><th>Status</th><th>Created</th><th></th></tr></thead>
                  <tbody>{intents.map((row) => <tr key={row.id}>
                    <td><strong>{row.merchant_reference || '—'}</strong><small>{row.id}</small></td>
                    <td>{money(row.amount, row.currency)}</td>
                    <td><span className={`status ${row.status}`}>{row.status.replaceAll('_', ' ')}</span></td>
                    <td>{new Date(row.created_at).toLocaleString()}</td>
                    <td><a href={row.checkout_url} target="_blank" rel="noreferrer">Open checkout</a></td>
                  </tr>)}</tbody>
                </table>
                {!intents.length && <p className="empty">No payment intents yet.</p>}
              </div>
            </section>

            <section className="panel">
              <div className="panelTitle"><div><p className="eyebrow">Transactions</p><h2>Payments</h2></div></div>
              <div className="tableWrap">
                <table><thead><tr><th>Payment</th><th>Amount</th><th>Card</th><th>Status</th><th></th></tr></thead>
                  <tbody>{payments.map((row) => <tr key={row.id}>
                    <td><strong>{row.id}</strong><small>{new Date(row.created_at).toLocaleString()}</small></td>
                    <td>{money(row.amount, row.currency)}{Number(row.amount_refunded) > 0 && <small>Refunded {money(row.amount_refunded, row.currency)}</small>}</td>
                    <td>{row.payment_method ? `${row.payment_method.brand?.toUpperCase()} •••• ${row.payment_method.last4}` : '—'}</td>
                    <td><span className={`status ${row.status}`}>{row.status.replaceAll('_', ' ')}</span></td>
                    <td>{['succeeded', 'partially_refunded'].includes(row.status) && <button className="linkButton" disabled={busy} onClick={() => refund(row)}>Refund</button>}</td>
                  </tr>)}</tbody>
                </table>
                {!payments.length && <p className="empty">No payment attempts yet.</p>}
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
