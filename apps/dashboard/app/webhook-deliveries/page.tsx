'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Me = { role: string };
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
  const [role, setRole] = useState('VIEWER');
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
    if (!response.ok) {
      const error = new Error(data.error?.message ?? `Request failed (${response.status})`) as Error & { delivery?: Delivery };
      error.delivery = data.delivery;
      throw error;
    }
    return data;
  }

  async function load() {
    setMessage('');
    try {
      const [meResponse, deliveryResponse] = await Promise.all([
        request('/auth/me'),
        request('/v1/webhook_deliveries'),
      ]);
      setRole((meResponse as Me).role ?? 'VIEWER');
      setDeliveries(deliveryResponse.data ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load webhook deliveries.');
    }
  }

  useEffect(() => { void load(); }, []);

  async function retry(id: string) {
    if (!window.confirm('Retry this webhook delivery now?')) return;
    setBusyId(id);
    setMessage('');
    try {
      const result = await request(`/dashboard/webhook_deliveries/${id}/retry`, { method: 'POST', body: '{}' });
      setMessage(`Webhook delivery ${result.status}. Attempt ${result.attempts} completed.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Webhook retry failed.');
      await load();
    } finally {
      setBusyId('');
    }
  }

  const canRetry = ['OWNER', 'ADMIN', 'DEVELOPER'].includes(role);
  const failed = deliveries.filter((row) => row.status === 'failed').length;
  const delivered = deliveries.filter((row) => row.status === 'delivered').length;

  return <main className="moduleShell"><section className="modulePage">
    <header className="moduleHeader">
      <div><p className="eyebrow">Developers</p><h1>Webhook deliveries</h1><p className="muted">Inspect event delivery attempts and manually retry failed sandbox webhooks.</p></div>
      <div className="moduleHeaderActions"><a className="secondary" href="/">Back to overview</a><button onClick={() => void load()}>Refresh</button></div>
    </header>

    <p className="moduleNotice"><strong>Safety:</strong> every retry resolves and validates the endpoint again. Localhost, private/reserved network targets and unsafe redirects remain blocked.</p>
    {!canRetry && <p className="moduleWarning">Your {role} role can inspect deliveries but cannot retry them.</p>}
    {message && <p className="moduleNotice">{message}</p>}

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
          <td>{canRetry && row.status === 'failed' && <button className="linkButton" disabled={busyId === row.id} onClick={() => void retry(row.id)}>{busyId === row.id ? 'Retrying…' : 'Retry'}</button>}</td>
        </tr>)}
      </tbody></table>{!deliveries.length && <p className="empty">No webhook deliveries yet.</p>}</div>
    </section>
  </section></main>;
}
