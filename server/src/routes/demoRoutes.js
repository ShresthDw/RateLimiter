import { Router } from 'express';
import { createTokenBucketMiddleware } from '../middleware/tokenBucketLimiter.js';
import { getActiveLimiter } from '../services/rateLimiters.js';

const router = Router();

const getClientId = (req) => req.ip || req.connection.remoteAddress;

router.get('/status', async (req, res, next) => {
  const clientId = getClientId(req);
  try {
    const limiter = getActiveLimiter();
    const snapshot = await limiter.getBucketSnapshot(clientId);
    res.json({
      message: 'Live token bucket status',
      limit: snapshot.limit,
      remaining: snapshot.remaining,
      availableTokens: snapshot.availableTokens,
      resetTime: snapshot.resetTime,
      store: snapshot.store,
      algorithm: limiter.name
    });
  } catch (error) {
    next(error);
  }
});

router.get('/ping', createTokenBucketMiddleware(getActiveLimiter), async (req, res) => {
  res.json({
    message: 'Pong from the token bucket rate-limited endpoint.',
    limit: req.rateLimit?.limit ?? null,
    remaining: req.rateLimit?.remaining ?? null,
    availableTokens: req.rateLimit?.availableTokens ?? null,
    resetTime: req.rateLimit?.resetTime ?? null
  });
});

export default router;
