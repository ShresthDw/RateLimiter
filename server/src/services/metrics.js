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

  if (allowed) metrics.allowed += 1;
  else { metrics.blocked += 1; metrics.blockedClients.set(clientId, (metrics.blockedClients.get(clientId) || 0) + 1); }

  const second = Math.floor(Date.now() / 1000) * 1000;
  metrics.seconds.set(second, (metrics.seconds.get(second) || 0) + 1);
  [...metrics.seconds.keys()].filter((time) => time < second - 59000).forEach((time) => metrics.seconds.delete(time));
  metrics.recent.unshift({ time: new Date(), ip: clientId, endpoint, allowed, algorithm });
  metrics.recent.splice(20);

  const algorithmMetrics = metrics.algorithms.get(algorithm) || { total: 0, allowed: 0, blocked: 0, totalLatencyMs: 0, memoryBytes: 0 };
  algorithmMetrics.total += 1;
  algorithmMetrics.totalLatencyMs += responseTimeMs;
  algorithmMetrics.memoryBytes = memoryBytes;
  if (allowed) algorithmMetrics.allowed += 1;
  else algorithmMetrics.blocked += 1;
  metrics.algorithms.set(algorithm, algorithmMetrics);
};

export const getMetrics = () => ({
  total: metrics.total,
  allowed: metrics.allowed,
  blocked: metrics.blocked,
  activeUsers: metrics.clients.size,
  averageResponseTimeMs: metrics.total
    ? Number((metrics.totalResponseTimeMs / metrics.total).toFixed(2))
    : 0,
  blockedRate: metrics.total ? Number(((metrics.blocked / metrics.total) * 100).toFixed(1)) : 0,
  peakRps: Math.max(0, ...metrics.seconds.values()),
  requestSeries: Array.from({ length: 60 }, (_, index) => { const time = Math.floor(Date.now() / 1000) * 1000 - (59 - index) * 1000; return { time, count: metrics.seconds.get(time) || 0 }; }),
  topBlockedIps: [...metrics.blockedClients].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([ip, blocked]) => ({ ip, blocked })),
  recentRequests: metrics.recent,
  algorithms: Object.fromEntries([...metrics.algorithms].map(([name, item]) => [name, {
    total: item.total,
    allowed: item.allowed,
    blocked: item.blocked,
    averageLatencyMs: Number((item.totalLatencyMs / item.total).toFixed(2)),
    memoryBytes: item.memoryBytes
  }]))
});
