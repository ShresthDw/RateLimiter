import { Router } from 'express';
import demoRoutes from './demoRoutes.js';
import { createTokenBucketMiddleware, demoTokenBucket } from '../middleware/tokenBucketLimiter.js';
import { getMetrics } from '../services/metrics.js';
import { getRateLimitRules } from '../config/rateLimitRules.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/dashboard', (_req, res) => {
  res.json({
    metrics: getMetrics(),
    rules: getRateLimitRules()
  });
});

// The Phase 1 endpoint: each allowed request spends one token from a
// 20-token bucket that refills continuously at 20 tokens per minute.
router.get('/data', createTokenBucketMiddleware(demoTokenBucket), (req, res) => {
  res.json({
    message: 'Protected data returned successfully.',
    data: {
      example: 'This response consumed one token from your bucket.'
    },
    limit: req.rateLimit.limit,
    remaining: req.rateLimit.remaining,
    availableTokens: req.rateLimit.availableTokens,
    resetTime: req.rateLimit.resetTime
  });
});

router.use('/demo', demoRoutes);

export default router;
