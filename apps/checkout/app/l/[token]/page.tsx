'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type PublicLink = {
  title: string;
  description: string | null;
  amount: string;
  currency: string;
  merchant_name: string;
  active: boolean;
};

function browserIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `plink-browser-${crypto.randomUUID()}`;
  return `plink-browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function PaymentLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState('');
  const [link, setLink] = useState<PublicLink | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'starting' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const checkoutKey = useRef(browserIdempotencyKey());

  useEffect(() => {
    params.then(({ token: value }) => setToken(value));
  }, [params]);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/public/payment_links/${token}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error?.message ?? 'This payment link is unavailable.');
        return data;
      })
      .then((data) => {
        setLink(data);
        setStatus('ready');
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : 'This payment link is unavailable.');
        setStatus('error');
      });
  }, [token]);

  const amount = useMemo(() => {
    if (!link) return '';
    return new Intl.NumberFormat('en-LK', { style: 'currency', currency: link.currency }).format(Number(link.amount) / 100);
  }, [link]);

  async function continueToCheckout() {
    if (!token || status === 'starting') return;
    setStatus('starting');
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/public/payment_links/${token}/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': checkoutKey.current },
        body: '{}',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message ?? 'Could not start checkout.');
      window.location.assign(data.checkout_url);
    } catch (error) {
      setStatus('ready');
      setMessage(error instanceof Error ? error.message : 'Could not start checkout.');
    }
  }

  if (status === 'loading') return <main className="shell"><section className="card">Loading payment link…</section></main>;
  if (status === 'error' || !link) return <main className="shell"><section className="card"><div className="brand">RETAILLINK <span>TERMINALS</span></div><div className="sandbox">SANDBOX</div><h1>Payment link unavailable</h1><p className="muted">{message}</p></section></main>;

  return <main className="shell"><section className="card">
    <div className="brand">RETAILLINK <span>TERMINALS</span></div>
    <div className="sandbox">SANDBOX — NO REAL MONEY</div>
    <p className="muted">Paying</p>
    <h1>{link.merchant_name}</h1>
    <p className="muted">{link.title}</p>
    {link.description && <p className="reference">{link.description}</p>}
    <div className="amount">{amount}</div>
    {message && <div className="error" role="alert">{message}</div>}
    <button onClick={continueToCheckout} disabled={status === 'starting'}>{status === 'starting' ? 'Starting checkout…' : 'Continue to payment'}</button>
    <p className="warning">This is a sandbox Payment Link. The next page accepts documented test card numbers only.</p>
  </section></main>;
}
