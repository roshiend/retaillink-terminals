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
};

export default function CheckoutPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [cardNumber, setCardNumber] = useState('4242424242424242');
  const [expiry, setExpiry] = useState('12/30');
  const [cvc, setCvc] = useState('123');
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const [actionToken, setActionToken] = useState<string | null>(null);

  useEffect(() => {
    params.then(({ token: value }) => setToken(value));
  }, [params]);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/checkout/${token}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Checkout session not found.');
        return response.json();
      })
      .then((data) => {
        setSession(data);
        setStatus(data.status === 'succeeded' ? 'succeeded' : 'ready');
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
    const response = await fetch(`${API_URL}/checkout/${token}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ card_number: cardNumber, expiry, cvc }),
    });
    const data = await response.json();

    if (data.status === 'requires_action') {
      setActionToken(data.action_token);
      setStatus('requires_action');
      return;
    }
    if (!response.ok) {
      setStatus('ready');
      setMessage(data.error?.message ?? 'Payment failed.');
      return;
    }
    setStatus('succeeded');
  }

  async function complete3ds() {
    if (!actionToken) return;
    setStatus('processing');
    const response = await fetch(`${API_URL}/checkout/${token}/3ds/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action_token: actionToken }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus('requires_action');
      setMessage(data.error?.message ?? '3DS simulation failed.');
      return;
    }
    setStatus('succeeded');
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
            <button onClick={complete3ds}>Complete test authentication</button>
          </div>
        ) : (
          <form onSubmit={pay}>
            <label>Card number<input value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} autoComplete="off" /></label>
            <div className="row">
              <label>Expiry<input value={expiry} onChange={(e) => setExpiry(e.target.value)} autoComplete="off" /></label>
              <label>CVC<input value={cvc} onChange={(e) => setCvc(e.target.value)} autoComplete="off" /></label>
            </div>
            {message && <div className="error">{message}</div>}
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
