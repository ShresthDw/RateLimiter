import { Router } from 'express';
import demoRoutes from './demoRoutes.js';
import { createTokenBucketMiddleware } from '../middleware/tokenBucketLimiter.js';
import { getMetrics } from '../services/metrics.js';
import { getActiveAlgorithm, getAlgorithms, getRateLimitRules } from '../config/rateLimitRules.js';
import { getActiveLimiter } from '../services/rateLimiters.js';
import { getRedisStatus } from '../config/redis.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
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

// The Phase 1 endpoint: each allowed request spends one token from a
// 20-token bucket that refills continuously at 20 tokens per minute.
router.get('/data', createTokenBucketMiddleware(getActiveLimiter), (req, res) => {
  res.json({
    message: 'Protected data returned successfully.',
    data: {
      example: 'This response consumed one token from your bucket.'
    },
    limit: req.rateLimit.limit,
    remaining: req.rateLimit.remaining,
    availableTokens: req.rateLimit.availableTokens,
    algorithm: req.rateLimit.algorithm,
    resetTime: req.rateLimit.resetTime
  });
});

router.use('/demo', demoRoutes);

export default router;
