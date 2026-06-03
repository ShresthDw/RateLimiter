import { useEffect, useMemo, useState, useRef } from "react";

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
  timelineDurationSeconds: 300,
  requestSeries: [],
  recentRequests: [],
  topBlockedIps: [],
  algorithms: {},
  redis: { connected: false },
};

const navItems = [
  { id: "dashboard", label: "Dashboard", tag: "Overview" },
  { id: "simulator", label: "Traffic Simulator", tag: "Control" },
  { id: "traffic", label: "Live Traffic Stream", tag: "Logs" },
  { id: "policies", label: "Policies & Rules", tag: "Config" },
  { id: "analytics", label: "Algorithm Matrix", tag: "Compare" },
  { id: "clients", label: "Clients & IPs", tag: "Security" },
  { id: "apis", label: "Protected APIs", tag: "Routes" },
  { id: "health", label: "System Health", tag: "Status" },
];

const mockEndpoints = [
  { path: "/api/proxy/api/rooms?mock=true", name: "Rooms API", desc: "List and filter room suites" },
  { path: "/api/proxy/api/bookings?mock=true", name: "Bookings API", desc: "Create and manage bookings" },
  { path: "/api/proxy/api/users?mock=true", name: "User Profile API", desc: "User identity and authentication" },
  { path: "/api/proxy/api/reviews?mock=true", name: "Reviews API", desc: "Customer ratings and feedback" },
  { path: "/api/proxy/test?mock=true", name: "Gateway Probe", desc: "Health check and probe route" },
];

const clientRegions = [
  "US-East (Virginia)", "US-West (Oregon)", "EU-West (Ireland)", "EU-Central (Frankfurt)",
  "AP-South (Mumbai)", "AP-East (Tokyo)", "AP-Southeast (Singapore)", "SA-East (Sao Paulo)",
  "CA-Central (Montreal)", "ME-Central (Dubai)"
];

const clientTypes = ["Web App", "iOS Client", "Android App", "Partner API", "Worker Daemon"];

const mockClients = Array.from({ length: 50 }, (_, i) => {
  const userNum = i + 1;
  const subnet = Math.floor(i / 25) + 1;
  const host = (i % 25) + 1;
  const ip = `192.168.${subnet}.${host}`;
  const region = clientRegions[i % clientRegions.length];
  const type = clientTypes[i % clientTypes.length];
  return {
    ip,
    label: `User ${userNum} (${type} — ${region})`,
    userNum,
    region,
    type
  };
});

const algorithmDetails = {
  "token-bucket": {
    name: "Token Bucket",
    desc: "Tokens refill at a constant rate up to bucket capacity. Allows temporary traffic bursts while enforcing strict sustained limits.",
    store: "Redis / In-Memory",
    burstFriendly: true,
  },
  "fixed-window": {
    name: "Fixed Window Counter",
    desc: "Tracks request count in fixed time blocks (e.g. 1 minute). Simple and memory efficient, but vulnerable to boundary burst doubling.",
    store: "In-Memory",
    burstFriendly: false,
  },
  "sliding-window": {
    name: "Sliding Window Log",
    desc: "Tracks precise timestamps of recent requests. Completely eliminates boundary spikes, providing smooth rate limiting.",
    store: "In-Memory",
    burstFriendly: false,
  },
  "leaky-bucket": {
    name: "Leaky Bucket",
    desc: "Requests enter a queue and are processed at a smooth, constant output rate. Drops excess requests when queue overflows.",
    store: "In-Memory",
    burstFriendly: false,
  }
};

export default function App() {
  const [bucket, setBucket] = useState({
    remaining: null,
    availableTokens: null,
    limit: 20,
    store: "memory",
    algorithm: "token-bucket"
  });
  const [metrics, setMetrics] = useState(emptyMetrics);
  const [rules, setRules] = useState({ limit: 20, window: "1m" });
  const [activeAlgorithm, setActiveAlgorithm] = useState("token-bucket");
  const [algorithms, setAlgorithms] = useState([
    "token-bucket",
    "fixed-window",
    "sliding-window",
    "leaky-bucket"
  ]);
  const [draftRules, setDraftRules] = useState({ limit: 20, window: "1m" });
  const [activeSection, setActiveSection] = useState("dashboard");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [trafficFilter, setTrafficFilter] = useState("all");
  const [inspectedRequest, setInspectedRequest] = useState(null);

  // Traffic Simulator State
  const [simTargetEndpoint, setSimTargetEndpoint] = useState("/api/proxy/api/rooms?mock=true");
  const [simClientIp, setSimClientIp] = useState(mockClients[0].ip);
  const [simRps, setSimRps] = useState(4);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simPreset, setSimPreset] = useState("normal");
  const [burstLoading, setBurstLoading] = useState(false);
  const [multiUserProgress, setMultiUserProgress] = useState(null);
  const [lastResponse, setLastResponse] = useState(null);

  const simulationTimerRef = useRef(null);

  // Fetch Dashboard Data
  const refreshDashboard = async () => {
    try {
      const [statusResponse, dashboardResponse] = await Promise.all([
        fetch(apiUrl("/api/status"), {
          headers: { "x-simulated-ip": simClientIp }
        }),
        fetch(apiUrl("/api/dashboard"))
      ]);
      const [status, dashboard] = await Promise.all([
        statusResponse.json(),
        dashboardResponse.json()
      ]);
      if (!statusResponse.ok || !dashboardResponse.ok) {
        throw new Error(
          status.message || dashboard.message || "Dashboard refresh failed"
        );
      }
      setBucket(status);
      setMetrics({
        ...emptyMetrics,
        ...dashboard.metrics,
        redis: dashboard.redis
      });
      setRules(dashboard.rules);
      setActiveAlgorithm(dashboard.activeAlgorithm);
      if (dashboard.algorithms?.length) {
        setAlgorithms(dashboard.algorithms);
      }
      setError("");
    } catch (fetchError) {
      setError(fetchError.message);
    }
  };

  // Switch Active Rate Limiting Algorithm
  const selectAlgorithm = async (algorithm) => {
    setError("");
    try {
      const response = await fetch(apiUrl("/admin/algorithm"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ algorithm })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Could not change algorithm");
      }
      setActiveAlgorithm(data.activeAlgorithm);
      refreshDashboard();
    } catch (fetchError) {
      setError(fetchError.message);
    }
  };

  // Save Policy Rules
  const saveRules = async (event) => {
    if (event) event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/admin/rules"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draftRules,
          limit: Number(draftRules.limit)
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Could not update rules");
      }
      setRules(data);
      setDraftRules({ limit: data.limit, window: data.window });
      refreshDashboard();
    } catch (fetchError) {
      setError(fetchError.message);
    } finally {
      setSaving(false);
    }
  };

  // Reset Metrics
  const handleResetMetrics = async () => {
    try {
      const response = await fetch(apiUrl("/api/reset-metrics"), { method: "POST" });
      const data = await response.json();
      if (data.metrics) {
        setMetrics({ ...emptyMetrics, ...data.metrics });
      }
      setLastResponse(null);
      refreshDashboard();
    } catch (err) {
      setError(err.message);
    }
  };

  // Send Single Simulated HTTP Request to Gateway
  const sendSingleRequest = async (overrideIp, overrideEndpoint) => {
    const target = overrideEndpoint || simTargetEndpoint;
    const client = overrideIp || simClientIp;
    const start = performance.now();

    try {
      const response = await fetch(apiUrl(target), {
        headers: {
          "x-simulated-ip": client,
          "Accept": "application/json"
        }
      });
      const latencyMs = Number((performance.now() - start).toFixed(1));
      let responseBody = null;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = { status: response.status, text: await response.text() };
      }

      const headers = {
        limit: response.headers.get("X-RateLimit-Limit"),
        remaining: response.headers.get("X-RateLimit-Remaining"),
        reset: response.headers.get("X-RateLimit-Reset"),
      };

      const result = {
        id: Math.random().toString(36).substring(2, 9),
        time: new Date(),
        endpoint: target.split("?")[0],
        clientIp: client,
        status: response.status,
        allowed: response.status !== 429,
        latencyMs,
        headers,
        body: responseBody
      };

      setLastResponse(result);
      refreshDashboard();
      return result;
    } catch (err) {
      const failedResult = {
        id: Math.random().toString(36).substring(2, 9),
        time: new Date(),
        endpoint: target.split("?")[0],
        clientIp: client,
        status: 500,
        allowed: false,
        latencyMs: Number((performance.now() - start).toFixed(1)),
        error: err.message
      };
      setLastResponse(failedResult);
      return failedResult;
    }
  };

  // Send Burst of Requests for currently selected client
  const sendBurst = async (count = 10) => {
    setBurstLoading(true);
    setMultiUserProgress(null);
    const promises = [];
    for (let i = 0; i < count; i++) {
      let ip = simClientIp;
      if (simPreset === "attack" || simPreset === "multi") {
        ip = mockClients[i % mockClients.length].ip;
      }
      promises.push(
        new Promise((resolve) => {
          setTimeout(async () => {
            const res = await sendSingleRequest(ip, simTargetEndpoint);
            resolve(res);
          }, i * 20);
        })
      );
    }
    await Promise.all(promises);
    setBurstLoading(false);
    refreshDashboard();
  };

  // Send Requests Concurrently from 50 Distinct Users (Multi-Client Rate Limiting Evaluation)
  const sendMultiUserRequests = async (userCount = 50, reqsPerUser = 1) => {
    setBurstLoading(true);
    const targetClients = mockClients.slice(0, userCount);
    const totalRequests = targetClients.length * reqsPerUser;
    let allowedCount = 0;
    let blockedCount = 0;
    let completedCount = 0;

    setMultiUserProgress({
      total: totalRequests,
      completed: 0,
      allowed: 0,
      blocked: 0,
      activeUsers: targetClients.length
    });

    const promises = [];
    targetClients.forEach((client, idx) => {
      for (let r = 0; r < reqsPerUser; r++) {
        promises.push(
          new Promise((resolve) => {
            setTimeout(async () => {
              const res = await sendSingleRequest(client.ip, simTargetEndpoint);
              completedCount++;
              if (res && res.allowed) allowedCount++;
              else blockedCount++;
              setMultiUserProgress({
                total: totalRequests,
                completed: completedCount,
                allowed: allowedCount,
                blocked: blockedCount,
                activeUsers: targetClients.length
              });
              resolve(res);
            }, idx * 15 + r * 5);
          })
        );
      }
    });

    await Promise.all(promises);
    setBurstLoading(false);
    refreshDashboard();
  };

  // Simulator Preset Handler
  const applyPreset = (presetKey) => {
    setSimPreset(presetKey);
    if (presetKey === "normal") {
      setSimRps(3);
      setSimClientIp(mockClients[0].ip);
    } else if (presetKey === "spike") {
      setSimRps(12);
      setSimClientIp(mockClients[0].ip);
    } else if (presetKey === "attack") {
      setSimRps(25);
    } else if (presetKey === "multi") {
      setSimRps(10);
    }
  };

  // Continuous Simulation Loop
  useEffect(() => {
    if (isSimulating) {
      const intervalMs = Math.max(30, Math.floor(1000 / simRps));
      let counter = 0;
      simulationTimerRef.current = setInterval(() => {
        counter++;
        let targetIp = simClientIp;
        let targetEp = simTargetEndpoint;

        if (simPreset === "attack" || simPreset === "multi") {
          targetIp = mockClients[counter % mockClients.length].ip;
        }
        if (simPreset === "multi") {
          targetEp = mockEndpoints[counter % mockEndpoints.length].path;
        }

        sendSingleRequest(targetIp, targetEp);
      }, intervalMs);
    } else {
      if (simulationTimerRef.current) {
        clearInterval(simulationTimerRef.current);
        simulationTimerRef.current = null;
      }
    }

    return () => {
      if (simulationTimerRef.current) {
        clearInterval(simulationTimerRef.current);
      }
    };
  }, [isSimulating, simRps, simClientIp, simTargetEndpoint, simPreset]);

  // Periodic Dashboard Polling
  useEffect(() => {
    refreshDashboard();
    const interval = setInterval(refreshDashboard, 2000);
    return () => clearInterval(interval);
  }, [simClientIp]);

  // Derived Endpoint Stats
  const endpointStats = useMemo(() => {
    const stats = new Map();
    mockEndpoints.forEach(ep => {
      const cleanPath = ep.path.split("?")[0];
      stats.set(cleanPath, { endpoint: cleanPath, name: ep.name, requests: 0, blocked: 0 });
    });
    metrics.recentRequests.forEach((request) => {
      const cleanReqPath = request.endpoint.split("?")[0];
      const current = stats.get(cleanReqPath) || {
        endpoint: cleanReqPath,
        name: cleanReqPath.replace("/api/proxy", "") || "Gateway",
        requests: 0,
        blocked: 0,
      };
      current.requests += 1;
      if (!request.allowed) current.blocked += 1;
      stats.set(cleanReqPath, current);
    });
    return [...stats.values()].sort((a, b) => b.requests - a.requests);
  }, [metrics.recentRequests]);

  // Filtered Traffic Stream (20 Latest Logs)
  const filteredRequests = useMemo(() => {
    let list = metrics.recentRequests;
    if (trafficFilter === "allowed") {
      list = metrics.recentRequests.filter((r) => r.allowed);
    } else if (trafficFilter === "blocked") {
      list = metrics.recentRequests.filter((r) => !r.allowed);
    }
    return list.slice(0, 20);
  }, [metrics.recentRequests, trafficFilter]);

  const availableTokens = bucket.availableTokens ?? bucket.remaining ?? rules.limit;
  const limit = bucket.limit ?? rules.limit;
  const meterPercent = limit
    ? Math.max(0, Math.min(100, (availableTokens / limit) * 100))
    : 100;
  const gatewayHealthy = !error;

  return (
    <div className="min-h-screen bg-[#141d2e] text-slate-200 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* Top Header / Navigation Bar */}
      <header className="sticky top-0 z-40 border-b border-[#2b3a52] bg-[#1a253a] px-4 py-2.5 lg:px-8 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-[#25354e] border border-[#374b6c] font-bold text-slate-100">
            <span className="text-xs font-mono font-semibold tracking-wider">RL</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold tracking-tight text-white">
              RateLimiter Gateway
            </span>
            <span className="rounded bg-[#25354e] px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 border border-[#374b6c]">
              Live Gateway
            </span>
          </div>
        </div>

        {/* Header Right Status & Controls */}
        <div className="flex items-center gap-3">
          {isSimulating && (
            <div className="flex items-center gap-2 rounded-lg bg-[#162923] px-3 py-1.5 text-xs font-medium text-emerald-400 border border-[#1f5341]">
              <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
              <span>Simulator Active ({simRps} RPS)</span>
            </div>
          )}

          <button
            onClick={handleResetMetrics}
            className="rounded-lg bg-[#273752] hover:bg-[#314464] text-slate-300 border border-[#384c6e] px-3 py-1.5 text-xs font-medium transition cursor-pointer"
            title="Reset all metrics and decision counters"
          >
            Reset Metrics
          </button>
        </div>
      </header>

      {/* Main Layout Container */}
      <div className="flex flex-1 min-h-0">
        {/* Left Navigation Sidebar */}
        <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-[#2b3a52] bg-[#162033] p-4 space-y-6">
          <div>
            <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Gateway Navigation
            </p>
            <nav className="mt-2 space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveSection(item.id);
                    document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium transition cursor-pointer border ${
                    activeSection === item.id
                      ? "bg-[#273752] text-white border-[#3d5275] font-semibold"
                      : "text-slate-400 border-transparent hover:bg-[#202c42] hover:text-slate-200"
                  }`}
                >
                  <span>{item.label}</span>
                  {item.id === "simulator" && isSimulating ? (
                    <span className="flex h-2 w-2 rounded-full bg-emerald-500"></span>
                  ) : item.id === "traffic" && metrics.total > 0 ? (
                    <span className="rounded bg-[#1c283f] px-1.5 py-0.5 text-[10px] font-mono text-slate-300 border border-[#2d3d58]">
                      {metrics.total}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500">{item.tag}</span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* Rate Limiter Quick Info Card */}
          <div className="rounded-lg border border-[#2d3d58] bg-[#1c283f] p-3 text-xs space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">Limiter Engine</span>
              <span className="rounded bg-[#121a2a] px-1.5 py-0.5 text-[10px] font-mono text-slate-300 border border-[#2b3a52]">
                {bucket.store === "redis" ? "Redis" : "Memory"}
              </span>
            </div>
            <div className="space-y-1 text-slate-400 text-[11px]">
              <div className="flex justify-between">
                <span>Active Algorithm:</span>
                <span className="font-semibold text-slate-200">{formatAlgorithm(activeAlgorithm)}</span>
              </div>
              <div className="flex justify-between">
                <span>Window / Limit:</span>
                <span className="font-mono text-slate-200">{rules.limit} req / {rules.window}</span>
              </div>
              <div className="flex justify-between">
                <span>Refill Rate:</span>
                <span className="font-mono text-emerald-400 font-semibold">
                  {rules.limit > 0 ? `+1 tok / ${(60 / rules.limit).toFixed(1)}s` : "-"}
                </span>
              </div>
            </div>
          </div>

          {/* System Health Summary */}
          <div className="mt-auto pt-4 border-t border-[#2b3a52] space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                Gateway
              </span>
              <span className="text-emerald-400 font-mono font-medium">200 OK</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className={`h-2 w-2 rounded-full ${metrics.redis?.connected ? "bg-emerald-500" : "bg-amber-500"}`}></span>
                Redis Cache
              </span>
              <span className={`font-mono ${metrics.redis?.connected ? "text-emerald-400" : "text-amber-400"}`}>
                {metrics.redis?.connected ? `${metrics.redis.latencyMs || 1}ms` : "In-Memory"}
              </span>
            </div>
          </div>
        </aside>

        {/* Center Content Section */}
        <main className="flex-1 min-w-0 p-4 lg:p-7 space-y-6 overflow-y-auto">
          {error && (
            <div className="rounded-lg border border-rose-900 bg-[#3a1820] p-3.5 text-xs text-rose-300 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-bold">Error:</span>
                <span>{error}</span>
              </div>
              <button
                onClick={() => setError("")}
                className="text-rose-400 hover:text-white font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          )}

          {/* Section 1: Top KPI Cards */}
          <section id="dashboard" className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard
              tag="Total"
              label="Total Requests"
              value={formatNumber(metrics.total)}
              subtext={`${metrics.recentRequests.length} in buffer`}
              tone="text-slate-100"
            />
            <StatCard
              tag="Allowed"
              label="Allowed (200)"
              value={formatNumber(metrics.allowed)}
              subtext={metrics.total ? `${((metrics.allowed / metrics.total) * 100).toFixed(0)}% allowed` : "100% capacity"}
              tone="text-emerald-400"
            />
            <StatCard
              tag="Blocked"
              label="Blocked (429)"
              value={formatNumber(metrics.blocked)}
              subtext={`${metrics.blockedRate}% rate-limited`}
              tone="text-rose-400"
            />
            <StatCard
              tag="Clients"
              label="Active Clients"
              value={formatNumber(metrics.activeUsers)}
              subtext="Unique IPs tracked"
              tone="text-slate-200"
            />
            <StatCard
              tag="Latency"
              label="Avg Decision Latency"
              value={`${metrics.averageResponseTimeMs || 0.4} ms`}
              subtext="Sub-millisecond eval"
              tone="text-slate-200"
            />
            <StatCard
              tag="Peak"
              label="Peak Gateway RPS"
              value={metrics.peakRps || 0}
              subtext="5-min rolling peak"
              tone="text-slate-200"
            />
          </section>

          {/* Section 2: Dual-Series Real-Time RPS Traffic Graph (5-Minute Timeline) */}
          <section className="rounded-xl border border-[#2d3d58] bg-[#1c283f] p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2b3a52] pb-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Real-Time Gateway Metrics
                </p>
                <h2 className="text-sm font-bold text-white tracking-tight">
                  Requests Per Second (RPS) — Last 5 Minutes Timeline
                </h2>
              </div>
              <div className="flex items-center gap-4 text-xs font-medium">
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                  Allowed (200)
                </span>
                <span className="flex items-center gap-1.5 text-rose-400">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500"></span>
                  Blocked (429)
                </span>
                <span className="rounded bg-[#121a2a] px-2 py-0.5 text-slate-300 font-mono border border-[#2b3a52]">
                  Peak: {metrics.peakRps} RPS
                </span>
              </div>
            </div>

            {/* Custom Dual-Series Area SVG Chart for 5-minute timeline */}
            <DualSeriesTrafficGraph points={metrics.requestSeries} />

            <div className="flex justify-between text-[11px] text-slate-400 font-mono pt-1">
              <span>5 minutes ago</span>
              <span>2.5 minutes ago</span>
              <span>Now (Live)</span>
            </div>
          </section>

          {/* Section 3: Interactive Traffic Station & Compact Token Bucket Gauge */}
          <section id="simulator" className="grid gap-5 xl:grid-cols-[1.65fr_0.85fr]">
            {/* Live Traffic Simulator Control Station */}
            <div className="rounded-xl border border-[#2d3d58] bg-[#1c283f] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2b3a52] pb-3">
                <div>
                  <h2 className="text-sm font-bold text-white tracking-tight">
                    Interactive Traffic Control Station
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Simulate real client traffic, load spikes, and attacks to test rate limiting
                  </p>
                </div>

                {/* Status Indicator */}
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium border ${
                    isSimulating
                      ? "bg-[#162923] text-emerald-400 border-[#1f5341]"
                      : "bg-[#141d2e] text-slate-400 border-[#2b3a52]"
                  }`}>
                    <span className={`h-2 w-2 rounded-full ${isSimulating ? "bg-emerald-500" : "bg-slate-500"}`}></span>
                    {isSimulating ? `Active (${simRps} req/s)` : "Idle"}
                  </span>
                </div>
              </div>

              {/* Simulation Preset Quick Selector */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 mb-2 uppercase tracking-wider">
                  Select Traffic Scenario
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <PresetButton
                    active={simPreset === "normal"}
                    onClick={() => applyPreset("normal")}
                    title="Normal Traffic"
                    subtitle="3 RPS (Single User)"
                    desc="Steady requests within token bucket limit."
                  />
                  <PresetButton
                    active={simPreset === "spike"}
                    onClick={() => applyPreset("spike")}
                    title="Traffic Surge"
                    subtitle="12 RPS (Single User)"
                    desc="Tests burst capacity and token depletion."
                  />
                  <PresetButton
                    active={simPreset === "attack"}
                    onClick={() => applyPreset("attack")}
                    title="DDoS Attack"
                    subtitle="25 RPS (50 Users)"
                    desc="Aggressive overload rotating across 50 users."
                  />
                  <PresetButton
                    active={simPreset === "multi"}
                    onClick={() => applyPreset("multi")}
                    title="50-User Swarm"
                    subtitle="10 RPS (50 Users)"
                    desc="Distributed multi-user & endpoint simulation."
                  />
                </div>
              </div>

              {/* 50-User Swarm Quick Trigger Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-[#121a2a] border border-[#2b3a52] text-xs">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-[#1e2f4a] text-blue-300 font-mono text-[11px] px-2 py-0.5 border border-[#2b446a] font-semibold">
                    50-User Pool
                  </span>
                  <span className="text-slate-300">
                    50 unique client IPs ready for multi-tenant rate limiting
                  </span>
                </div>
                <button
                  id="sim-dispatch-50-btn"
                  onClick={() => sendMultiUserRequests(50)}
                  disabled={burstLoading}
                  className="rounded bg-blue-600 hover:bg-blue-700 text-white font-medium py-1.5 px-3 text-xs transition cursor-pointer disabled:opacity-50 active:scale-95"
                >
                  {burstLoading && multiUserProgress ? "Simulating..." : "Send 50 Users (1 Req Each)"}
                </button>
              </div>

              {/* Simulator Config Grid */}
              <div className="grid gap-3 sm:grid-cols-2 pt-1">
                <div>
                  <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                    Target Gateway Route
                  </label>
                  <select
                    className="w-full rounded border border-[#334563] bg-[#121a2a] px-3 py-2 text-xs font-mono text-slate-200 focus:border-slate-400 focus:outline-none"
                    value={simTargetEndpoint}
                    onChange={(e) => setSimTargetEndpoint(e.target.value)}
                  >
                    {mockEndpoints.map((ep) => (
                      <option key={ep.path} value={ep.path}>
                        {ep.path.split("?")[0]} ({ep.name})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                    Simulated Client IP (50 Available)
                  </label>
                  <select
                    className="w-full rounded border border-[#334563] bg-[#121a2a] px-3 py-2 text-xs font-mono text-slate-200 focus:border-slate-400 focus:outline-none"
                    value={simClientIp}
                    onChange={(e) => setSimClientIp(e.target.value)}
                  >
                    <optgroup label="Users 1 – 10 (US & EU Regions)">
                      {mockClients.slice(0, 10).map((client) => (
                        <option key={client.ip} value={client.ip}>
                          {client.ip} — {client.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Users 11 – 20 (Asia-Pacific & Global)">
                      {mockClients.slice(10, 20).map((client) => (
                        <option key={client.ip} value={client.ip}>
                          {client.ip} — {client.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Users 21 – 30 (Americas & EMEA)">
                      {mockClients.slice(20, 30).map((client) => (
                        <option key={client.ip} value={client.ip}>
                          {client.ip} — {client.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Users 31 – 40 (Mobile Clients)">
                      {mockClients.slice(30, 40).map((client) => (
                        <option key={client.ip} value={client.ip}>
                          {client.ip} — {client.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Users 41 – 50 (Partner APIs & Workers)">
                      {mockClients.slice(40, 50).map((client) => (
                        <option key={client.ip} value={client.ip}>
                          {client.ip} — {client.label}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
              </div>

              {/* Interactive RPS Slider */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-300">Continuous Stream Rate:</span>
                  <span className="font-mono font-semibold text-slate-200 bg-[#141d2e] px-2 py-0.5 rounded border border-[#2b3a52]">
                    {simRps} requests / sec
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="30"
                  value={simRps}
                  onChange={(e) => setSimRps(Number(e.target.value))}
                  className="w-full h-1.5 bg-[#121a2a] rounded appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between text-[10px] font-mono text-slate-400">
                  <span>1 req/s (Gentle)</span>
                  <span>10 req/s (Moderate)</span>
                  <span>20 req/s (Heavy)</span>
                  <span>30 req/s (Flooding)</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#2b3a52]">
                <button
                  id="sim-send-single-btn"
                  onClick={() => sendSingleRequest()}
                  className="flex-1 min-w-[120px] rounded bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-3 text-xs flex items-center justify-center transition active:scale-95 cursor-pointer"
                >
                  Send 1 Request
                </button>
                <button
                  id="sim-burst-10-btn"
                  onClick={() => sendBurst(10)}
                  disabled={burstLoading}
                  className="flex-1 min-w-[100px] rounded bg-[#273752] hover:bg-[#314464] text-slate-200 border border-[#384c6e] font-medium py-2 px-3 text-xs flex items-center justify-center transition active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  Burst 10x
                </button>
                <button
                  id="sim-burst-30-btn"
                  onClick={() => sendBurst(30)}
                  disabled={burstLoading}
                  className="flex-1 min-w-[100px] rounded bg-[#273752] hover:bg-[#314464] text-slate-200 border border-[#384c6e] font-medium py-2 px-3 text-xs flex items-center justify-center transition active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  Surge 30x
                </button>
                <button
                  id="sim-50-users-btn"
                  onClick={() => sendMultiUserRequests(50)}
                  disabled={burstLoading}
                  className="flex-1 min-w-[150px] rounded bg-[#1e3a5f] hover:bg-[#254673] text-blue-200 border border-[#3b5d8f] font-semibold py-2 px-3 text-xs flex items-center justify-center transition active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  {burstLoading && multiUserProgress ? `Sending (${multiUserProgress.completed}/${multiUserProgress.total})...` : "Send 50 Users"}
                </button>
                <button
                  id="sim-toggle-stream-btn"
                  onClick={() => setIsSimulating(!isSimulating)}
                  className={`flex-1 min-w-[150px] rounded font-medium py-2 px-3 text-xs flex items-center justify-center transition active:scale-95 cursor-pointer border ${
                    isSimulating
                      ? "bg-amber-600 hover:bg-amber-700 text-white border-amber-600"
                      : "bg-[#273752] hover:bg-[#314464] text-slate-200 border-[#384c6e]"
                  }`}
                >
                  {isSimulating ? "Stop Stream" : "Start Continuous Stream"}
                </button>
              </div>

              {/* 50 Users Live Progress / Summary Banner */}
              {multiUserProgress && (
                <div className="rounded p-3 text-xs border border-[#2b446a] bg-[#132238] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-[#1c3558] px-2 py-0.5 text-xs font-mono font-bold text-blue-300 border border-[#31568c]">
                      50 Users
                    </span>
                    <span className="text-slate-200 font-medium">
                      Multi-User Dispatch: {multiUserProgress.completed} / {multiUserProgress.total} requests processed across {multiUserProgress.activeUsers} client IPs
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-mono">
                    <span className="text-emerald-400 font-semibold">{multiUserProgress.allowed} Allowed (200)</span>
                    <span className="text-rose-400 font-semibold">{multiUserProgress.blocked} Blocked (429)</span>
                  </div>
                </div>
              )}

              {/* Live Response Inspector Banner */}
              {lastResponse && (
                <div className={`rounded p-3 text-xs border flex items-center justify-between ${
                  lastResponse.allowed
                    ? "bg-[#11211e] border-[#1f4a3c] text-emerald-200"
                    : "bg-[#2d161c] border-[#592732] text-rose-200"
                }`}>
                  <div className="flex items-center gap-2.5">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-mono font-bold ${
                      lastResponse.allowed ? "bg-[#17523f] text-emerald-300" : "bg-[#612431] text-rose-300"
                    }`}>
                      {lastResponse.allowed ? "200" : "429"}
                    </span>
                    <div>
                      <span className="font-semibold text-white">
                        {lastResponse.allowed ? "HTTP 200 OK — Allowed" : "HTTP 429 — Rate Limit Exceeded"}
                      </span>
                      <p className="text-[11px] text-slate-400 font-mono">
                        Route: {lastResponse.endpoint} | Client: {lastResponse.clientIp} | {lastResponse.latencyMs}ms
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setInspectedRequest(lastResponse)}
                    className="rounded bg-[#273752] hover:bg-[#314464] px-2.5 py-1 text-[11px] font-medium text-slate-200 border border-[#384c6e] transition cursor-pointer"
                  >
                    Inspect
                  </button>
                </div>
              )}
            </div>

            {/* Compact Token Bucket Capacity Gauge */}
            <div className="rounded-xl border border-[#2d3d58] bg-[#1c283f] p-4 flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between border-b border-[#2b3a52] pb-2.5">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Gauge</p>
                  <h3 className="text-xs font-bold text-white">
                    Token Bucket State
                  </h3>
                </div>
                <span className="text-[10px] font-mono rounded bg-[#121a2a] px-2 py-0.5 text-slate-300 border border-[#2b3a52]">
                  {simClientIp}
                </span>
              </div>

              {/* Compact Visual Circular Meter */}
              <div className="py-1 text-center space-y-2">
                <div className="relative mx-auto w-24 h-24 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    <circle
                      cx="50"
                      cy="50"
                      r="38"
                      className="text-[#121a2a]"
                      strokeWidth="7"
                      stroke="currentColor"
                      fill="transparent"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="38"
                      strokeWidth="7"
                      strokeDasharray={2 * Math.PI * 38}
                      strokeDashoffset={2 * Math.PI * 38 * (1 - meterPercent / 100)}
                      strokeLinecap="round"
                      className={`transition-all duration-300 ${
                        meterPercent > 50
                          ? "text-emerald-500"
                          : meterPercent > 20
                          ? "text-amber-500"
                          : "text-rose-500"
                      }`}
                      stroke="currentColor"
                      fill="transparent"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xl font-bold tracking-tight font-mono text-white">
                      {typeof availableTokens === "number" ? availableTokens.toFixed(0) : rules.limit}
                    </span>
                    <span className="text-[9px] text-slate-400 font-mono">
                      / {rules.limit}
                    </span>
                  </div>
                </div>

                <p className="text-[11px] text-slate-300 font-medium">
                  {availableTokens > 0
                    ? `${availableTokens.toFixed(1)} tokens available`
                    : "Bucket depleted: 429 limiting"}
                </p>
              </div>

              {/* Compact Bucket Metadata Breakdown */}
              <div className="rounded bg-[#121a2a] p-2.5 space-y-1.5 border border-[#2b3a52] text-[11px]">
                <div className="flex justify-between text-slate-400">
                  <span>Capacity / Window:</span>
                  <span className="font-mono text-slate-200">{rules.limit} tok / {rules.window}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Refill Speed:</span>
                  <span className="font-mono text-emerald-400">
                    +{rules.limit > 0 ? (rules.limit / 60).toFixed(2) : 0} tok / sec
                  </span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Engine:</span>
                  <span className="font-mono text-slate-300">
                    {bucket.store === "redis" ? "Redis" : "In-Memory"}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Section 4: Live Traffic Stream / Logs */}
          <section id="traffic" className="rounded-xl border border-[#2d3d58] bg-[#1c283f] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2b3a52] pb-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Live Traffic Stream
                </p>
                <h2 className="text-sm font-bold text-white tracking-tight">
                  Recent Gateway Decisions (Latest 20 Logs)
                </h2>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-1 rounded bg-[#121a2a] p-1 border border-[#2b3a52] text-xs">
                <button
                  onClick={() => setTrafficFilter("all")}
                  className={`rounded px-2.5 py-1 font-medium transition cursor-pointer border ${
                    trafficFilter === "all" ? "bg-[#273752] text-white border-[#3d5275]" : "text-slate-400 border-transparent hover:text-slate-200"
                  }`}
                >
                  All ({Math.min(20, metrics.recentRequests.length)})
                </button>
                <button
                  onClick={() => setTrafficFilter("allowed")}
                  className={`rounded px-2.5 py-1 font-medium transition cursor-pointer border ${
                    trafficFilter === "allowed" ? "bg-[#273752] text-emerald-400 border-[#3d5275]" : "text-slate-400 border-transparent hover:text-emerald-400"
                  }`}
                >
                  Allowed (200)
                </button>
                <button
                  onClick={() => setTrafficFilter("blocked")}
                  className={`rounded px-2.5 py-1 font-medium transition cursor-pointer border ${
                    trafficFilter === "blocked" ? "bg-[#273752] text-rose-400 border-[#3d5275]" : "text-slate-400 border-transparent hover:text-rose-400"
                  }`}
                >
                  Blocked (429)
                </button>
              </div>
            </div>

            {/* Decisions Table */}
            {filteredRequests.length === 0 ? (
              <div className="rounded border border-dashed border-[#2b3a52] bg-[#121a2a]/60 p-8 text-center space-y-3">
                <p className="text-sm font-medium text-slate-300">
                  No gateway decisions recorded yet
                </p>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Click <strong>&quot;Send 1x&quot;</strong>, <strong>&quot;Burst 10x&quot;</strong>, or <strong>&quot;Start Continuous Stream&quot;</strong> in the Traffic Simulator above to generate test requests.
                </p>
                <button
                  onClick={() => sendBurst(10)}
                  className="rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-4 py-2 transition cursor-pointer"
                >
                  Generate Test Traffic Now
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#2b3a52] text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-[#162134]">
                    <tr>
                      <th className="px-3 py-2.5">Time</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5">Target Route</th>
                      <th className="px-3 py-2.5">Client IP</th>
                      <th className="px-3 py-2.5">Algorithm</th>
                      <th className="px-3 py-2.5 text-right">Latency</th>
                      <th className="px-3 py-2.5 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#24334a] font-mono">
                    {filteredRequests.map((item, idx) => (
                      <tr
                        key={item.id || `${item.ip}-${item.time}-${idx}`}
                        className="hover:bg-[#202e47] transition group"
                      >
                        <td className="px-3 py-2.5 text-slate-400">
                          {new Date(item.time).toLocaleTimeString()}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium border ${
                              item.allowed
                                ? "bg-[#112720] text-emerald-300 border-[#1f4e3f]"
                                : "bg-[#33151b] text-rose-300 border-[#5e232e]"
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${item.allowed ? "bg-emerald-500" : "bg-rose-500"}`}></span>
                            {item.allowed ? "200 Allowed" : "429 Blocked"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-200 font-medium">
                          {item.endpoint.split("?")[0]}
                        </td>
                        <td className="px-3 py-2.5 text-slate-300">
                          {item.ip}
                        </td>
                        <td className="px-3 py-2.5 text-slate-300 font-sans">
                          {formatAlgorithm(item.algorithm)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-400">
                          {item.responseTimeMs ? `${item.responseTimeMs} ms` : "< 1 ms"}
                        </td>
                        <td className="px-3 py-2.5 text-center font-sans">
                          <button
                            onClick={() => setInspectedRequest(item)}
                            className="text-[11px] text-slate-400 hover:text-white underline underline-offset-2 transition cursor-pointer"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Section 5: Policies & Algorithm Configuration */}
          <section id="policies" className="grid gap-5 lg:grid-cols-2">
            {/* Policy Configuration Form */}
            <article className="rounded-xl border border-[#2d3d58] bg-[#1c283f] p-5 space-y-4">
              <div className="border-b border-[#2b3a52] pb-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Rate Limit Rules
                </p>
                <h3 className="text-sm font-bold text-white tracking-tight">
                  Update Active Policy Rules
                </h3>
              </div>

              <form onSubmit={saveRules} className="space-y-3.5">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                      Max Requests Limit
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="10000"
                      value={draftRules.limit}
                      onChange={(e) => setDraftRules((cur) => ({ ...cur, limit: e.target.value }))}
                      className="w-full rounded border border-[#334563] bg-[#121a2a] px-3 py-2 text-xs font-mono text-slate-200 focus:border-slate-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                      Window Duration (e.g. 1m, 30s, 10s)
                    </label>
                    <input
                      type="text"
                      value={draftRules.window}
                      onChange={(e) => setDraftRules((cur) => ({ ...cur, window: e.target.value }))}
                      className="w-full rounded border border-[#334563] bg-[#121a2a] px-3 py-2 text-xs font-mono text-slate-200 focus:border-slate-400 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Quick Presets */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[10px] text-slate-400 font-semibold">Presets:</span>
                  <button
                    type="button"
                    onClick={() => setDraftRules({ limit: 10, window: "10s" })}
                    className="rounded bg-[#273752] hover:bg-[#314464] px-2 py-1 text-[10px] font-mono text-slate-300 border border-[#384c6e] transition cursor-pointer"
                  >
                    10 req / 10s
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftRules({ limit: 20, window: "1m" })}
                    className="rounded bg-[#273752] hover:bg-[#314464] px-2 py-1 text-[10px] font-mono text-slate-300 border border-[#384c6e] transition cursor-pointer"
                  >
                    20 req / 1m
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftRules({ limit: 50, window: "1m" })}
                    className="rounded bg-[#273752] hover:bg-[#314464] px-2 py-1 text-[10px] font-mono text-slate-300 border border-[#384c6e] transition cursor-pointer"
                  >
                    50 req / 1m
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftRules({ limit: 100, window: "1m" })}
                    className="rounded bg-[#273752] hover:bg-[#314464] px-2 py-1 text-[10px] font-mono text-slate-300 border border-[#384c6e] transition cursor-pointer"
                  >
                    100 req / 1m
                  </button>
                </div>

                <button
                  disabled={saving}
                  className="w-full rounded bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 text-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {saving ? "Updating Gateway Policy..." : "Apply Policy Immediately"}
                </button>
              </form>
            </article>

            {/* Algorithm Switcher */}
            <article className="rounded-xl border border-[#2d3d58] bg-[#1c283f] p-5 space-y-4">
              <div className="border-b border-[#2b3a52] pb-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Rate Limiting Algorithms
                </p>
                <h3 className="text-sm font-bold text-white tracking-tight">
                  Select Active Limiting Strategy
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {algorithms.map((algoKey) => {
                  const info = algorithmDetails[algoKey] || { name: algoKey, desc: "", store: "Memory" };
                  const isSelected = activeAlgorithm === algoKey;
                  return (
                    <button
                      key={algoKey}
                      onClick={() => selectAlgorithm(algoKey)}
                      className={`rounded-lg p-3 text-left border transition cursor-pointer ${
                        isSelected
                          ? "bg-[#253650] border-[#445b80] text-white"
                          : "bg-[#121a2a] border-[#2b3a52] text-slate-400 hover:bg-[#1a2538] hover:text-slate-200"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-xs text-slate-100">{info.name}</p>
                        {isSelected && (
                          <span className="rounded bg-blue-600 px-1.5 py-0.2 text-[9px] text-white font-medium">Active</span>
                        )}
                      </div>
                      <p className="mt-1 text-[10px] text-slate-400 line-clamp-2">{info.desc}</p>
                      <span className="mt-2 inline-block rounded bg-[#162134] px-1.5 py-0.5 text-[9px] font-mono text-slate-400 border border-[#2b3a52]">
                        {info.store}
                      </span>
                    </button>
                  );
                })}
              </div>
            </article>
          </section>

          {/* Section 6: Algorithm Performance Comparison Matrix */}
          <section id="analytics" className="rounded-xl border border-[#2d3d58] bg-[#1c283f] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#2b3a52] pb-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Benchmarking & Analytics
                </p>
                <h3 className="text-sm font-bold text-white tracking-tight">
                  Per-Algorithm Comparison Matrix
                </h3>
              </div>
              <span className="text-xs text-slate-400">
                Metrics collected per active algorithm session
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {algorithms.map((algo) => {
                const item = metrics.algorithms?.[algo] || {};
                const isCurrent = activeAlgorithm === algo;
                const total = item.total || 0;
                const allowed = item.allowed || 0;
                const blocked = item.blocked || 0;
                const latency = item.averageLatencyMs || 0;

                return (
                  <div
                    key={algo}
                    className={`rounded-lg p-4 border space-y-3 ${
                      isCurrent
                        ? "bg-[#253650] border-[#445b80]"
                        : "bg-[#121a2a] border-[#2b3a52]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-slate-200">
                        {formatAlgorithm(algo)}
                      </span>
                      {isCurrent ? (
                        <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          Active
                        </span>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded bg-[#162134] p-2 border border-[#2b3a52]">
                        <span className="text-[10px] text-slate-400 block">Allowed</span>
                        <span className="font-mono font-semibold text-emerald-400">{allowed}</span>
                      </div>
                      <div className="rounded bg-[#162134] p-2 border border-[#2b3a52]">
                        <span className="text-[10px] text-slate-400 block">Blocked</span>
                        <span className="font-mono font-semibold text-rose-400">{blocked}</span>
                      </div>
                      <div className="rounded bg-[#162134] p-2 border border-[#2b3a52]">
                        <span className="text-[10px] text-slate-400 block">Avg Latency</span>
                        <span className="font-mono font-semibold text-slate-200">{latency} ms</span>
                      </div>
                      <div className="rounded bg-[#162134] p-2 border border-[#2b3a52]">
                        <span className="text-[10px] text-slate-400 block">Total Eval</span>
                        <span className="font-mono font-semibold text-slate-200">{total}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Section 7: Clients & Protected APIs */}
          <section className="grid gap-5 lg:grid-cols-2">
            {/* Most Blocked Clients Table */}
            <article id="clients" className="rounded-xl border border-[#2d3d58] bg-[#1c283f] p-5 space-y-3">
              <div className="border-b border-[#2b3a52] pb-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Client IP Tracking
                </p>
                <h3 className="text-sm font-bold text-white tracking-tight">
                  Top Rate-Limited Client IPs
                </h3>
              </div>

              {metrics.topBlockedIps.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400 font-mono">
                  No blocked clients recorded yet. (Run DDoS Attack simulator to trigger blocks)
                </p>
              ) : (
                <table className="w-full text-left text-xs font-mono">
                  <thead className="border-b border-[#2b3a52] text-[10px] uppercase text-slate-400 font-sans bg-[#162134]">
                    <tr>
                      <th className="py-2 px-2">Client IP</th>
                      <th className="py-2 text-right px-2">Blocked Requests</th>
                      <th className="py-2 text-right px-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#24334a]">
                    {metrics.topBlockedIps.map((item) => (
                      <tr key={item.ip} className="hover:bg-[#202e47]">
                        <td className="py-2 px-2 text-slate-200 font-medium">{item.ip}</td>
                        <td className="py-2 px-2 text-right text-rose-400 font-semibold">{item.blocked}</td>
                        <td className="py-2 px-2 text-right">
                          <span className="rounded bg-[#33151b] text-rose-300 border border-[#5e232e] px-1.5 py-0.5 text-[10px] font-sans">
                            Rate Limited
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </article>

            {/* Protected APIs Table */}
            <article id="apis" className="rounded-xl border border-[#2d3d58] bg-[#1c283f] p-5 space-y-3">
              <div className="border-b border-[#2b3a52] pb-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Gateway Routing
                </p>
                <h3 className="text-sm font-bold text-white tracking-tight">
                  Protected API Endpoints
                </h3>
              </div>

              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#2b3a52] text-[10px] uppercase text-slate-400 bg-[#162134]">
                  <tr>
                    <th className="py-2 px-2">Route</th>
                    <th className="py-2 text-right px-2">Total Hits</th>
                    <th className="py-2 text-right px-2">Blocked</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#24334a] font-mono">
                  {endpointStats.map((item) => (
                    <tr key={item.endpoint} className="hover:bg-[#202e47]">
                      <td className="py-2 px-2 text-slate-200">
                        <span>{item.endpoint}</span>
                      </td>
                      <td className="py-2 px-2 text-right text-slate-200 font-medium">
                        {item.requests}
                      </td>
                      <td className="py-2 px-2 text-right text-rose-400 font-medium">
                        {item.blocked}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          </section>

          {/* Section 8: System Health & Infrastructure */}
          <section id="health" className="rounded-xl border border-[#2d3d58] bg-[#1c283f] p-5 space-y-3">
            <div className="border-b border-[#2b3a52] pb-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Infrastructure
              </p>
              <h3 className="text-sm font-bold text-white tracking-tight">
                System Health & Connectivity Status
              </h3>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <HealthTile
                title="API Gateway Core"
                healthy={gatewayHealthy}
                detail="Express HTTP Server (Port 5050)"
                subdetail="Active & Listening"
              />
              <HealthTile
                title="Rate Limiter Storage"
                healthy={true}
                detail={bucket.store === "redis" ? "Redis (Upstash Cloud)" : "Process In-Memory Map"}
                subdetail={metrics.redis?.connected ? `Latency: ${metrics.redis.latencyMs}ms` : "Local store"}
              />
              <HealthTile
                title="Database Logs"
                healthy={true}
                detail="MongoDB Request Collection"
                subdetail="Auto 24h TTL Expiry"
              />
              <HealthTile
                title="Upstream Target"
                healthy={true}
                detail="StayHub API Gateway Target"
                subdetail="Mock & Live Fallback Enabled"
              />
            </div>
          </section>
        </main>
      </div>

      {/* Request Inspection Modal / Drawer */}
      {inspectedRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-[#374b6c] bg-[#1c283f] p-6 space-y-4 max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#2b3a52] pb-3">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-xs font-bold font-mono border ${
                  inspectedRequest.allowed ? "bg-[#112720] text-emerald-300 border-[#1f4e3f]" : "bg-[#33151b] text-rose-300 border-[#5e232e]"
                }`}>
                  {inspectedRequest.status || (inspectedRequest.allowed ? "200 OK" : "429 Too Many Requests")}
                </span>
                <span className="font-mono text-sm font-semibold text-white">{inspectedRequest.endpoint}</span>
              </div>
              <button
                onClick={() => setInspectedRequest(null)}
                className="text-xs font-bold cursor-pointer text-slate-400 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 rounded border border-[#2b3a52] bg-[#121a2a] font-mono">
                <div>
                  <span className="block text-[10px] text-slate-400">Client IP</span>
                  <span className="font-semibold text-white">{inspectedRequest.clientIp || inspectedRequest.ip}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-slate-400">Timestamp</span>
                  <span className="text-slate-200">{new Date(inspectedRequest.time).toLocaleString()}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-slate-400">Algorithm Used</span>
                  <span className="font-sans text-slate-200">{formatAlgorithm(inspectedRequest.algorithm || activeAlgorithm)}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-slate-400">Decision Latency</span>
                  <span className="text-emerald-400 font-semibold">{inspectedRequest.latencyMs || "< 1"} ms</span>
                </div>
              </div>

              {inspectedRequest.headers && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider mb-1 text-slate-400">
                    Rate Limit Response Headers
                  </p>
                  <div className="p-3 rounded border border-[#2b3a52] bg-[#121a2a] font-mono text-[11px] space-y-1 text-slate-300">
                    <div><span className="text-slate-500">X-RateLimit-Limit:</span> {inspectedRequest.headers.limit || rules.limit}</div>
                    <div><span className="text-slate-500">X-RateLimit-Remaining:</span> {inspectedRequest.headers.remaining ?? bucket.remaining ?? 0}</div>
                    <div><span className="text-slate-500">X-RateLimit-Reset:</span> {inspectedRequest.headers.reset || "Next window"}</div>
                  </div>
                </div>
              )}

              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider mb-1 text-slate-400">
                  Response Body Payload
                </p>
                <pre className="p-3 rounded border border-[#2b3a52] bg-[#121a2a] font-mono text-[11px] text-slate-300 overflow-x-auto">
                  {JSON.stringify(inspectedRequest.body || inspectedRequest, null, 2)}
                </pre>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setInspectedRequest(null)}
                className="rounded bg-[#273752] hover:bg-[#314464] px-4 py-2 text-xs font-medium text-slate-200 border border-[#384c6e] transition cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Subcomponents

function StatCard({ tag, label, value, subtext, tone = "text-white" }) {
  return (
    <div className="rounded-lg border border-[#2d3d58] bg-[#1c283f] p-4 space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[11px] font-medium text-slate-400">{label}</span>
        {tag && <span className="text-[9px] font-mono text-slate-400 uppercase">{tag}</span>}
      </div>
      <p className={`text-2xl font-bold tracking-tight font-mono ${tone}`}>
        {value}
      </p>
      {subtext && <p className="text-[10px] text-slate-400">{subtext}</p>}
    </div>
  );
}

function PresetButton({ active, onClick, title, subtitle, desc }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded p-2.5 text-left border transition cursor-pointer ${
        active
          ? "bg-[#253650] border-[#445b80] text-white"
          : "bg-[#121a2a] border-[#2b3a52] text-slate-400 hover:bg-[#1a2538] hover:text-slate-200"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-xs text-slate-100">{title}</span>
      </div>
      <span className="mt-0.5 block text-[10px] font-mono text-slate-300">{subtitle}</span>
      <p className="mt-1 text-[9px] text-slate-400 leading-tight">{desc}</p>
    </button>
  );
}

function HealthTile({ title, healthy, detail, subdetail }) {
  return (
    <div className="rounded bg-[#121a2a] p-3.5 border border-[#2b3a52] space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-200">{title}</span>
        <span className={`h-2 w-2 rounded-full ${healthy ? "bg-emerald-500" : "bg-rose-500"}`}></span>
      </div>
      <p className="text-[11px] font-mono text-slate-400">{detail}</p>
      <p className="text-[10px] text-emerald-400 font-medium">{subdetail}</p>
    </div>
  );
}

// Dual-Series Area Traffic Graph (5-minute rolling timeline)
function DualSeriesTrafficGraph({ points = [] }) {
  const safePoints = points.length > 0 ? points : Array.from({ length: 300 }, () => ({ count: 0, allowed: 0, blocked: 0 }));
  const max = Math.max(5, ...safePoints.map((p) => p.count || 0));

  const totalPointsCount = safePoints.length;

  const allowedPath = safePoints
    .map((p, i) => {
      const x = (i / Math.max(1, totalPointsCount - 1)) * 100;
      const y = 100 - ((p.allowed || 0) / max) * 85;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  const blockedPath = safePoints
    .map((p, i) => {
      const x = (i / Math.max(1, totalPointsCount - 1)) * 100;
      const y = 100 - ((p.blocked || 0) / max) * 85;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  const allowedArea = `${allowedPath} L 100 100 L 0 100 Z`;
  const blockedArea = `${blockedPath} L 100 100 L 0 100 Z`;

  return (
    <div className="relative h-36 w-full bg-[#121a2a] rounded p-2 border border-[#2b3a52] overflow-hidden">
      <svg
        className="h-full w-full overflow-visible"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-label="Requests per second dual graph 5 minutes"
      >
        <defs>
          <linearGradient id="emeraldGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="roseGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Horizontal Grid lines */}
        <line x1="0" y1="20" x2="100" y2="20" stroke="rgba(255,255,255,0.06)" strokeDasharray="2,2" />
        <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.06)" strokeDasharray="2,2" />
        <line x1="0" y1="80" x2="100" y2="80" stroke="rgba(255,255,255,0.06)" strokeDasharray="2,2" />

        {/* Vertical Grid lines for 5 minutes (every 1 min = 20%) */}
        <line x1="20" y1="0" x2="20" y2="100" stroke="rgba(255,255,255,0.04)" strokeDasharray="2,2" />
        <line x1="40" y1="0" x2="40" y2="100" stroke="rgba(255,255,255,0.04)" strokeDasharray="2,2" />
        <line x1="60" y1="0" x2="60" y2="100" stroke="rgba(255,255,255,0.04)" strokeDasharray="2,2" />
        <line x1="80" y1="0" x2="80" y2="100" stroke="rgba(255,255,255,0.04)" strokeDasharray="2,2" />

        {/* Filled Areas */}
        <path d={allowedArea} fill="url(#emeraldGradient)" />
        <path d={blockedArea} fill="url(#roseGradient)" />

        {/* Lines */}
        <path
          d={allowedPath}
          fill="none"
          stroke="#10b981"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={blockedPath}
          fill="none"
          stroke="#f43f5e"
          strokeWidth="1.5"
          strokeDasharray="3,2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
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
