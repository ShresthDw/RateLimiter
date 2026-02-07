const metrics = {
  total: 0,
  allowed: 0,
  blocked: 0,
  clients: new Set(),
  totalResponseTimeMs: 0
};

export const recordRateLimitDecision = ({ clientId, allowed, responseTimeMs }) => {
  metrics.total += 1;
  metrics.clients.add(clientId);
  metrics.totalResponseTimeMs += responseTimeMs;

  if (allowed) metrics.allowed += 1;
  else metrics.blocked += 1;
};

export const getMetrics = () => ({
  total: metrics.total,
  allowed: metrics.allowed,
  blocked: metrics.blocked,
  activeUsers: metrics.clients.size,
  averageResponseTimeMs: metrics.total
    ? Number((metrics.totalResponseTimeMs / metrics.total).toFixed(2))
    : 0
});
