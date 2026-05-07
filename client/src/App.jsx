import { useEffect, useMemo, useState } from "react";

const API_BASE_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const apiUrl = (path) => `${API_BASE_URL}${path}`;

const emptyMetrics = {
  total: 0,
  allowed: 0,
  blocked: 0,
  activeUsers: 0,
  averageResponseTimeMs: 0,
  blockedRate: 0,
  peakRps: 0,
  requestSeries: [],
  recentRequests: [],
  topBlockedIps: [],
  algorithms: {},
  redis: { connected: false },
};

const navItems = [
  ["dashboard", "Dashboard", "⌂"],
  ["apis", "Protected APIs", "▣"],
  ["policies", "Policies", "◇"],
  ["analytics", "Analytics", "◒"],
  ["clients", "Clients", "♙"],
  ["traffic", "Live Traffic", "↗"],
  ["logs", "Logs", "≡"],
  ["health", "System Health", "♥"],
  ["settings", "Settings", "⚙"],
];

export default function App() {
  const [bucket, setBucket] = useState({
    remaining: null,
    availableTokens: null,
    limit: null,
    store: "memory",
  });
  const [metrics, setMetrics] = useState(emptyMetrics);
  const [rules, setRules] = useState({ limit: 20, window: "1m" });
  const [activeAlgorithm, setActiveAlgorithm] = useState("token-bucket");
  const [algorithms, setAlgorithms] = useState([]);
  const [draftRules, setDraftRules] = useState({ limit: 20, window: "1m" });
  const [activeSection, setActiveSection] = useState("dashboard");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const refreshDashboard = async () => {
    try {
      const [statusResponse, dashboardResponse] = await Promise.all([
        fetch(apiUrl("/api/status")),
        fetch(apiUrl("/api/dashboard")),
      ]);
      const [status, dashboard] = await Promise.all([
        statusResponse.json(),
        dashboardResponse.json(),
      ]);
      if (!statusResponse.ok || !dashboardResponse.ok)
        throw new Error(
          status.message || dashboard.message || "Dashboard refresh failed",
        );
      setBucket(status);
      setMetrics({
        ...emptyMetrics,
        ...dashboard.metrics,
        redis: dashboard.redis,
      });
      setRules(dashboard.rules);
      setActiveAlgorithm(dashboard.activeAlgorithm);
      setAlgorithms(dashboard.algorithms);
      setError("");
    } catch (fetchError) {
      setError(fetchError.message);
    }
  };

  const selectAlgorithm = async (algorithm) => {
    setError("");
    try {
      const response = await fetch(apiUrl("/admin/algorithm"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ algorithm }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message || "Could not change algorithm");
      setActiveAlgorithm(data.activeAlgorithm);
      refreshDashboard();
    } catch (fetchError) {
      setError(fetchError.message);
    }
  };

  const saveRules = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/admin/rules"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draftRules,
          limit: Number(draftRules.limit),
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message || "Could not update rules");
      setRules(data);
      setDraftRules({ limit: data.limit, window: data.window });
      refreshDashboard();
    } catch (fetchError) {
      setError(fetchError.message);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    refreshDashboard();
    const interval = setInterval(refreshDashboard, 3000);
    return () => clearInterval(interval);
  }, []);

  const endpointStats = useMemo(() => {
    const stats = new Map();
    metrics.recentRequests.forEach((request) => {
      const current = stats.get(request.endpoint) || {
        endpoint: request.endpoint,
        requests: 0,
        blocked: 0,
      };
      current.requests += 1;
      if (!request.allowed) current.blocked += 1;
      stats.set(request.endpoint, current);
    });
    return [...stats.values()].sort((a, b) => b.requests - a.requests);
  }, [metrics.recentRequests]);

  const availableTokens = bucket.availableTokens ?? 0;
  const limit = bucket.limit ?? rules.limit;
  const meterPercent = limit
    ? Math.max(0, Math.min(100, (availableTokens / limit) * 100))
    : 0;
  const gatewayHealthy = !error;

  return (
    <main className="min-h-screen bg-slate-100 text-slate-800">
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col bg-slate-950 text-slate-300 lg:flex">
          <div className="border-b border-slate-800 px-5 py-5">
            <div className="flex items-center gap-2 text-white">
              <span className="grid h-7 w-7 place-items-center rounded bg-blue-600 text-sm font-bold">
                AG
              </span>
              <span className="font-semibold tracking-tight">API Gateway</span>
            </div>
          </div>
          <nav
            className="flex-1 space-y-1 px-3 py-4"
            aria-label="Gateway navigation"
          >
            {navItems.map(([id, label, icon]) => (
              <button
                key={id}
                onClick={() => navigateToSection(id, setActiveSection)}
                className={`flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm transition ${
                  activeSection === id
                    ? "bg-blue-600 text-white"
                    : "hover:bg-slate-900 hover:text-white"
                }`}
              >
                <span className="w-4 text-center text-base">{icon}</span>
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3 lg:px-7">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                StayHub / gateway
              </p>
              <h1 className="text-lg font-semibold text-slate-900">
                {formatSection(activeSection)}
              </h1>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span
                className={`flex items-center gap-2 font-medium ${
                  gatewayHealthy ? "text-emerald-600" : "text-red-600"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    gatewayHealthy ? "bg-emerald-500" : "bg-red-500"
                  }`}
                />
                {gatewayHealthy ? "Healthy" : "Attention required"}
              </span>
            </div>
          </header>

          <div className="mx-auto max-w-[1400px] space-y-4 p-4 lg:p-6">
            {error ? (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <section
              id="dashboard"
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
            >
              <StatCard
                label="Total requests"
                value={formatNumber(metrics.total)}
              />
              <StatCard
                label="Allowed requests"
                value={formatNumber(metrics.allowed)}
                tone="text-emerald-600"
              />
              <StatCard
                label="Blocked requests"
                value={formatNumber(metrics.blocked)}
                tone="text-red-600"
              />
              <StatCard
                label="Active clients"
                value={formatNumber(metrics.activeUsers)}
              />
              <StatCard
                label="Avg. response"
                value={`${metrics.averageResponseTimeMs} ms`}
              />
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.35fr_.85fr]">
              <article className="rounded border border-slate-200 bg-white p-4 shadow-sm">
                <SectionTitle
                  eyebrow="Traffic overview"
                  title="Requests per second"
                />
                <RequestGraph points={metrics.requestSeries} />
                <div className="mt-2 flex justify-between text-xs text-slate-500">
                  <span>Last 60 seconds</span>
                  <span>Peak {metrics.peakRps} RPS</span>
                </div>
              </article>
              <article
                id="apis"
                className="rounded border border-slate-200 bg-white p-4 shadow-sm"
              >
                <SectionTitle eyebrow="Protected service" title="StayHub API" />
                <div className="mt-4 space-y-3 text-sm">
                  <InfoRow
                    label="Backend URL"
                    value={
                      import.meta.env.VITE_STAYHUB_API ||
                      "Configured in gateway"
                    }
                  />
                  <InfoRow
                    label="Gateway status"
                    value="Running"
                    tone="text-emerald-600"
                  />
                  <InfoRow
                    label="Rate-limit store"
                    value={bucket.store === "redis" ? "Redis" : "In-memory"}
                  />
                  <InfoRow label="Protected route" value="/api/proxy/*" mono />
                </div>
              </article>
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <article
                id="health"
                className="rounded border border-slate-200 bg-white p-4 shadow-sm"
              >
                <SectionTitle eyebrow="System health" title="Dependencies" />
                <div className="mt-3 space-y-2">
                  <HealthRow label="Gateway" healthy={gatewayHealthy} />
                  <HealthRow
                    label="Redis"
                    healthy={metrics.redis?.connected}
                    detail={
                      metrics.redis?.latencyMs
                        ? `${metrics.redis.latencyMs} ms`
                        : "Not connected"
                    }
                  />
                  <HealthRow
                    label="MongoDB logs"
                    healthy={true}
                    detail="Optional"
                  />
                  <HealthRow
                    label="StayHub upstream"
                    healthy={true}
                    detail="Configured"
                  />
                </div>
              </article>
              <article
                id="analytics"
                className="rounded border border-slate-200 bg-white p-4 shadow-sm"
              >
                <SectionTitle eyebrow="Analytics" title="Traffic summary" />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <MiniStat
                    label="Blocked rate"
                    value={`${metrics.blockedRate}%`}
                    tone="text-red-600"
                  />
                  <MiniStat label="Peak RPS" value={metrics.peakRps} />
                  <MiniStat
                    label="Algorithm"
                    value={formatAlgorithm(activeAlgorithm)}
                  />
                  <MiniStat
                    label="Redis keys"
                    value={metrics.redis?.keys ?? "—"}
                  />
                </div>
              </article>
              <article
                id="settings"
                className="rounded border border-slate-200 bg-white p-4 shadow-sm"
              >
                <SectionTitle eyebrow="Settings" title="Active policy" />
                <PolicyForm
                  draftRules={draftRules}
                  setDraftRules={setDraftRules}
                  saveRules={saveRules}
                  saving={saving}
                />
              </article>
            </section>

            <section className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
              <article
                id="policies"
                className="rounded border border-slate-200 bg-white p-4 shadow-sm"
              >
                <SectionTitle eyebrow="Policies" title="Rate limiting policy" />
                <div className="mt-3 space-y-3">
                  <InfoRow
                    label="Algorithm"
                    value={formatAlgorithm(activeAlgorithm)}
                  />
                  <InfoRow
                    label="Default limit"
                    value={`${rules.limit} requests / ${rules.window}`}
                  />
                  <label className="grid gap-1 text-xs font-medium text-slate-600">
                    Active algorithm
                    <select
                      className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                      value={activeAlgorithm}
                      onChange={(event) => selectAlgorithm(event.target.value)}
                    >
                      {algorithms.map((algorithm) => (
                        <option key={algorithm} value={algorithm}>
                          {formatAlgorithm(algorithm)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </article>
              <article
                id="clients"
                className="rounded border border-slate-200 bg-white p-4 shadow-sm"
              >
                <SectionTitle eyebrow="Clients" title="Most blocked clients" />
                <CompactTable
                  headers={["Client", "Requests blocked", "Status"]}
                  rows={metrics.topBlockedIps.map((item) => [
                    item.ip,
                    item.blocked,
                    "Rate limited",
                  ])}
                  empty="No blocked clients recorded."
                />
              </article>
            </section>

            <section
              id="traffic"
              className="rounded border border-slate-200 bg-white p-4 shadow-sm"
            >
              <SectionTitle
                eyebrow="Live traffic / logs"
                title="Recent gateway decisions"
              />
              <CompactTable
                headers={["Time", "Endpoint", "Client", "Algorithm", "Status"]}
                rows={metrics.recentRequests.map((item) => [
                  new Date(item.time).toLocaleTimeString(),
                  item.endpoint,
                  item.ip,
                  formatAlgorithm(item.algorithm),
                  item.allowed ? "200 Allowed" : "429 Blocked",
                ])}
                empty="No gateway traffic recorded yet."
              />
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <article className="rounded border border-slate-200 bg-white p-4 shadow-sm">
                <SectionTitle
                  eyebrow="Protected APIs"
                  title="Top requested endpoints"
                />
                <CompactTable
                  headers={["Endpoint", "Requests", "Blocked"]}
                  rows={endpointStats.map((item) => [
                    item.endpoint,
                    item.requests,
                    item.blocked,
                  ])}
                  empty="Traffic will appear when StayHub requests use the gateway."
                />
              </article>
              <article
                id="logs"
                className="rounded border border-slate-200 bg-white p-4 shadow-sm"
              >
                <SectionTitle
                  eyebrow="Algorithm comparison"
                  title="Limiter performance"
                />
                <CompactTable
                  headers={["Algorithm", "Allowed", "Blocked", "Latency"]}
                  rows={algorithms.map((algorithm) => {
                    const item = metrics.algorithms?.[algorithm] || {};
                    return [
                      formatAlgorithm(algorithm),
                      item.allowed ?? 0,
                      item.blocked ?? 0,
                      `${item.averageLatencyMs ?? 0} ms`,
                    ];
                  })}
                  empty="No limiter decisions recorded yet."
                />
              </article>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

function SectionTitle({ eyebrow, title }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-sm font-semibold text-slate-900">{title}</h2>
    </div>
  );
}

function StatCard({ label, value, tone = "text-slate-900" }) {
  return (
    <article className="rounded border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tracking-tight ${tone}`}>
        {value}
      </p>
    </article>
  );
}

function MiniStat({ label, value, tone = "text-slate-900" }) {
  return (
    <div className="rounded bg-slate-50 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-sm font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function InfoRow({ label, value, tone = "text-slate-800", mono = false }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span
        className={`text-right text-xs font-medium ${tone} ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function HealthRow({ label, healthy, detail }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0 last:pb-0">
      <span className="flex items-center gap-2 text-xs font-medium text-slate-700">
        <span
          className={`h-2 w-2 rounded-full ${healthy ? "bg-emerald-500" : "bg-amber-400"}`}
        />
        {label}
      </span>
      <span
        className={`text-[11px] ${healthy ? "text-emerald-600" : "text-amber-600"}`}
      >
        {detail || (healthy ? "Healthy" : "Unavailable")}
      </span>
    </div>
  );
}

function PolicyForm({ draftRules, setDraftRules, saveRules, saving }) {
  return (
    <form className="mt-3 grid min-w-0 grid-cols-2 gap-2" onSubmit={saveRules}>
      <label className="grid min-w-0 gap-1 text-[11px] font-medium text-slate-600">
        Limit
        <input
          className="w-full min-w-0 rounded border border-slate-300 px-2 py-1.5 text-sm"
          type="number"
          min="1"
          max="100000"
          value={draftRules.limit}
          onChange={(event) =>
            setDraftRules((current) => ({
              ...current,
              limit: event.target.value,
            }))
          }
        />
      </label>
      <label className="grid min-w-0 gap-1 text-[11px] font-medium text-slate-600">
        Window
        <input
          className="w-full min-w-0 rounded border border-slate-300 px-2 py-1.5 text-sm"
          value={draftRules.window}
          onChange={(event) =>
            setDraftRules((current) => ({
              ...current,
              window: event.target.value,
            }))
          }
          placeholder="1m"
        />
      </label>
      <button
        className="col-span-2 rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        disabled={saving}
      >
        {saving ? "Saving..." : "Save policy"}
      </button>
    </form>
  );
}

function CompactTable({ headers, rows, empty }) {
  if (!rows.length) {
    return (
      <p className="mt-3 rounded bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
        {empty}
      </p>
    );
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-400">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-2 py-2 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={`${row[0]}-${index}`}
              className="border-b border-slate-100 last:border-0"
            >
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`px-2 py-2 ${
                    cellIndex === row.length - 1 &&
                    String(cell).includes("Blocked")
                      ? "font-medium text-red-600"
                      : "text-slate-700"
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RequestGraph({ points }) {
  const max = Math.max(1, ...points.map((point) => point.count));
  const path = points
    .map(
      (point, index) =>
        `${index ? "L" : "M"} ${(index / Math.max(1, points.length - 1)) * 100} ${100 - (point.count / max) * 90}`,
    )
    .join(" ");
  return (
    <svg
      className="mt-4 h-28 w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-label="Requests per second graph"
    >
      <path d="M0 100 H100" stroke="#e2e8f0" strokeWidth="1" />
      <path
        d={path}
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value ?? 0);
}

function formatAlgorithm(algorithm = "") {
  return algorithm
    .split("-")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ""))
    .join(" ");
}

function formatSection(section) {
  return navItems.find(([id]) => id === section)?.[1] || "Dashboard";
}

function navigateToSection(id, setActiveSection) {
  setActiveSection(id);
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}
