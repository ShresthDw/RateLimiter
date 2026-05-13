const metrics = {
  total: 0,
  allowed: 0,
  blocked: 0,
  clients: new Set(),
  totalResponseTimeMs: 0,
  algorithms: new Map(),
  blockedClients: new Map(),
  recent: [],
  seconds: new Map()
};

export const recordRateLimitDecision = ({ clientId, algorithm, allowed, responseTimeMs, memoryBytes, endpoint }) => {
  metrics.total += 1;
  metrics.clients.add(clientId);
  metrics.totalResponseTimeMs += responseTimeMs;

  if (allowed) {
    metrics.allowed += 1;
  } else {
    metrics.blocked += 1;
    metrics.blockedClients.set(clientId, (metrics.blockedClients.get(clientId) || 0) + 1);
  }

  const second = Math.floor(Date.now() / 1000) * 1000;
  const currentSecond = metrics.seconds.get(second) || { total: 0, allowed: 0, blocked: 0 };
  currentSecond.total += 1;
  if (allowed) {
    currentSecond.allowed += 1;
  } else {
    currentSecond.blocked += 1;
  }
  metrics.seconds.set(second, currentSecond);

  // Keep 5 minutes (300 seconds) of second-by-second traffic history
  const cutoff = second - (300 * 1000 - 1000);
  for (const time of metrics.seconds.keys()) {
    if (time < cutoff) {
      metrics.seconds.delete(time);
    }
  }

  metrics.recent.unshift({
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    time: new Date(),
    ip: clientId,
    endpoint: endpoint || '/api/proxy',
    allowed,
    algorithm,
    responseTimeMs: Number(responseTimeMs.toFixed(2))
  });
  if (metrics.recent.length > 50) {
    metrics.recent.splice(50);
  }

  const algorithmMetrics = metrics.algorithms.get(algorithm) || {
    total: 0,
    allowed: 0,
    blocked: 0,
    totalLatencyMs: 0,
    memoryBytes: 0
  };
  algorithmMetrics.total += 1;
  algorithmMetrics.totalLatencyMs += responseTimeMs;
  algorithmMetrics.memoryBytes = memoryBytes;
  if (allowed) {
    algorithmMetrics.allowed += 1;
  } else {
    algorithmMetrics.blocked += 1;
  }
  metrics.algorithms.set(algorithm, algorithmMetrics);
};

export const resetMetrics = () => {
  metrics.total = 0;
  metrics.allowed = 0;
  metrics.blocked = 0;
  metrics.clients.clear();
  metrics.totalResponseTimeMs = 0;
  metrics.algorithms.clear();
  metrics.blockedClients.clear();
  metrics.recent = [];
  metrics.seconds.clear();
  return getMetrics();
};

export const getMetrics = () => {
  const nowSecond = Math.floor(Date.now() / 1000) * 1000;
  const secondValues = [...metrics.seconds.values()];
  const peakRps = secondValues.length ? Math.max(0, ...secondValues.map((s) => (typeof s === 'number' ? s : s.total))) : 0;

  // 5-minute timeline (300 seconds)
  const requestSeries = Array.from({ length: 300 }, (_, index) => {
    const time = nowSecond - (299 - index) * 1000;
    const sec = metrics.seconds.get(time);
    if (typeof sec === 'number') {
      return { time, count: sec, allowed: sec, blocked: 0 };
    }
    return {
      time,
      count: sec?.total || 0,
      allowed: sec?.allowed || 0,
      blocked: sec?.blocked || 0
    };
  });

  return {
    total: metrics.total,
    allowed: metrics.allowed,
    blocked: metrics.blocked,
    activeUsers: metrics.clients.size,
    averageResponseTimeMs: metrics.total
      ? Number((metrics.totalResponseTimeMs / metrics.total).toFixed(2))
      : 0,
    blockedRate: metrics.total ? Number(((metrics.blocked / metrics.total) * 100).toFixed(1)) : 0,
    peakRps,
    timelineDurationSeconds: 300,
    requestSeries,
    topBlockedIps: [...metrics.blockedClients]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ip, blocked]) => ({ ip, blocked })),
    recentRequests: metrics.recent,
    algorithms: Object.fromEntries(
      [...metrics.algorithms].map(([name, item]) => [
        name,
        {
          total: item.total,
          allowed: item.allowed,
          blocked: item.blocked,
          averageLatencyMs: item.total ? Number((item.totalLatencyMs / item.total).toFixed(2)) : 0,
          memoryBytes: item.memoryBytes
        }
      ])
    )
  };
};
