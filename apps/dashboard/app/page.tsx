'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Me = {
  user: { id: string; email: string };
  merchant: { id: string; name: string; country: string; currency: string };
  role: string;
};
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
type Refund = {
  id: string;
  payment: string;
  amount: string;
  currency: string;
  status: string;
  reason?: string | null;
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
  failure_code?: string | null;
  failure_message?: string | null;
  created_at: string;
};
type PaymentDetail = Payment & {
  merchant_reference?: string | null;
  description?: string | null;
  refunds: Refund[];
};
type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  environment: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};
type Webhook = { id: string; url: string; enabled: boolean; created_at: string };
type Delivery = {
  id: string;
  endpoint_id: string;
  event_type: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
};
type AuditLog = {
  id: string;
  action: string;
  resource: string;
  resource_id: string | null;
  ip_address: string | null;
  created_at: string;
};
type Settlement = {
  id: string;
  amount: string;
  currency: string;
  status: string;
  period_from: string;
  period_to: string;
  created_at: string;
};

type Section = 'overview' | 'payments' | 'settlements' | 'developers' | 'webhooks' | 'docs' | 'audit' | 'settings';

class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [section, setSection] = useState<Section>('overview');
  const [intents, setIntents] = useState<PaymentIntent[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [balance, setBalance] = useState('0');
  const [balanceCurrency, setBalanceCurrency] = useState('LKR');
  const [amount, setAmount] = useState('5000.00');
  const [reference, setReference] = useState('ORDER-1001');
  const [description, setDescription] = useState('Demo order');
  const [keyName, setKeyName] = useState('Website integration');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [settingsName, setSettingsName] = useState('');
  const [oneTimeSecret, setOneTimeSecret] = useState('');
  const [oneTimeSecretLabel, setOneTimeSecretLabel] = useState('');
  const [selectedPayment, setSelectedPayment] = useState<PaymentDetail | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function request(path: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    if (options.body != null && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const response = await fetch(`${API_URL}${path}`, { ...options, credentials: 'include', headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiRequestError(data.error?.message ?? `Request failed (${response.status})`, response.status);
    return data;
  }

  async function loadSession() {
    try {
      const current = await request('/auth/me');
      setMe(current);
      setSettingsName(current.merchant.name);
      await refreshAll();
    } catch {
      setMe(null);
    }
  }

  useEffect(() => { void loadSession(); }, []);

  async function refreshAll() {
    try {
      const [intentData, paymentData, keyData, webhookData, deliveryData, auditData, balanceData, settlementData] = await Promise.all([
        request('/v1/payment_intents'),
        request('/v1/payments'),
        request('/dashboard/api_keys'),
        request('/v1/webhook_endpoints'),
        request('/v1/webhook_deliveries'),
        request('/dashboard/audit_logs'),
        request('/v1/balance'),
        request('/dashboard/settlements'),
      ]);
      setIntents(intentData.data ?? []);
      setPayments(paymentData.data ?? []);
      setApiKeys(keyData.data ?? []);
      setWebhooks(webhookData.data ?? []);
      setDeliveries(deliveryData.data ?? []);
      setAuditLogs(auditData.data ?? []);
      setBalance(balanceData.available ?? '0');
      setBalanceCurrency(balanceData.currency ?? 'LKR');
      setSettlements(settlementData.data ?? []);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) setMe(null);
      setMessage(error instanceof Error ? error.message : 'Could not refresh dashboard data.');
    }
  }

  useEffect(() => {
    if (!me) return;
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void refreshAll(); };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [me?.user.id]);

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const path = authMode === 'signup' ? '/auth/signup' : '/auth/login';
      const body = authMode === 'signup' ? { business_name: businessName, email, password } : { email, password };
      const result = await request(path, { method: 'POST', body: JSON.stringify(body) });
      if (result.initial_test_api_key) {
        setOneTimeSecret(result.initial_test_api_key);
        setOneTimeSecretLabel('Your first sandbox secret API key');
      }
      await loadSession();
      setMessage(authMode === 'signup' ? 'Merchant account created.' : 'Signed in successfully.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await request('/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined);
    setMe(null);
    setIntents([]);
    setPayments([]);
    setApiKeys([]);
    setWebhooks([]);
    setAuditLogs([]);
    setSettlements([]);
    setSelectedPayment(null);
  }

  async function createPaymentIntent(event: FormEvent) {
    event.preventDefault();
    const minorUnits = Math.round(Number(amount) * 100);
    if (!Number.isFinite(minorUnits) || minorUnits <= 0) return setMessage('Enter a valid positive amount.');
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
      setIntents((rows) => [result, ...rows]);
      setMessage('Payment created. Open the hosted checkout to complete the sandbox transaction.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create payment.');
    } finally {
      setBusy(false);
    }
  }

  async function openPayment(id: string) {
    setBusy(true);
    try {
      const result = await request(`/v1/payments/${encodeURIComponent(id)}`);
      setSelectedPayment(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load payment details.');
    } finally {
      setBusy(false);
    }
  }

  async function refund(payment: Payment) {
    if (!window.confirm('Refund the remaining sandbox payment amount?')) return;
    setBusy(true);
    try {
      await request(`/v1/payments/${payment.id}/refunds`, { method: 'POST', body: '{}' });
      const detail = selectedPayment?.id === payment.id ? await request(`/v1/payments/${payment.id}`) : null;
      if (detail) setSelectedPayment(detail);
      await refreshAll();
      setMessage('Sandbox refund completed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Refund failed.');
    } finally {
      setBusy(false);
    }
  }

  async function createApiKey(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await request('/dashboard/api_keys', { method: 'POST', body: JSON.stringify({ name: keyName }) });
      setOneTimeSecret(result.secret);
      setOneTimeSecretLabel(`Secret key — ${result.name}`);
      await refreshAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create API key.');
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(id: string) {
    if (!window.confirm('Revoke this API key? Integrations using it will stop working.')) return;
    setBusy(true);
    try {
      await request(`/dashboard/api_keys/${id}`, { method: 'DELETE' });
      await refreshAll();
      setMessage('API key revoked.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not revoke API key.');
    } finally {
      setBusy(false);
    }
  }

  async function createWebhook(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await request('/v1/webhook_endpoints', { method: 'POST', body: JSON.stringify({ url: webhookUrl }) });
      setOneTimeSecret(result.secret);
      setOneTimeSecretLabel('Webhook signing secret');
      setWebhookUrl('');
      await refreshAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create webhook.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteWebhook(id: string) {
    if (!window.confirm('Delete this webhook endpoint?')) return;
    setBusy(true);
    try {
      await request(`/v1/webhook_endpoints/${id}`, { method: 'DELETE' });
      await refreshAll();
      setMessage('Webhook endpoint deleted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete webhook endpoint.');
    } finally {
      setBusy(false);
    }
  }

  async function runSettlement() {
    if (!window.confirm('Simulate paying the full available merchant balance?')) return;
    setBusy(true);
    try {
      const result = await request('/dashboard/settlements', { method: 'POST', body: '{}' });
      await refreshAll();
      setMessage(`Sandbox settlement ${result.settlement.id} marked paid.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create settlement.');
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await request('/dashboard/settings', { method: 'POST', body: JSON.stringify({ name: settingsName }) });
      setMe((current) => current ? { ...current, merchant: { ...current.merchant, name: result.merchant.name } } : current);
      setMessage('Business settings updated.');
      await refreshAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update settings.');
    } finally {
      setBusy(false);
    }
  }

  const totals = useMemo(() => {
    const successful = payments.filter((payment) => ['succeeded', 'partially_refunded', 'refunded'].includes(payment.status));
    const gross = successful.reduce((sum, row) => sum + Number(row.amount), 0);
    const refunded = successful.reduce((sum, row) => sum + Number(row.amount_refunded), 0);
    return { gross, refunded, net: gross - refunded };
  }, [payments]);

  const money = (minor: number | string, currency = 'LKR') =>
    new Intl.NumberFormat('en-LK', { style: 'currency', currency }).format(Number(minor) / 100);
  const dateTime = (value: string) => new Date(value).toLocaleString();

  if (!me) {
    return <main className="authShell">
      <section className="authCard">
        <div className="brand"><strong>RETAILLINK</strong> TERMINALS <span className="badge">SANDBOX</span></div>
        <p className="eyebrow">Merchant platform</p>
        <h1>{authMode === 'login' ? 'Sign in to your account' : 'Create your merchant account'}</h1>
        <p className="muted">Manage sandbox payments, developer credentials, webhooks and settlements from one console.</p>
        <form className="authForm" onSubmit={submitAuth}>
          {authMode === 'signup' && <label>Business name<input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required /></label>}
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={authMode === 'signup' ? 8 : 1} required /></label>
          <button disabled={busy}>{busy ? 'Working…' : authMode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
        {message && <p className="notice" role="alert">{message}</p>}
        <button className="textButton" onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setMessage(''); }}>
          {authMode === 'login' ? 'Need an account? Create one' : 'Already have an account? Sign in'}
        </button>
      </section>
    </main>;
  }

  const navigation: Array<[Section, string]> = [
    ['overview', 'Overview'],
    ['payments', 'Payments'],
    ['settlements', 'Settlements'],
    ['developers', 'API Keys'],
    ['webhooks', 'Webhooks'],
    ['docs', 'API Docs'],
    ['audit', 'Audit Log'],
    ['settings', 'Settings'],
  ];

  return <main className="appShell">
    <aside className="sidebar">
      <div className="brand"><strong>RETAILLINK</strong><br />TERMINALS <span className="badge">TEST</span></div>
      <nav>
        {navigation.map(([item, label]) => <button key={item} className={section === item ? 'navActive' : ''} aria-current={section === item ? 'page' : undefined} onClick={() => setSection(item)}>{label}</button>)}
      </nav>
      <div className="merchantBox">
        <strong>{me.merchant.name}</strong>
        <span>{me.user.email}</span>
        <small>{me.role}</small>
        <button className="textButton light" onClick={logout}>Sign out</button>
      </div>
    </aside>

    <section className="mainArea">
      <header className="pageHeader">
        <div><p className="eyebrow">{navigation.find(([key]) => key === section)?.[1]}</p><h1>{sectionTitle(section)}</h1></div>
        <div className="headerActions"><span className="testMode">Test mode</span><button className="secondary" disabled={busy} onClick={() => void refreshAll()}>Refresh</button></div>
      </header>
      {message && <p className="notice" role="status" aria-live="polite">{message}</p>}

      {section === 'overview' && <>
        <section className="metrics">
          <div className="metric"><span>Available balance</span><strong>{money(balance, balanceCurrency)}</strong></div>
          <div className="metric"><span>Gross volume</span><strong>{money(totals.gross)}</strong></div>
          <div className="metric"><span>Refunded</span><strong>{money(totals.refunded)}</strong></div>
          <div className="metric"><span>Payment attempts</span><strong>{payments.length}</strong></div>
        </section>
        <section className="panel">
          <p className="eyebrow">Create test payment</p><h2>New payment intent</h2>
          <form className="createForm" onSubmit={createPaymentIntent}>
            <label>Amount (LKR)<input value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
            <label>Order reference<input value={reference} onChange={(e) => setReference(e.target.value)} /></label>
            <label>Description<input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
            <button disabled={busy}>Create payment</button>
          </form>
        </section>
        <IntentTable rows={intents.slice(0, 8)} money={money} dateTime={dateTime} />
      </>}

      {section === 'payments' && <section className="panel">
        <div className="panelTitle"><div><p className="eyebrow">Transactions</p><h2>Payment history</h2></div><span className="muted smallText">{payments.length} records</span></div>
        <div className="tableWrap"><table><thead><tr><th>Payment</th><th>Amount</th><th>Card</th><th>Status</th><th></th></tr></thead><tbody>
          {payments.map((row) => <tr key={row.id}>
            <td><strong className="mono">{row.id}</strong><small>{dateTime(row.created_at)}</small></td>
            <td>{money(row.amount, row.currency)}{Number(row.amount_refunded) > 0 && <small>Refunded {money(row.amount_refunded, row.currency)}</small>}</td>
            <td>{row.payment_method ? `${row.payment_method.brand?.toUpperCase()} •••• ${row.payment_method.last4}` : '—'}</td>
            <td><Status value={row.status} />{row.failure_message && <small>{row.failure_message}</small>}</td>
            <td className="actionsCell"><button className="linkButton" onClick={() => void openPayment(row.id)}>View</button>{['succeeded','partially_refunded'].includes(row.status) && <button className="linkButton danger" disabled={busy} onClick={() => void refund(row)}>Refund</button>}</td>
          </tr>)}
        </tbody></table>{!payments.length && <p className="empty">No payment attempts yet.</p>}</div>
      </section>}

      {section === 'settlements' && <>
        <section className="metrics compactMetrics">
          <div className="metric"><span>Available to settle</span><strong>{money(balance, balanceCurrency)}</strong></div>
          <div className="metric"><span>Completed settlements</span><strong>{settlements.filter((row) => row.status === 'paid').length}</strong></div>
        </section>
        <section className="panel splitPanel">
          <div><p className="eyebrow">Sandbox payout simulation</p><h2>Settle available balance</h2><p className="muted">This creates a paid settlement and posts balancing ledger entries. It does not transfer real money.</p></div>
          <button disabled={busy || Number(balance) <= 0 || me.role !== 'OWNER'} onClick={() => void runSettlement()}>Run settlement</button>
        </section>
        <section className="panel"><p className="eyebrow">History</p><h2>Settlements</h2><div className="tableWrap"><table><thead><tr><th>Settlement</th><th>Amount</th><th>Period</th><th>Status</th><th>Created</th></tr></thead><tbody>
          {settlements.map((row) => <tr key={row.id}><td><strong className="mono">{row.id}</strong></td><td>{money(row.amount, row.currency)}</td><td><span>{new Date(row.period_from).toLocaleDateString()}</span><small>to {new Date(row.period_to).toLocaleDateString()}</small></td><td><Status value={row.status} /></td><td>{dateTime(row.created_at)}</td></tr>)}
        </tbody></table>{!settlements.length && <p className="empty">No settlements yet.</p>}</div></section>
      </>}

      {section === 'developers' && <>
        <section className="panel"><p className="eyebrow">API access</p><h2>Sandbox secret keys</h2><p className="muted">Use secret keys only from your server. New secrets are shown once and only their SHA-256 hashes remain stored.</p>
          <form className="inlineForm" onSubmit={createApiKey}><label>Key name<input value={keyName} onChange={(e) => setKeyName(e.target.value)} /></label><button disabled={busy}>Create secret key</button></form>
          <div className="tableWrap"><table><thead><tr><th>Name</th><th>Prefix</th><th>Last used</th><th>Status</th><th></th></tr></thead><tbody>
            {apiKeys.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><small>{dateTime(row.created_at)}</small></td><td><code>{row.prefix}…</code></td><td>{row.last_used_at ? dateTime(row.last_used_at) : 'Never'}</td><td><Status value={row.revoked_at ? 'revoked' : 'active'} /></td><td>{!row.revoked_at && <button className="linkButton danger" onClick={() => void revokeKey(row.id)}>Revoke</button>}</td></tr>)}
          </tbody></table></div>
        </section>
        <section className="panel"><p className="eyebrow">Quick start</p><h2>Create a Payment Intent</h2><pre>{`curl -X POST ${API_URL}/v1/payment_intents \\\n  -H "Authorization: Bearer sk_test_REPLACE_ME" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: order-1001-payment" \\\n  -d '{"amount":500000,"currency":"LKR","merchant_reference":"ORDER-1001"}'`}</pre></section>
      </>}

      {section === 'webhooks' && <>
        <section className="panel"><p className="eyebrow">Event delivery</p><h2>Webhook endpoints</h2><p className="muted">Sandbox endpoints must resolve to a public address. Localhost and private network destinations are blocked.</p>
          <form className="inlineForm wide" onSubmit={createWebhook}><label>Endpoint URL<input type="url" placeholder="https://example.com/webhooks/retaillink" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} required /></label><button disabled={busy}>Add endpoint</button></form>
          <div className="tableWrap"><table><thead><tr><th>Endpoint</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>{webhooks.map((row) => <tr key={row.id}><td><strong>{row.url}</strong><small className="mono">{row.id}</small></td><td><Status value={row.enabled ? 'active' : 'disabled'} /></td><td>{dateTime(row.created_at)}</td><td><button className="linkButton danger" onClick={() => void deleteWebhook(row.id)}>Delete</button></td></tr>)}</tbody></table>{!webhooks.length && <p className="empty">No webhook endpoints configured.</p>}</div>
        </section>
        <section className="panel"><p className="eyebrow">Attempts</p><h2>Recent webhook deliveries</h2><div className="tableWrap"><table><thead><tr><th>Event</th><th>Status</th><th>Attempts</th><th>Error</th><th>Created</th></tr></thead><tbody>{deliveries.map((row) => <tr key={row.id}><td><strong>{row.event_type}</strong><small className="mono">{row.id}</small></td><td><Status value={row.status} /></td><td>{row.attempts}</td><td>{row.last_error ?? '—'}</td><td>{dateTime(row.created_at)}</td></tr>)}</tbody></table>{!deliveries.length && <p className="empty">No webhook deliveries yet.</p>}</div></section>
      </>}

      {section === 'docs' && <ApiDocs apiUrl={API_URL} />}

      {section === 'audit' && <section className="panel"><p className="eyebrow">Security and operations</p><h2>Audit log</h2><div className="tableWrap"><table><thead><tr><th>Action</th><th>Resource</th><th>IP address</th><th>Time</th></tr></thead><tbody>{auditLogs.map((row) => <tr key={row.id}><td><strong>{row.action}</strong></td><td>{row.resource}<small className="mono">{row.resource_id ?? '—'}</small></td><td>{row.ip_address ?? '—'}</td><td>{dateTime(row.created_at)}</td></tr>)}</tbody></table>{!auditLogs.length && <p className="empty">No audit events yet.</p>}</div></section>}

      {section === 'settings' && <>
        <section className="panel settingsPanel"><p className="eyebrow">Business profile</p><h2>Merchant settings</h2><form className="settingsForm" onSubmit={saveSettings}>
          <label>Business name<input value={settingsName} onChange={(e) => setSettingsName(e.target.value)} disabled={me.role !== 'OWNER'} /></label>
          <label>Country<input value={me.merchant.country} disabled /></label>
          <label>Settlement currency<input value={me.merchant.currency} disabled /></label>
          <div><button disabled={busy || me.role !== 'OWNER'}>Save changes</button></div>
        </form><p className="muted smallText">Country and settlement currency are locked to the Sri Lankan sandbox profile for this version.</p></section>
        <section className="panel"><p className="eyebrow">Environment</p><h2>Sandbox status</h2><div className="definitionGrid"><span>Merchant ID</span><code>{me.merchant.id}</code><span>Mode</span><strong>TEST</strong><span>Currency</span><strong>{me.merchant.currency}</strong><span>Role</span><strong>{me.role}</strong></div></section>
      </>}
    </section>

    {oneTimeSecret && <div className="modalBackdrop" role="presentation"><section className="secretModal" role="dialog" aria-modal="true"><p className="eyebrow">Shown once</p><h2>{oneTimeSecretLabel}</h2><p className="muted">Copy this value now. It cannot be retrieved again after you close this window.</p><code className="secretValue">{oneTimeSecret}</code><div className="modalActions"><button className="secondary" onClick={() => void navigator.clipboard.writeText(oneTimeSecret)}>Copy</button><button onClick={() => { setOneTimeSecret(''); setOneTimeSecretLabel(''); }}>I saved it</button></div></section></div>}

    {selectedPayment && <PaymentModal payment={selectedPayment} money={money} dateTime={dateTime} busy={busy} onClose={() => setSelectedPayment(null)} onRefund={() => void refund(selectedPayment)} />}
  </main>;
}

function sectionTitle(section: Section) {
  const titles: Record<Section, string> = {
    overview: 'Payments overview', payments: 'Payments', settlements: 'Settlements', developers: 'API keys', webhooks: 'Webhooks', docs: 'API documentation', audit: 'Audit log', settings: 'Settings',
  };
  return titles[section];
}

function Status({ value }: { value: string }) {
  return <span className={`status ${value}`}>{value.replaceAll('_', ' ')}</span>;
}

function IntentTable({ rows, money, dateTime }: { rows: PaymentIntent[]; money: (minor: number | string, currency?: string) => string; dateTime: (value: string) => string }) {
  return <section className="panel"><div className="panelTitle"><div><p className="eyebrow">Checkout sessions</p><h2>Recent payment intents</h2></div></div><div className="tableWrap"><table><thead><tr><th>Reference</th><th>Amount</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.merchant_reference || '—'}</strong><small className="mono">{row.id}</small></td><td>{money(row.amount, row.currency)}</td><td><Status value={row.status} /></td><td>{dateTime(row.created_at)}</td><td><a href={row.checkout_url} target="_blank" rel="noreferrer">Open checkout</a></td></tr>)}</tbody></table>{!rows.length && <p className="empty">No payment intents yet.</p>}</div></section>;
}

function PaymentModal({ payment, money, dateTime, busy, onClose, onRefund }: {
  payment: PaymentDetail;
  money: (minor: number | string, currency?: string) => string;
  dateTime: (value: string) => string;
  busy: boolean;
  onClose: () => void;
  onRefund: () => void;
}) {
  return <div className="modalBackdrop" role="presentation"><section className="detailModal" role="dialog" aria-modal="true"><div className="panelTitle"><div><p className="eyebrow">Payment details</p><h2>{money(payment.amount, payment.currency)}</h2></div><button className="secondary" onClick={onClose}>Close</button></div>
    <div className="definitionGrid detailGrid"><span>Payment ID</span><code>{payment.id}</code><span>Status</span><Status value={payment.status} /><span>Reference</span><strong>{payment.merchant_reference || '—'}</strong><span>Description</span><strong>{payment.description || '—'}</strong><span>Payment method</span><strong>{payment.payment_method ? `${payment.payment_method.brand?.toUpperCase()} •••• ${payment.payment_method.last4}` : '—'}</strong><span>Created</span><strong>{dateTime(payment.created_at)}</strong><span>Refunded</span><strong>{money(payment.amount_refunded, payment.currency)}</strong></div>
    {payment.failure_message && <p className="errorNotice"><strong>{payment.failure_code ?? 'Payment failed'}:</strong> {payment.failure_message}</p>}
    <div className="modalSection"><div className="panelTitle"><h3>Refund history</h3>{['succeeded','partially_refunded'].includes(payment.status) && <button disabled={busy} onClick={onRefund}>Refund remaining</button>}</div>{payment.refunds.length ? <div className="tableWrap"><table><thead><tr><th>Refund</th><th>Amount</th><th>Status</th><th>Created</th></tr></thead><tbody>{payment.refunds.map((refund) => <tr key={refund.id}><td><code>{refund.id}</code></td><td>{money(refund.amount, refund.currency)}</td><td><Status value={refund.status} /></td><td>{dateTime(refund.created_at)}</td></tr>)}</tbody></table></div> : <p className="empty">No refunds for this payment.</p>}</div>
  </section></div>;
}

function ApiDocs({ apiUrl }: { apiUrl: string }) {
  return <>
    <section className="panel docsHero"><p className="eyebrow">Retaillink API v1</p><h2>Sandbox integration guide</h2><p className="muted">All money amounts are integers in the smallest currency unit. For LKR, <code>500000</code> means LKR 5,000.00. Authenticate server-side requests with <code>Authorization: Bearer sk_test_...</code>.</p></section>
    <section className="docsGrid">
      <article className="panel"><h3>1. Create a payment</h3><pre>{`POST ${apiUrl}/v1/payment_intents\nAuthorization: Bearer sk_test_...\nIdempotency-Key: order-1001\n\n{\n  "amount": 500000,\n  "currency": "LKR",\n  "merchant_reference": "ORDER-1001"\n}`}</pre></article>
      <article className="panel"><h3>2. Send the customer to checkout</h3><p className="muted">The Payment Intent response contains a <code>checkout_url</code>. Redirect the customer there. Never collect live card details in this sandbox.</p><div className="testCards"><code>4242 4242 4242 4242</code><span>Success</span><code>4000 0000 0000 0002</code><span>Decline</span><code>4000 0025 0000 3155</code><span>3DS simulation</span></div></article>
      <article className="panel"><h3>3. Verify the result</h3><pre>{`GET ${apiUrl}/v1/payment_intents/:id\nAuthorization: Bearer sk_test_...`}</pre><p className="muted">Do not treat a browser redirect as proof of payment. Confirm the Payment Intent status or process the signed webhook.</p></article>
      <article className="panel"><h3>4. Verify webhooks</h3><pre>{`x-retaillink-signature: t=<timestamp>,v1=<hmac>\n\nsigned_payload = timestamp + "." + raw_json_body\nhmac = HMAC_SHA256(webhook_secret, signed_payload)`}</pre><p className="muted">Current sandbox events include <code>payment.succeeded</code> and <code>refund.succeeded</code>.</p></article>
    </section>
    <section className="panel"><p className="eyebrow">Core endpoints</p><h2>API reference</h2><div className="endpointList"><code>POST /v1/payment_intents</code><span>Create a hosted payment</span><code>GET /v1/payment_intents/:id</code><span>Retrieve payment intent status</span><code>GET /v1/payments</code><span>List payment attempts</span><code>GET /v1/payments/:id</code><span>Payment and refund detail</span><code>POST /v1/payments/:id/refunds</code><span>Full or partial refund</span><code>GET /v1/balance</code><span>Retrieve ledger-backed available balance</span><code>GET /v1/settlements</code><span>List settlement records</span></div></section>
  </>;
}
