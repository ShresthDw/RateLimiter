import { Router } from 'express';
import { createTokenBucketMiddleware } from '../middleware/tokenBucketLimiter.js';
import { getMetrics } from '../services/metrics.js';
import { getActiveAlgorithm, getAlgorithms, getRateLimitRules, updateRateLimitRules } from '../config/rateLimitRules.js';
import { getActiveLimiter } from '../services/rateLimiters.js';
import { getRedisStatus } from '../config/redis.js';
import { requireStayHubTarget, stayHubProxy } from '../proxy/proxy.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/analytics', (_req, res) => res.json(getMetrics()));
router.get('/metrics', (_req, res) => res.json(getMetrics()));
router.get('/rules', (_req, res) => res.json({ ...getRateLimitRules(), activeAlgorithm: getActiveAlgorithm(), algorithms: getAlgorithms() }));
router.post('/rules', (req, res, next) => {
  try {
    res.json({ message: 'Rate-limit rules updated.', ...updateRateLimitRules(req.body) });
  } catch (error) {
    error.statusCode = 400;
    next(error);
  }
});

router.get('/status', async (req, res, next) => {
  try {
    const limiter = getActiveLimiter();
    const snapshot = await limiter.getBucketSnapshot(req.ip || req.socket.remoteAddress || 'unknown');
    res.json({ ...snapshot, algorithm: limiter.name });
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
  } catch (error) { next(error); }
});

router.use('/proxy', createTokenBucketMiddleware(getActiveLimiter), requireStayHubTarget, stayHubProxy);

export default router;
