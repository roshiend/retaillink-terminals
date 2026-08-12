'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Me = { user: { id: string; email: string }; merchant: { id: string; name: string; country: string; currency: string }; role: string };
type PaymentIntent = { id: string; amount: string; currency: string; status: string; merchant_reference?: string | null; description?: string | null; checkout_url: string; created_at: string };
type Payment = { id: string; payment_intent: string; amount: string; amount_refunded: string; currency: string; status: string; payment_method?: { brand?: string; last4?: string } | null; failure_message?: string | null; created_at: string };
type ApiKey = { id: string; name: string; prefix: string; environment: string; last_used_at: string | null; revoked_at: string | null; created_at: string };
type Webhook = { id: string; url: string; enabled: boolean; created_at: string };
type Delivery = { id: string; event_type: string; status: string; attempts: number; last_error: string | null; created_at: string };
type AuditLog = { id: string; action: string; resource: string; resource_id: string | null; ip_address: string | null; created_at: string };

type Section = 'overview' | 'payments' | 'developers' | 'webhooks' | 'audit';

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
  const [balance, setBalance] = useState('0');
  const [amount, setAmount] = useState('5000.00');
  const [reference, setReference] = useState('ORDER-1001');
  const [description, setDescription] = useState('Demo order');
  const [keyName, setKeyName] = useState('Website integration');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [oneTimeSecret, setOneTimeSecret] = useState('');
  const [oneTimeSecretLabel, setOneTimeSecretLabel] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function request(path: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    if (options.body != null && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiRequestError(data.error?.message ?? `Request failed (${response.status})`, response.status);
    return data;
  }

  async function loadSession() {
    try {
      const current = await request('/auth/me');
      setMe(current);
      await refreshAll();
    } catch {
      setMe(null);
    }
  }

  useEffect(() => { void loadSession(); }, []);

  async function refreshAll() {
    try {
      const [intentData, paymentData, keyData, webhookData, deliveryData, auditData, balanceData] = await Promise.all([
        request('/v1/payment_intents'), request('/v1/payments'), request('/dashboard/api_keys'), request('/v1/webhook_endpoints'), request('/v1/webhook_deliveries'), request('/dashboard/audit_logs'), request('/v1/balance'),
      ]);
      setIntents(intentData.data ?? []);
      setPayments(paymentData.data ?? []);
      setApiKeys(keyData.data ?? []);
      setWebhooks(webhookData.data ?? []);
      setDeliveries(deliveryData.data ?? []);
      setAuditLogs(auditData.data ?? []);
      setBalance(balanceData.available ?? '0');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) setMe(null);
      setMessage(error instanceof Error ? error.message : 'Could not refresh dashboard data.');
    }
  }

  useEffect(() => {
    if (!me) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshAll();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [me?.user.id]);

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage('');
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
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Authentication failed.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    await request('/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined);
    setMe(null); setIntents([]); setPayments([]); setApiKeys([]); setWebhooks([]); setAuditLogs([]);
  }

  async function createPaymentIntent(event: FormEvent) {
    event.preventDefault();
    const minorUnits = Math.round(Number(amount) * 100);
    if (!Number.isFinite(minorUnits) || minorUnits <= 0) return setMessage('Enter a valid positive amount.');
    setBusy(true);
    try {
      const result = await request('/v1/payment_intents', { method: 'POST', headers: { 'idempotency-key': `dashboard-${Date.now()}` }, body: JSON.stringify({ amount: minorUnits, currency: 'LKR', merchant_reference: reference || undefined, description: description || undefined }) });
      setIntents((rows) => [result, ...rows]);
      setMessage('Payment created. Open the hosted checkout to complete the sandbox transaction.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to create payment.'); }
    finally { setBusy(false); }
  }

  async function refund(payment: Payment) {
    if (!window.confirm('Refund the remaining sandbox payment amount?')) return;
    setBusy(true);
    try { await request(`/v1/payments/${payment.id}/refunds`, { method: 'POST', body: '{}' }); await refreshAll(); setMessage('Sandbox refund completed.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Refund failed.'); }
    finally { setBusy(false); }
  }

  async function createApiKey(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const result = await request('/dashboard/api_keys', { method: 'POST', body: JSON.stringify({ name: keyName }) });
      setOneTimeSecret(result.secret); setOneTimeSecretLabel(`Secret key — ${result.name}`); await refreshAll();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create API key.'); }
    finally { setBusy(false); }
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
    event.preventDefault(); setBusy(true);
    try {
      const result = await request('/v1/webhook_endpoints', { method: 'POST', body: JSON.stringify({ url: webhookUrl }) });
      setOneTimeSecret(result.secret); setOneTimeSecretLabel('Webhook signing secret'); setWebhookUrl(''); await refreshAll();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create webhook.'); }
    finally { setBusy(false); }
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

  const totals = useMemo(() => {
    const successful = payments.filter((payment) => ['succeeded', 'partially_refunded', 'refunded'].includes(payment.status));
    const gross = successful.reduce((sum, row) => sum + Number(row.amount), 0);
    const refunded = successful.reduce((sum, row) => sum + Number(row.amount_refunded), 0);
    return { gross, refunded, net: gross - refunded };
  }, [payments]);

  const money = (minor: number | string, currency = 'LKR') => new Intl.NumberFormat('en-LK', { style: 'currency', currency }).format(Number(minor) / 100);

  if (!me) {
    return <main className="authShell">
      <section className="authCard">
        <div className="brand"><strong>RETAILLINK</strong> TERMINALS <span className="badge">SANDBOX</span></div>
        <p className="eyebrow">Merchant platform</p>
        <h1>{authMode === 'login' ? 'Sign in to your account' : 'Create your merchant account'}</h1>
        <p className="muted">Manage test payments, API keys, webhooks and developer activity without exposing your integration secret keys.</p>
        <form className="authForm" onSubmit={submitAuth}>
          {authMode === 'signup' && <label>Business name<input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required /></label>}
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={authMode === 'signup' ? 8 : 1} required /></label>
          <button disabled={busy}>{busy ? 'Working…' : authMode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
        {message && <p className="notice" role="alert">{message}</p>}
        <button className="textButton" onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setMessage(''); }}>{authMode === 'login' ? 'Need an account? Create one' : 'Already have an account? Sign in'}</button>
      </section>
    </main>;
  }

  return <main className="appShell">
    <aside className="sidebar">
      <div className="brand"><strong>RETAILLINK</strong><br />TERMINALS <span className="badge">TEST</span></div>
      <nav>
        {(['overview','payments','developers','webhooks','audit'] as Section[]).map((item) => <button key={item} className={section === item ? 'navActive' : ''} aria-current={section === item ? 'page' : undefined} onClick={() => setSection(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}
      </nav>
      <div className="merchantBox"><strong>{me.merchant.name}</strong><span>{me.user.email}</span><small>{me.role}</small><button className="textButton light" onClick={logout}>Sign out</button></div>
    </aside>

    <section className="mainArea">
      <header className="pageHeader"><div><p className="eyebrow">{section}</p><h1>{section === 'overview' ? 'Payments overview' : section === 'developers' ? 'Developers' : section[0].toUpperCase() + section.slice(1)}</h1></div><button className="secondary" disabled={busy} onClick={() => void refreshAll()}>Refresh</button></header>
      {message && <p className="notice" role="status" aria-live="polite">{message}</p>}

      {section === 'overview' && <>
        <section className="metrics">
          <div className="metric"><span>Available balance</span><strong>{money(balance)}</strong></div>
          <div className="metric"><span>Gross volume</span><strong>{money(totals.gross)}</strong></div>
          <div className="metric"><span>Refunded</span><strong>{money(totals.refunded)}</strong></div>
          <div className="metric"><span>Payments</span><strong>{payments.length}</strong></div>
        </section>
        <section className="panel"><p className="eyebrow">Create test payment</p><h2>New payment intent</h2><form className="createForm" onSubmit={createPaymentIntent}><label>Amount (LKR)<input value={amount} onChange={(e) => setAmount(e.target.value)} /></label><label>Order reference<input value={reference} onChange={(e) => setReference(e.target.value)} /></label><label>Description<input value={description} onChange={(e) => setDescription(e.target.value)} /></label><button disabled={busy}>Create payment</button></form></section>
        <IntentTable rows={intents.slice(0, 8)} money={money} />
      </>}

      {section === 'payments' && <section className="panel"><div className="panelTitle"><div><p className="eyebrow">Transactions</p><h2>Payments</h2></div></div><div className="tableWrap"><table><thead><tr><th>Payment</th><th>Amount</th><th>Card</th><th>Status</th><th></th></tr></thead><tbody>{payments.map((row) => <tr key={row.id}><td><strong>{row.id}</strong><small>{new Date(row.created_at).toLocaleString()}</small></td><td>{money(row.amount, row.currency)}{Number(row.amount_refunded) > 0 && <small>Refunded {money(row.amount_refunded, row.currency)}</small>}</td><td>{row.payment_method ? `${row.payment_method.brand?.toUpperCase()} •••• ${row.payment_method.last4}` : '—'}</td><td><span className={`status ${row.status}`}>{row.status.replaceAll('_',' ')}</span>{row.failure_message && <small>{row.failure_message}</small>}</td><td>{['succeeded','partially_refunded'].includes(row.status) && <button className="linkButton" disabled={busy} onClick={() => void refund(row)}>Refund</button>}</td></tr>)}</tbody></table>{!payments.length && <p className="empty">No payment attempts yet.</p>}</div></section>}

      {section === 'developers' && <>
        <section className="panel"><p className="eyebrow">API access</p><h2>Sandbox secret keys</h2><p className="muted">Use secret keys only from your server. New secrets are shown once and stored only as a hash.</p><form className="inlineForm" onSubmit={createApiKey}><label>Key name<input value={keyName} onChange={(e) => setKeyName(e.target.value)} /></label><button disabled={busy}>Create key</button></form><div className="tableWrap"><table><thead><tr><th>Name</th><th>Key prefix</th><th>Last used</th><th>Status</th><th></th></tr></thead><tbody>{apiKeys.map((key) => <tr key={key.id}><td><strong>{key.name}</strong><small>{new Date(key.created_at).toLocaleString()}</small></td><td><code>{key.prefix}…</code></td><td>{key.last_used_at ? new Date(key.last_used_at).toLocaleString() : 'Never'}</td><td><span className={`status ${key.revoked_at ? 'failed' : 'succeeded'}`}>{key.revoked_at ? 'revoked' : 'active'}</span></td><td>{!key.revoked_at && <button className="linkButton danger" disabled={busy} onClick={() => void revokeKey(key.id)}>Revoke</button>}</td></tr>)}</tbody></table></div></section>
        <section className="panel"><p className="eyebrow">Quick start</p><h2>Create a payment with curl</h2><pre>{`curl -X POST http://localhost:3001/v1/payment_intents \\\n  -H "Authorization: Bearer sk_test_REPLACE_ME" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: order-1001" \\\n  -d '{"amount":500000,"currency":"LKR"}'`}</pre></section>
      </>}

      {section === 'webhooks' && <>
        <section className="panel"><p className="eyebrow">Event delivery</p><h2>Webhook endpoints</h2><form className="inlineForm wide" onSubmit={createWebhook}><label>Endpoint URL<input type="url" placeholder="https://example.com/webhooks/retaillink" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} required /></label><button disabled={busy}>Add endpoint</button></form><div className="tableWrap"><table><thead><tr><th>Endpoint</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>{webhooks.map((row) => <tr key={row.id}><td><strong>{row.url}</strong><small>{row.id}</small></td><td><span className={`status ${row.enabled ? 'succeeded' : 'failed'}`}>{row.enabled ? 'enabled' : 'disabled'}</span></td><td>{new Date(row.created_at).toLocaleString()}</td><td><button className="linkButton danger" disabled={busy} onClick={() => void deleteWebhook(row.id)}>Delete</button></td></tr>)}</tbody></table></div></section>
        <section className="panel"><p className="eyebrow">Recent events</p><h2>Webhook deliveries</h2><div className="tableWrap"><table><thead><tr><th>Event</th><th>Status</th><th>Attempts</th><th>Time</th></tr></thead><tbody>{deliveries.map((row) => <tr key={row.id}><td><strong>{row.event_type}</strong><small>{row.last_error || row.id}</small></td><td><span className={`status ${row.status === 'delivered' ? 'succeeded' : 'failed'}`}>{row.status}</span></td><td>{row.attempts}</td><td>{new Date(row.created_at).toLocaleString()}</td></tr>)}</tbody></table></div></section>
      </>}

      {section === 'audit' && <section className="panel"><p className="eyebrow">Security & activity</p><h2>Audit log</h2><div className="tableWrap"><table><thead><tr><th>Action</th><th>Resource</th><th>IP</th><th>Time</th></tr></thead><tbody>{auditLogs.map((row) => <tr key={row.id}><td><strong>{row.action}</strong></td><td>{row.resource}<small>{row.resource_id || '—'}</small></td><td>{row.ip_address || '—'}</td><td>{new Date(row.created_at).toLocaleString()}</td></tr>)}</tbody></table></div></section>}
    </section>

    {oneTimeSecret && <div className="modalBackdrop"><section className="secretModal" role="dialog" aria-modal="true" aria-labelledby="secret-modal-title"><p className="eyebrow">Show once</p><h2 id="secret-modal-title">{oneTimeSecretLabel}</h2><p className="muted">Copy this value now. Retaillink will not display the full secret again.</p><code className="secretValue">{oneTimeSecret}</code><div className="modalActions"><button className="secondary" onClick={() => navigator.clipboard.writeText(oneTimeSecret)}>Copy</button><button onClick={() => { setOneTimeSecret(''); setOneTimeSecretLabel(''); }}>I saved it</button></div></section></div>}
  </main>;
}

function IntentTable({ rows, money }: { rows: PaymentIntent[]; money: (value: number | string, currency?: string) => string }) {
  return <section className="panel"><div className="panelTitle"><div><p className="eyebrow">Checkout sessions</p><h2>Recent payment intents</h2></div></div><div className="tableWrap"><table><thead><tr><th>Reference</th><th>Amount</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.merchant_reference || '—'}</strong><small>{row.id}</small></td><td>{money(row.amount, row.currency)}</td><td><span className={`status ${row.status}`}>{row.status.replaceAll('_',' ')}</span></td><td>{new Date(row.created_at).toLocaleString()}</td><td><a href={row.checkout_url} target="_blank" rel="noreferrer">Open checkout</a></td></tr>)}</tbody></table>{!rows.length && <p className="empty">No payment intents yet.</p>}</div></section>;
}
