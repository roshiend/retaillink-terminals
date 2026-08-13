'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type ApiLog = { id: string; request_id: string; method: string; path: string; status: number; source: string; duration_ms: number; created_at: string };

export default function ApiLogsPage() {
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [message, setMessage] = useState('');

  async function load() {
    try {
      const response = await fetch(`${API_URL}/dashboard/api_logs`, { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { window.location.href = '/'; return; }
      if (!response.ok) throw new Error(data.error?.message ?? 'Could not load API logs.');
      setLogs(data.data ?? []);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load API logs.'); }
  }

  useEffect(() => { void load(); }, []);

  return <main className="moduleShell"><section className="modulePage">
    <header className="moduleHeader"><div><p className="eyebrow">Developers</p><h1>API request logs</h1><p className="muted">Request metadata only—authorization headers, card data and request bodies are never stored here.</p></div><div className="moduleHeaderActions"><a className="secondary" href="/">Back to overview</a><button onClick={() => void load()}>Refresh</button></div></header>
    {message && <p className="moduleNotice">{message}</p>}
    <section className="moduleCard"><div className="moduleGrid"><div className="moduleStat"><span>Recent requests</span><strong>{logs.length}</strong></div><div className="moduleStat"><span>Errors</span><strong>{logs.filter((row) => row.status >= 400).length}</strong></div><div className="moduleStat"><span>API-key calls</span><strong>{logs.filter((row) => row.source === 'api_key').length}</strong></div></div>
      <div className="tableWrap"><table><thead><tr><th>Method</th><th>Path</th><th>Status</th><th>Source</th><th>Duration</th><th>Time</th></tr></thead><tbody>{logs.map((row) => <tr key={row.id}><td><span className="method">{row.method}</span></td><td><strong className="mono">{row.path}</strong><small>{row.request_id}</small></td><td><span className={`statusCode ${row.status < 400 ? 'ok' : 'error'}`}>{row.status}</span></td><td>{row.source.replaceAll('_',' ')}</td><td>{row.duration_ms} ms</td><td>{new Date(row.created_at).toLocaleString()}</td></tr>)}</tbody></table>{!logs.length && <p className="empty">No logged customer API requests yet.</p>}</div>
    </section>
  </section></main>;
}
