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
      const [statusResponse, dashboardResponse] = await Promise.all([
        fetch('/api/demo/status'),
        fetch('/api/dashboard')
      ]);
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
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Distributed Rate Limiter</p>
        <h1>Observe, configure, and protect your API.</h1>
        <p className="lede">The token bucket is shared through Redis when configured, with live request decisions shown below.</p>
      </section>

      {error ? <p className="error">{error}</p> : null}

      <section className="dashboard-grid">
        <article className="panel bucket-panel">
          <div className="panel-heading"><span>Current bucket</span><span className="store-badge">{bucket.store}</span></div>
          <strong className="meter-value">{bucket.limit == null ? 'n/a' : `${availableTokens.toFixed(2)} / ${limit}`}</strong>
          <div className="meter-track" aria-hidden="true"><div className="meter-fill" style={{ width: `${meterPercent}%` }} /></div>
          <p className="meter-note">{availableTokens < 1 ? 'Bucket empty — wait for a continuous refill.' : `Next refill: ${bucket.resetTime ? new Date(bucket.resetTime).toLocaleTimeString() : 'loading...'}`}</p>
          <button className="button" onClick={callApi} disabled={loading}>{loading ? 'Checking limit...' : 'GET /api/data'}</button>
          <p className="result-message">{message}</p>
        </article>

        <section className="metrics-grid" aria-label="API metrics">
          <Metric label="API calls" value={metrics.total} />
          <Metric label="Allowed" value={metrics.allowed} tone="good" />
          <Metric label="Blocked" value={metrics.blocked} tone="danger" />
          <Metric label="Active users" value={metrics.activeUsers} />
          <Metric label="Average decision" value={`${metrics.averageResponseTimeMs} ms`} />
          <Metric label="Current rule" value={`${rules.limit}/${rules.window}`} />
        </section>
      </section>

      <section className="panel config-panel">
        <div><p className="eyebrow">Configuration panel</p><h2>Change the active rule</h2><p className="meter-note">Applies immediately to new requests. Demo only: protect this endpoint with admin authentication in production.</p></div>
        <form className="rule-form" onSubmit={saveRules}>
          <label>Limit<input type="number" min="1" max="100000" value={draftRules.limit} onChange={(e) => setDraftRules((current) => ({ ...current, limit: e.target.value }))} /></label>
          <label>Window<input value={draftRules.window} onChange={(e) => setDraftRules((current) => ({ ...current, window: e.target.value }))} placeholder="1m" /></label>
          <button className="button" disabled={saving}>{saving ? 'Saving...' : 'Save rules'}</button>
        </form>
      </section>
    </main>
  );
}

function Metric({ label, value, tone = '' }) {
  return <article className={`metric-card ${tone}`}><span className="label">{label}</span><strong>{value}</strong></article>;
}
