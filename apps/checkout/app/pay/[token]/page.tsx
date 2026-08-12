'use client';

import { useEffect, useMemo, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Session = {
  id: string;
  merchant_name: string;
  amount: string;
  currency: string;
  description?: string | null;
  merchant_reference?: string | null;
  status: string;
  action_token?: string | null;
};

async function checkoutRequest(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (options.body != null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message ?? `Checkout request failed (${response.status}).`);
  }
  return data;
}

export default function CheckoutPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [cardNumber, setCardNumber] = useState('4242424242424242');
  const [expiry, setExpiry] = useState('12/30');
  const [cvc, setCvc] = useState('123');
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const [actionToken, setActionToken] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    params.then(({ token: value }) => setToken(value));
  }, [params]);

  useEffect(() => {
    if (!token) return;
    checkoutRequest(`/checkout/${token}`)
      .then((data) => {
        setSession(data);
        setActionToken(data.action_token ?? null);
        setStatus(data.status === 'succeeded' ? 'succeeded' : data.status === 'requires_action' ? 'requires_action' : 'ready');
      })
      .catch((error) => {
        setMessage(error.message);
        setStatus('error');
      });
  }, [token]);

  const formattedAmount = useMemo(() => {
    if (!session) return '';
    return new Intl.NumberFormat('en-LK', {
      style: 'currency',
      currency: session.currency,
      minimumFractionDigits: 2,
    }).format(Number(session.amount) / 100);
  }, [session]);

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    setStatus('processing');
    setMessage('');
    try {
      const data = await checkoutRequest(`/checkout/${token}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ card_number: cardNumber, expiry, cvc }),
      });
      if (data.status === 'requires_action') {
        setActionToken(data.action_token);
        setStatus('requires_action');
        return;
      }
      setStatus('succeeded');
    } catch (error) {
      setStatus('ready');
      setMessage(error instanceof Error ? error.message : 'Payment failed.');
    }
  }

  async function complete3ds() {
    if (!actionToken) return;
    setActionBusy(true);
    setMessage('');
    try {
      await checkoutRequest(`/checkout/${token}/3ds/complete`, {
        method: 'POST',
        body: JSON.stringify({ action_token: actionToken }),
      });
      setStatus('succeeded');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '3DS simulation failed.');
    } finally {
      setActionBusy(false);
    }
  }

  if (status === 'loading') return <main className="shell"><div className="card">Loading checkout…</div></main>;
  if (status === 'error' || !session) return <main className="shell"><div className="card"><h1>Checkout unavailable</h1><p>{message}</p></div></main>;

  return (
    <main className="shell">
      <section className="card">
        <div className="brand">RETAILLINK <span>TERMINALS</span></div>
        <div className="sandbox">SANDBOX — TEST CARDS ONLY</div>
        <h1>{session.merchant_name}</h1>
        <p className="muted">{session.description || 'Online payment'}</p>
        {session.merchant_reference && <p className="reference">Reference: {session.merchant_reference}</p>}
        <div className="amount">{formattedAmount}</div>

        {status === 'succeeded' ? (
          <div className="success"><strong>Payment successful</strong><p>This was a sandbox transaction. No money moved.</p></div>
        ) : status === 'requires_action' ? (
          <div className="threeDs">
            <h2>Demo 3D Secure</h2>
            <p>In production this step would be handled by the card issuer. Click below to simulate successful authentication.</p>
            {message && <div className="error" role="alert">{message}</div>}
            <button onClick={complete3ds} disabled={actionBusy}>{actionBusy ? 'Completing…' : 'Complete test authentication'}</button>
          </div>
        ) : (
          <form onSubmit={pay}>
            <label>Card number<input value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} autoComplete="off" /></label>
            <div className="row">
              <label>Expiry<input value={expiry} onChange={(e) => setExpiry(e.target.value)} autoComplete="off" /></label>
              <label>CVC<input value={cvc} onChange={(e) => setCvc(e.target.value)} autoComplete="off" /></label>
            </div>
            {message && <div className="error" role="alert">{message}</div>}
            <button disabled={status === 'processing'}>{status === 'processing' ? 'Processing…' : `Pay ${formattedAmount}`}</button>
          </form>
        )}

        <div className="testCards">
          <strong>Test cards</strong>
          <code>4242 4242 4242 4242 — success</code>
          <code>4000 0000 0000 0002 — decline</code>
          <code>4000 0025 0000 3155 — demo 3DS</code>
        </div>
        <p className="warning">Never enter a real card number on this sandbox page.</p>
      </section>
    </main>
  );
}
