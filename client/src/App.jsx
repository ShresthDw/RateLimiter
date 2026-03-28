import { useEffect, useState } from 'react';

const initialBucket = { remaining: null, availableTokens: null, limit: null, resetTime: null, store: 'memory' };
const initialMetrics = { total: 0, allowed: 0, blocked: 0, activeUsers: 0, averageResponseTimeMs: 0 };

export default function App() {
  const [bucket, setBucket] = useState(initialBucket);
  const [metrics, setMetrics] = useState(initialMetrics);
  const [rules, setRules] = useState({ limit: 20, window: '1m' });
  const [draftRules, setDraftRules] = useState({ limit: 20, window: '1m' });
  const [message, setMessage] = useState('Ready to test the rate-limited endpoint.');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const refreshDashboard = async () => {
    try {
      const [statusResponse, dashboardResponse] = await Promise.all([fetch('/api/demo/status'), fetch('/api/dashboard')]);
      const [status, dashboard] = await Promise.all([statusResponse.json(), dashboardResponse.json()]);
      if (!statusResponse.ok || !dashboardResponse.ok) throw new Error(status.message || dashboard.message || 'Dashboard refresh failed');

      setBucket(status);
      setMetrics(dashboard.metrics);
      setRules(dashboard.rules);
      setDraftRules((current) => (current.limit === dashboard.rules.limit && current.window === dashboard.rules.window ? current : dashboard.rules));
    } catch (fetchError) {
      setError(fetchError.message);
    }
  };

  const callApi = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/data');
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Request failed');
      setMessage(data.message);
      setBucket(data);
    } catch (fetchError) {
      setError(fetchError.message);
    } finally {
      setLoading(false);
      refreshDashboard();
    }
  };

  const saveRules = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/admin/rules', {
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
    const intervalId = setInterval(refreshDashboard, 1000);
    return () => clearInterval(intervalId);
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
            <button className="mt-5 rounded-md bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-65" onClick={callApi} disabled={loading}>{loading ? 'Checking limit...' : 'GET /api/data'}</button>
            <p className="mt-3 text-sm text-slate-500">{message}</p>
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
