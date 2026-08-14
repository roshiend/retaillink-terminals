'use client';

import { useEffect, useState, type FormEvent } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Me = { role: string };
type Endpoint = { id: string; url: string; enabled: boolean; created_at: string };
type Delivery = {
  id: string;
  endpoint_id: string;
  event_id?: string;
  event_type: string;
  status: string;
  attempts: number;
  last_error: string | null;
  delivered_at?: string | null;
  created_at: string;
};

export default function WebhookDeliveriesPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [role, setRole] = useState('VIEWER');
  const [url, setUrl] = useState('https://example.com/retaillink-webhooks');
  const [oneTimeSecret, setOneTimeSecret] = useState('');
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');

  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.href = '/';
      throw new Error('Sign in required.');
    }
    if (!response.ok) throw new Error(data.error?.message ?? `Request failed (${response.status})`);
    return data;
  }

  async function load() {
    setMessage('');
    try {
      const [meResponse, endpointResponse, deliveryResponse] = await Promise.all([
        request('/auth/me'),
        request('/v1/webhook_endpoints'),
        request('/v1/webhook_deliveries'),
      ]);
      setRole((meResponse as Me).role ?? 'VIEWER');
      setEndpoints(endpointResponse.data ?? []);
      setDeliveries(deliveryResponse.data ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load webhooks.');
    }
  }

  useEffect(() => { void load(); }, []);

  async function createEndpoint(event: FormEvent) {
    event.preventDefault();
    setBusyId('create'); setMessage(''); setOneTimeSecret('');
    try {
      const created = await request('/v1/webhook_endpoints', { method: 'POST', body: JSON.stringify({ url }) });
      setOneTimeSecret(created.secret);
      setMessage('Webhook endpoint created. Copy the signing secret now; it will not be shown again.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create webhook endpoint.');
    } finally { setBusyId(''); }
  }

  async function setState(endpoint: Endpoint, enabled: boolean) {
    setBusyId(endpoint.id); setMessage(''); setOneTimeSecret('');
    try {
      await request(`/dashboard/webhook_endpoints/${endpoint.id}/state`, { method: 'POST', body: JSON.stringify({ enabled }) });
      setMessage(enabled ? 'Webhook endpoint enabled.' : 'Webhook endpoint disabled.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not change endpoint state.');
    } finally { setBusyId(''); }
  }

  async function rotate(endpoint: Endpoint) {
    if (!window.confirm('Rotate this signing secret? The previous secret will stop working immediately.')) return;
    setBusyId(endpoint.id); setMessage(''); setOneTimeSecret('');
    try {
      const result = await request(`/dashboard/webhook_endpoints/${endpoint.id}/rotate_secret`, { method: 'POST', body: '{}' });
      setOneTimeSecret(result.secret);
      setMessage('Signing secret rotated. Copy the new secret now and update the receiving service.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not rotate signing secret.');
    } finally { setBusyId(''); }
  }

  async function remove(endpoint: Endpoint) {
    if (!window.confirm('Delete this webhook endpoint? Delivery history tied to it will also be removed.')) return;
    setBusyId(endpoint.id); setMessage(''); setOneTimeSecret('');
    try {
      await request(`/v1/webhook_endpoints/${endpoint.id}`, { method: 'DELETE' });
      setMessage('Webhook endpoint deleted.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete endpoint.');
    } finally { setBusyId(''); }
  }

  async function retry(id: string) {
    if (!window.confirm('Retry this webhook delivery now?')) return;
    setBusyId(id); setMessage(''); setOneTimeSecret('');
    try {
      const result = await request(`/dashboard/webhook_deliveries/${id}/retry`, { method: 'POST', body: '{}' });
      setMessage(`Webhook delivery ${result.status}. Attempt ${result.attempts} completed.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Webhook retry failed.');
      await load();
    } finally { setBusyId(''); }
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setMessage('Copied to clipboard.'); }
    catch { setMessage(value); }
  }

  const canManage = ['OWNER', 'ADMIN', 'DEVELOPER'].includes(role);
  const failed = deliveries.filter((row) => row.status === 'failed').length;
  const delivered = deliveries.filter((row) => row.status === 'delivered').length;

  return <main className="moduleShell"><section className="modulePage">
    <header className="moduleHeader">
      <div><p className="eyebrow">Developers</p><h1>Webhooks</h1><p className="muted">Manage endpoints, signing secrets, event delivery attempts and safe retries.</p></div>
      <div className="moduleHeaderActions"><a className="secondary" href="/">Back to overview</a><button onClick={() => void load()}>Refresh</button></div>
    </header>

    <p className="moduleNotice"><strong>Safety:</strong> endpoint creation and every retry resolve the destination and reject localhost/private/reserved networks. Never expose signing secrets in client-side application code.</p>
    {!canManage && <p className="moduleWarning">Your {role} role can inspect webhook configuration but cannot change or retry it.</p>}
    {message && <p className="moduleNotice">{message}</p>}
    {oneTimeSecret && <section className="moduleCard"><p className="eyebrow">One-time secret</p><h2>Copy signing secret now</h2><p className="mono">{oneTimeSecret}</p><button onClick={() => void copy(oneTimeSecret)}>Copy secret</button></section>}

    {canManage && <section className="moduleCard"><p className="eyebrow">Destination</p><h2>Add webhook endpoint</h2><form className="moduleForm" onSubmit={createEndpoint}><label>Public HTTPS URL<input value={url} onChange={(e) => setUrl(e.target.value)} type="url" required /></label><button disabled={busyId === 'create'}>{busyId === 'create' ? 'Creating…' : 'Create endpoint'}</button></form></section>}

    <section className="moduleCard"><div className="panelTitle"><div><p className="eyebrow">Configured destinations</p><h2>{endpoints.length} endpoints</h2></div></div><div className="tableWrap"><table><thead><tr><th>Endpoint</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>{endpoints.map((endpoint) => <tr key={endpoint.id}><td><strong className="mono">{endpoint.url}</strong><small className="mono">{endpoint.id}</small></td><td><span className={`status ${endpoint.enabled ? 'active' : 'canceled'}`}>{endpoint.enabled ? 'enabled' : 'disabled'}</span></td><td>{new Date(endpoint.created_at).toLocaleString()}</td><td className="billingActions">{canManage && <>{endpoint.enabled ? <button className="linkButton" disabled={busyId === endpoint.id} onClick={() => void setState(endpoint,false)}>Disable</button> : <button className="linkButton" disabled={busyId === endpoint.id} onClick={() => void setState(endpoint,true)}>Enable</button>}<button className="linkButton" disabled={busyId === endpoint.id} onClick={() => void rotate(endpoint)}>Rotate secret</button><button className="linkButton danger" disabled={busyId === endpoint.id} onClick={() => void remove(endpoint)}>Delete</button></>}</td></tr>)}</tbody></table>{!endpoints.length && <p className="empty">No webhook endpoints configured.</p>}</div></section>

    <section className="moduleCard">
      <div className="moduleGrid">
        <div className="moduleStat"><span>Recent deliveries</span><strong>{deliveries.length}</strong></div>
        <div className="moduleStat"><span>Delivered</span><strong>{delivered}</strong></div>
        <div className="moduleStat"><span>Failed</span><strong>{failed}</strong></div>
      </div>
      <div className="tableWrap"><table><thead><tr><th>Event</th><th>Status</th><th>Attempts</th><th>Last error</th><th>Created</th><th></th></tr></thead><tbody>
        {deliveries.map((row) => <tr key={row.id}>
          <td><strong>{row.event_type}</strong><small className="mono">{row.id}</small></td>
          <td><span className={`status ${row.status}`}>{row.status}</span></td>
          <td>{row.attempts}</td>
          <td>{row.last_error ?? '—'}</td>
          <td>{new Date(row.created_at).toLocaleString()}</td>
          <td>{canManage && row.status === 'failed' && <button className="linkButton" disabled={busyId === row.id} onClick={() => void retry(row.id)}>{busyId === row.id ? 'Retrying…' : 'Retry'}</button>}</td>
        </tr>)}
      </tbody></table>{!deliveries.length && <p className="empty">No webhook deliveries yet.</p>}</div>
    </section>
  </section></main>;
}
