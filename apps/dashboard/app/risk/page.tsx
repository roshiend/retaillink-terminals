'use client';

import { useEffect, useState, type FormEvent } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Rule = { id: string; name: string; type: string; action: string; threshold: string | null; text_value: string | null; currency: string | null; enabled: boolean; created_at: string };
type Event = { id: string; rule_name: string | null; outcome: string; reason: string; amount: string; currency: string; merchant_reference: string | null; created_at: string };

export default function RiskPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [name, setName] = useState('Large payment review');
  const [type, setType] = useState('AMOUNT_GTE');
  const [action, setAction] = useState('REVIEW');
  const [value, setValue] = useState('10000.00');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(`${API_URL}${path}`, { ...options, credentials: 'include', headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { window.location.href = '/'; throw new Error('Sign in required.'); }
    if (!response.ok) throw new Error(data.error?.message ?? `Request failed (${response.status})`);
    return data;
  }

  async function load() {
    try {
      const [ruleData, eventData] = await Promise.all([request('/dashboard/risk_rules'), request('/dashboard/risk_events')]);
      setRules(ruleData.data ?? []); setEvents(eventData.data ?? []);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load risk data.'); }
  }
  useEffect(() => { void load(); }, []);

  async function createRule(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const payload = type === 'AMOUNT_GTE'
        ? { name, type, action, threshold: Math.round(Number(value) * 100), currency: 'LKR' }
        : { name, type, action, text_value: value };
      await request('/dashboard/risk_rules', { method: 'POST', body: JSON.stringify(payload) });
      await load(); setMessage('Risk rule created.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create risk rule.'); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this risk rule?')) return;
    setBusy(true);
    try { await request(`/dashboard/risk_rules/${id}`, { method: 'DELETE' }); await load(); setMessage('Risk rule deleted.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not delete risk rule.'); }
    finally { setBusy(false); }
  }

  const money = (minor: string, currency: string) => new Intl.NumberFormat('en-LK', { style: 'currency', currency }).format(Number(minor) / 100);

  return <main className="moduleShell"><section className="modulePage">
    <header className="moduleHeader"><div><p className="eyebrow">Risk controls</p><h1>Rules & events</h1><p className="muted">Configure deterministic sandbox risk rules and inspect the decisions they produce.</p></div><a className="secondary" href="/">Back to overview</a></header>
    <p className="moduleNotice"><strong>Enforcement is active.</strong> BLOCK rules reject matching Payment Intent creation. REVIEW rules allow the sandbox payment to continue while recording the decision for inspection.</p>
    {message && <p className="moduleNotice">{message}</p>}
    <section className="moduleCard"><p className="eyebrow">New rule</p><h2>Create risk rule</h2><form className="moduleForm" onSubmit={createRule}><label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label><label>Condition<select value={type} onChange={(e) => { setType(e.target.value); setValue(e.target.value === 'AMOUNT_GTE' ? '10000.00' : 'TEST-BLOCK'); }}><option value="AMOUNT_GTE">Amount at least</option><option value="REFERENCE_CONTAINS">Reference contains</option></select></label><label>{type === 'AMOUNT_GTE' ? 'Amount (LKR)' : 'Reference text'}<input value={value} onChange={(e) => setValue(e.target.value)} required /></label><label>Action<select value={action} onChange={(e) => setAction(e.target.value)}><option value="REVIEW">Review</option><option value="BLOCK">Block</option></select></label><button disabled={busy}>Create rule</button></form></section>
    <section className="moduleCard"><p className="eyebrow">Configuration</p><h2>{rules.length} rules</h2><div className="moduleGrid two">{rules.map((row) => <article className="moduleStat" key={row.id}><div className="riskRuleSummary"><div><strong>{row.name}</strong><p>{row.type === 'amount_gte' ? `${row.action.toUpperCase()} when amount ≥ ${money(row.threshold ?? '0', row.currency ?? 'LKR')}` : `${row.action.toUpperCase()} when reference contains “${row.text_value}”`}</p></div><span className="roleBadge">{row.enabled ? 'ENABLED' : 'DISABLED'}</span></div><button className="linkButton danger" disabled={busy} onClick={() => void remove(row.id)}>Delete rule</button></article>)}</div>{!rules.length && <p className="empty">No risk rules configured.</p>}</section>
    <section className="moduleCard"><p className="eyebrow">Decision history</p><h2>Risk events</h2><div className="tableWrap"><table><thead><tr><th>Outcome</th><th>Rule</th><th>Amount</th><th>Reference</th><th>Reason</th><th>Time</th></tr></thead><tbody>{events.map((row) => <tr key={row.id}><td><span className={`status ${row.outcome}`}>{row.outcome}</span></td><td>{row.rule_name ?? '—'}</td><td>{money(row.amount,row.currency)}</td><td>{row.merchant_reference ?? '—'}</td><td>{row.reason}</td><td>{new Date(row.created_at).toLocaleString()}</td></tr>)}</tbody></table>{!events.length && <p className="empty">No risk events yet.</p>}</div></section>
  </section></main>;
}
