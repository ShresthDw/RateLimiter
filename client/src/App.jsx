import { useEffect, useState } from 'react';

const initialState = {
  message: 'Click the button to hit the rate-limited endpoint.',
  remaining: null,
  limit: null,
  resetTime: null
};

export default function App() {
  const [result, setResult] = useState(initialState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const limit = result.limit ?? 0;
  const remaining = result.remaining ?? 0;
  const meterPercent = limit > 0 ? Math.max(0, Math.min(100, (remaining / limit) * 100)) : 0;
  const statusTone = remaining === 0 ? 'danger' : meterPercent < 25 ? 'warn' : 'good';

  const refreshStatus = async () => {
    try {
      const response = await fetch('/api/demo/status');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Status request failed');
      }

      setResult((current) => ({
        ...current,
        message: data.message,
        remaining: data.remaining,
        limit: data.limit,
        resetTime: data.resetTime
      }));
    } catch (fetchError) {
      setError(fetchError.message);
    }
  };

  const callApi = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/demo/ping');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Request failed');
      }

      setResult({
        message: data.message,
        remaining: data.remaining,
        limit: data.limit,
        resetTime: data.resetTime
      });
    } catch (fetchError) {
      setError(fetchError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshStatus();
    const intervalId = setInterval(refreshStatus, 3000);

    return () => clearInterval(intervalId);
  }, []);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">MERN Rate Limiter</p>
        <h1>Throttle API traffic before it overwhelms your server.</h1>
        <p className="lede">
          This demo uses Express middleware to enforce request limits and shows the remaining quota in the UI.
        </p>
      </section>

      <section className="panel">
        <button className="button" onClick={callApi} disabled={loading}>
          {loading ? 'Checking limit...' : 'Call rate-limited API'}
        </button>

        {error ? <p className="error">{error}</p> : null}

        <article className={`meter-card meter-${statusTone}`}>
          <div className="meter-copy">
            <span className="label">Remaining tokens</span>
            <strong className="meter-value">
              {result.limit == null ? 'n/a' : `${remaining} / ${limit}`}
            </strong>
            <p className="meter-note">
              {result.limit == null
                ? 'Call the API to load the current bucket state.'
                : remaining === 0
                  ? 'Bucket empty. Wait for refill.'
                  : 'Tokens refill continuously over time. This view updates every 3 seconds.'}
            </p>
          </div>
          <div className="meter-track" aria-hidden="true">
            <div className="meter-fill" style={{ width: `${meterPercent}%` }} />
          </div>
        </article>

        <div className="card-grid">
          <article className="card">
            <span className="label">Message</span>
            <strong>{result.message}</strong>
          </article>
          <article className="card">
            <span className="label">Remaining</span>
            <strong>{result.remaining ?? 'n/a'}</strong>
          </article>
          <article className="card">
            <span className="label">Limit</span>
            <strong>{result.limit ?? 'n/a'}</strong>
          </article>
          <article className="card">
            <span className="label">Reset</span>
            <strong>{result.resetTime ? new Date(result.resetTime).toLocaleTimeString() : 'n/a'}</strong>
          </article>
        </div>
      </section>
    </main>
  );
}