import { Router } from 'express';
import { createTokenBucketMiddleware } from '../middleware/tokenBucketLimiter.js';
import { getMetrics, resetMetrics, recordRateLimitDecision } from '../services/metrics.js';
import { getActiveAlgorithm, getAlgorithms, getRateLimitRules, updateRateLimitRules } from '../config/rateLimitRules.js';
import { getActiveLimiter } from '../services/rateLimiters.js';
import { getRedisStatus } from '../config/redis.js';
import { requireStayHubTarget, stayHubProxy } from '../proxy/proxy.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const getAdminKey = () => process.env.ADMIN_KEY || 'admin123';
const checkAdmin = (req) => {
  const authHeader = req.headers['x-admin-key'] || req.headers['authorization']?.replace(/^Bearer /, '');
  return authHeader === getAdminKey();
};

router.get('/analytics', (_req, res) => res.json(getMetrics()));
router.get('/metrics', (_req, res) => res.json(getMetrics()));
router.post('/reset-metrics', (req, res) => {
  if (!checkAdmin(req)) {
    return res.status(403).json({ message: 'Admin access required to reset metrics.' });
  }
  const fresh = resetMetrics();
  res.json({ message: 'Metrics successfully reset.', metrics: fresh });
});

router.get('/rules', (_req, res) =>
  res.json({ ...getRateLimitRules(), activeAlgorithm: getActiveAlgorithm(), algorithms: getAlgorithms() })
);

router.post('/rules', (req, res, next) => {
  if (!checkAdmin(req)) {
    return res.status(403).json({ message: 'Admin access required to update rate-limit rules.' });
  }
  try {
    res.json({ message: 'Rate-limit rules updated.', ...updateRateLimitRules(req.body) });
  } catch (error) {
    error.statusCode = 400;
    next(error);
  }
});

router.get('/status', async (req, res, next) => {
  try {
    const clientId =
      req.headers['x-simulated-ip'] ||
      req.headers['x-client-ip'] ||
      req.ip ||
      req.socket?.remoteAddress ||
      'unknown';
    const limiter = getActiveLimiter();
    const snapshot = await limiter.getBucketSnapshot(clientId);
    res.json({ ...snapshot, algorithm: limiter.name, clientId });
  } catch (error) {
    next(error);
  }
});

router.get('/dashboard', async (_req, res, next) => {
  try {
    res.json({
      metrics: getMetrics(),
      rules: getRateLimitRules(),
      activeAlgorithm: getActiveAlgorithm(),
      algorithms: getAlgorithms(),
      redis: await getRedisStatus()
    });
  } catch (error) {
    next(error);
  }
});

// Server-side batch simulation endpoint for rapid multi-user testing
router.post('/simulate', async (req, res, next) => {
  try {
    const userCount = Math.min(100, Math.max(1, Number(req.body.userCount) || (req.body.clients ? req.body.clients.length : 1)));
    const requestsPerUser = Math.min(50, Math.max(1, Number(req.body.requestsPerUser) || Number(req.body.count) || 1));
    const endpoint = req.body.endpoint || '/api/proxy/api/rooms';
    const limiter = getActiveLimiter();
    const results = [];

    const clientPool = req.body.clients && Array.isArray(req.body.clients) && req.body.clients.length > 0
      ? req.body.clients
      : Array.from({ length: userCount }, (_, i) => `192.168.${Math.floor(i / 25) + 1}.${(i % 25) + 1}`);

    for (let c = 0; c < clientPool.length; c++) {
      const clientId = clientPool[c];
      for (let r = 0; r < requestsPerUser; r++) {
        const start = performance.now();
        const decision = await limiter.allowRequest(clientId);
        const latency = performance.now() - start;
        recordRateLimitDecision({
          clientId,
          algorithm: limiter.name,
          allowed: decision.allowed,
          responseTimeMs: latency,
          memoryBytes: limiter.getMemoryUsage?.() ?? 0,
          endpoint
        });
        results.push({
          clientId,
          userIndex: c + 1,
          requestIndex: r + 1,
          allowed: decision.allowed,
          remaining: decision.remaining,
          latencyMs: Number(latency.toFixed(2))
        });
      }
    }

    res.json({
      message: `Simulated ${clientPool.length} users sending ${requestsPerUser} request(s) each (${results.length} total).`,
      usersSimulated: clientPool.length,
      totalRequests: results.length,
      endpoint,
      algorithm: limiter.name,
      allowed: results.filter((r) => r.allowed).length,
      blocked: results.filter((r) => !r.allowed).length,
      sampleResults: results.slice(0, 15),
      metrics: getMetrics()
    });
  } catch (error) {
    next(error);
  }
});

router.use('/proxy', createTokenBucketMiddleware(getActiveLimiter), requireStayHubTarget, stayHubProxy);

export default router;
