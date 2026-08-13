'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Me = {
  user: { email: string };
  merchant: { id: string; name: string; country: string; currency: string };
  role: string;
};

type Counts = {
  payments: number;
  customers: number;
  subscriptions: number;
  failedWebhooks: number;
};

export default function ConsolePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [counts, setCounts] = useState<Counts>({ payments: 0, customers: 0, subscriptions: 0, failedWebhooks: 0 });
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const request = async (path: string) => {
          const response = await fetch(`${API_URL}${path}`, { credentials: 'include' });
          const data = await response.json().catch(() => ({}));
          if (response.status === 401) { window.location.href = '/'; throw new Error('Sign in required.'); }
          if (!response.ok) throw new Error(data.error?.message ?? `Request failed (${response.status})`);
          return data;
        };
        const [current, payments, customers, subscriptions, webhooks] = await Promise.all([
          request('/auth/me'),
          request('/v1/payments'),
          request('/v1/customers'),
          request('/v1/subscriptions'),
          request('/v1/webhook_deliveries'),
        ]);
        if (!active) return;
        setMe(current);
        setCounts({
          payments: payments.data?.length ?? 0,
          customers: customers.data?.length ?? 0,
          subscriptions: subscriptions.data?.length ?? 0,
          failedWebhooks: (webhooks.data ?? []).filter((row: { status: string }) => row.status === 'failed').length,
        });
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'Could not load console.');
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  const modules = [
    { href: '/', title: 'Payments', text: 'Create Payment Intents, inspect transactions, refunds, settlements, API keys and webhooks.', badge: `${counts.payments} payment attempts` },
    { href: '/customers', title: 'Customers', text: 'Manage reusable customer identity and metadata without storing card details.', badge: `${counts.customers} customers` },
    { href: '/billing', title: 'Recurring Billing', text: 'Subscriptions, invoices, hosted collection and sandbox billing-cycle simulation.', badge: `${counts.subscriptions} subscriptions` },
    { href: '/analytics', title: 'Analytics', text: 'Review payment, refund, billing and customer metrics across the current merchant.', badge: 'Reports' },
    { href: '/team', title: 'Team & Access', text: 'Invite staff and manage role-based access to merchant operations.', badge: me?.role ?? 'Role' },
    { href: '/risk', title: 'Risk', text: 'Configure deterministic BLOCK/REVIEW rules and inspect risk decisions.', badge: 'Enforced' },
    { href: '/api-logs', title: 'API Logs', text: 'Inspect safe request metadata without storing API secrets or payment bodies.', badge: 'Developers' },
    { href: '/webhook-deliveries', title: 'Webhook Deliveries', text: 'Inspect delivery attempts and retry failed events with target re-validation.', badge: counts.failedWebhooks ? `${counts.failedWebhooks} failed` : 'Healthy' },
    { href: '/merchants', title: 'Merchant Accounts', text: 'Switch between businesses that the signed-in user is authorised to access.', badge: 'Multi-merchant' },
  ];

  return <main className="moduleShell"><section className="modulePage">
    <header className="moduleHeader">
      <div><p className="eyebrow">Retaillink Terminals</p><h1>Merchant console</h1><p className="muted">One place to access the complete sandbox gateway toolset.</p></div>
      <a className="secondary" href="/">Payments overview</a>
    </header>
    {message && <p className="moduleNotice">{message}</p>}
    {me && <section className="moduleCard"><div className="moduleGrid"><div className="moduleStat"><span>Merchant</span><strong>{me.merchant.name}</strong></div><div className="moduleStat"><span>Environment</span><strong>TEST · {me.merchant.currency}</strong></div><div className="moduleStat"><span>Signed in</span><strong>{me.role}</strong><small>{me.user.email}</small></div></div></section>}
    <section className="consoleHubGrid">
      {modules.map((item) => <a className="consoleHubCard" href={item.href} key={item.href}><div><span className="roleBadge">{item.badge}</span><h2>{item.title}</h2><p>{item.text}</p></div><strong className="consoleHubArrow">→</strong></a>)}
    </section>
    <section className="moduleCard"><p className="eyebrow">Sandbox boundary</p><h2>Safe developer environment</h2><p className="muted">The console simulates payment-gateway behaviour using synthetic test cards, test API keys, hosted checkout, ledger entries, invoices, risk decisions and webhook events. It does not process real money and must not be presented as a licensed live gateway.</p></section>
  </section></main>;
}
