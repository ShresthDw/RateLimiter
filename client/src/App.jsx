import { useEffect, useState } from 'react';

const initialBucket = { remaining: null, availableTokens: null, limit: null, resetTime: null, store: 'memory' };
const initialMetrics = { total: 0, allowed: 0, blocked: 0, activeUsers: 0, averageResponseTimeMs: 0 };
const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const apiUrl = (path) => `${API_BASE_URL}${path}`;

export default function App() {
  const [bucket, setBucket] = useState(initialBucket);
  const [metrics, setMetrics] = useState(initialMetrics);
  const [rules, setRules] = useState({ limit: 20, window: '1m' });
  const [activeAlgorithm, setActiveAlgorithm] = useState('token-bucket');
  const [algorithms, setAlgorithms] = useState([]);
  const [draftRules, setDraftRules] = useState({ limit: 20, window: '1m' });
  const [message, setMessage] = useState('Ready to test the rate-limited endpoint.');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const refreshDashboard = async () => {
    try {
      const [statusResponse, dashboardResponse] = await Promise.all([fetch(apiUrl('/api/status')), fetch(apiUrl('/api/dashboard'))]);
      const [status, dashboard] = await Promise.all([statusResponse.json(), dashboardResponse.json()]);
      if (!statusResponse.ok || !dashboardResponse.ok) throw new Error(status.message || dashboard.message || 'Dashboard refresh failed');

      setBucket(status);
      setMetrics({ ...dashboard.metrics, redis: dashboard.redis });
      setRules(dashboard.rules);
      setActiveAlgorithm(dashboard.activeAlgorithm);
      setAlgorithms(dashboard.algorithms);
      setDraftRules((current) => (current.limit === dashboard.rules.limit && current.window === dashboard.rules.window ? current : dashboard.rules));
    } catch (fetchError) {
      setError(fetchError.message);
    }
  };

  const selectAlgorithm = async (algorithm) => {
    setError('');
    try {
      const response = await fetch(apiUrl('/admin/algorithm'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ algorithm })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not change algorithm');
      setActiveAlgorithm(data.activeAlgorithm);
      setMessage(`${formatAlgorithm(data.activeAlgorithm)} is now active.`);
      refreshDashboard();
    } catch (fetchError) {
      setError(fetchError.message);
    }
  };

  const saveRules = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch(apiUrl('/admin/rules'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draftRules, limit: Number(draftRules.limit) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not update rules');
      setRules(data);
      setDraftRules({ limit: data.limit, window: data.window });
      setMessage('Rate-limit rules updated without restarting the server.');
      refreshDashboard();
    } catch (fetchError) {
      setError(fetchError.message);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    refreshDashboard();
    const dashboardIntervalId = setInterval(refreshDashboard, 1000);
    return () => clearInterval(dashboardIntervalId);
  }, []);

  const limit = bucket.limit ?? 0;
  const availableTokens = bucket.availableTokens ?? 0;
  const meterPercent = limit ? Math.max(0, Math.min(100, (availableTokens / limit) * 100)) : 0;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <header className="mb-6">
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">Rate limiter dashboard</p>
          <h1 className="text-3xl font-bold tracking-tight">API rate limiting</h1>
          <p className="mt-2 text-slate-500">Monitor the token bucket and update the active rule.</p>
        </header>

        {error ? <p className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-700">{error}</p> : null}

        <section className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
          <article className="rounded-lg border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between font-semibold text-slate-700">
              <span>Current bucket</span>
              <span className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium uppercase text-slate-600">{bucket.store}</span>
            </div>
            <strong className="mt-7 block text-4xl font-bold tracking-tight">{bucket.limit == null ? 'n/a' : `${availableTokens.toFixed(2)} / ${limit}`}</strong>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden="true"><div className="h-full rounded-full bg-blue-600 transition-all duration-300" style={{ width: `${meterPercent}%` }} /></div>
            <p className="mt-2 text-sm text-slate-500">{availableTokens < 1 ? 'Bucket empty — wait for a continuous refill.' : `Next refill: ${bucket.resetTime ? new Date(bucket.resetTime).toLocaleTimeString() : 'loading...'}`}</p>
            <p className="mt-5 text-sm text-slate-500">Live metrics update when StayHub traffic is routed through this gateway.</p>
          </article>

          <section className="grid grid-cols-2 gap-3" aria-label="API metrics">
            <Metric label="API calls" value={metrics.total} />
            <Metric label="Allowed" value={metrics.allowed} tone="text-green-700" />
            <Metric label="Blocked" value={metrics.blocked} tone="text-red-600" />
            <Metric label="Active users" value={metrics.activeUsers} />
            <Metric label="Average decision" value={`${metrics.averageResponseTimeMs} ms`} />
            <Metric label="Current rule" value={`${rules.limit}/${rules.window}`} />
          </section>
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-2">
          <article className="rounded-lg border border-slate-200 bg-white p-6"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Live requests</p><h2 className="mt-1 text-xl font-bold">Requests per second</h2><RequestGraph points={metrics.requestSeries || []} /><p className="mt-2 text-sm text-slate-500">Peak: {metrics.peakRps ?? 0} RPS</p></article>
          <article className="rounded-lg border border-slate-200 bg-white p-6"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Redis status</p><h2 className="mt-1 text-xl font-bold">{metrics.redis?.connected ? '🟢 Redis connected' : '⚪ In-memory mode'}</h2><div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><span className="text-slate-500">Latency</span><strong className="block text-lg">{metrics.redis?.latencyMs ?? '—'} ms</strong></div><div><span className="text-slate-500">Keys</span><strong className="block text-lg">{metrics.redis?.keys ?? '—'}</strong></div><div><span className="text-slate-500">Blocked rate</span><strong className="block text-lg">{metrics.blockedRate ?? 0}%</strong></div><div><span className="text-slate-500">Peak RPS</span><strong className="block text-lg">{metrics.peakRps ?? 0}</strong></div></div></article>
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
          <article className="rounded-lg border border-slate-200 bg-white p-6"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Top blocked IPs</p><h2 className="mt-1 text-xl font-bold">Blocked clients</h2><div className="mt-4 space-y-3">{(metrics.topBlockedIps || []).length ? metrics.topBlockedIps.map((item) => <div key={item.ip} className="flex justify-between border-b border-slate-100 pb-2 text-sm"><span>{item.ip}</span><strong className="text-red-600">{item.blocked} blocked</strong></div>) : <p className="text-sm text-slate-500">No blocked requests yet.</p>}</div></article>
          <article className="overflow-hidden rounded-lg border border-slate-200 bg-white p-6"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Recent requests</p><h2 className="mt-1 text-xl font-bold">Latest decisions</h2><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[500px] text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="pb-2">Time</th><th className="pb-2">IP</th><th className="pb-2">Endpoint</th><th className="pb-2">Status</th></tr></thead><tbody>{(metrics.recentRequests || []).map((item, index) => <tr key={`${item.time}-${index}`} className="border-t border-slate-100"><td className="py-2">{new Date(item.time).toLocaleTimeString()}</td><td>{item.ip}</td><td>{item.endpoint}</td><td className={item.allowed ? 'text-green-700' : 'text-red-600'}>{item.allowed ? 'Allowed' : '429 Blocked'}</td></tr>)}</tbody></table></div></article>
        </section>

        <section className="mt-5 rounded-lg border border-slate-200 bg-white p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">Algorithm comparison</p><h2 className="text-xl font-bold">Choose the active limiter</h2></div>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-600">Algorithm
              <select className="min-w-52 rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-800 outline-none focus:border-blue-600 focus:ring-3 focus:ring-blue-100" value={activeAlgorithm} onChange={(event) => selectAlgorithm(event.target.value)}>
                {algorithms.map((algorithm) => <option key={algorithm} value={algorithm}>{formatAlgorithm(algorithm)}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Algorithm</th><th className="px-3 py-2">Allowed</th><th className="px-3 py-2">Blocked</th><th className="px-3 py-2">Latency</th><th className="px-3 py-2">Memory</th></tr></thead>
              <tbody>{algorithms.map((algorithm) => { const item = metrics.algorithms?.[algorithm] || {}; return <tr key={algorithm} className="border-b border-slate-100 last:border-0"><td className="px-3 py-3 font-medium text-slate-700">{formatAlgorithm(algorithm)}{algorithm === activeAlgorithm ? <span className="ml-2 rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">Active</span> : null}</td><td className="px-3 py-3 text-green-700">{item.allowed ?? 0}</td><td className="px-3 py-3 text-red-600">{item.blocked ?? 0}</td><td className="px-3 py-3">{item.averageLatencyMs ?? 0} ms</td><td className="px-3 py-3">{item.memoryBytes ?? 0} B</td></tr>; })}</tbody>
            </table>
          </div>
        </section>

        <section className="mt-5 grid gap-7 rounded-lg border border-slate-200 bg-white p-6 md:grid-cols-[1fr_.9fr] md:items-end">
          <div><p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">Configuration</p><h2 className="text-xl font-bold">Active rule</h2><p className="mt-2 text-sm text-slate-500">Changes apply to new requests immediately.</p></div>
          <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={saveRules}>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-600">Limit<input className="rounded-md border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-blue-600 focus:ring-3 focus:ring-blue-100" type="number" min="1" max="100000" value={draftRules.limit} onChange={(e) => setDraftRules((current) => ({ ...current, limit: e.target.value }))} /></label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-600">Window<input className="rounded-md border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-blue-600 focus:ring-3 focus:ring-blue-100" value={draftRules.window} onChange={(e) => setDraftRules((current) => ({ ...current, window: e.target.value }))} placeholder="1m" /></label>
            <button className="rounded-md bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-65" disabled={saving}>{saving ? 'Saving...' : 'Save rules'}</button>
          </form>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value, tone = 'text-slate-800' }) {
  return <article className="min-h-[104px] rounded-lg border border-slate-200 bg-white p-4"><span className="block text-xs font-semibold text-slate-500">{label}</span><strong className={`mt-2 block text-2xl font-bold tracking-tight ${tone}`}>{value}</strong></article>;
}

function formatAlgorithm(algorithm) {
  return algorithm.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}

function RequestGraph({ points }) {
  const max = Math.max(1, ...points.map((point) => point.count));
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${(index / Math.max(1, points.length - 1)) * 100} ${100 - (point.count / max) * 90}`).join(' ');
  return <svg className="mt-5 h-32 w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Requests per second graph"><path d="M0 100 H100" stroke="#e2e8f0" strokeWidth="1" /><path d={path} fill="none" stroke="#2563eb" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}
