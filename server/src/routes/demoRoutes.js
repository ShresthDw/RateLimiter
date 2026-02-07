import { Router } from 'express';
import { demoTokenBucket, createTokenBucketMiddleware } from '../middleware/tokenBucketLimiter.js';
import { RequestLog } from '../models/RequestLog.js';

const router = Router();

const getClientId = (req) => req.ip || req.connection.remoteAddress;

router.get('/status', async (req, res, next) => {
  const clientId = getClientId(req);
  try {
    const snapshot = await demoTokenBucket.getBucketSnapshot(clientId);
    res.json({
      message: 'Live token bucket status',
      limit: snapshot.limit,
      remaining: snapshot.remaining,
      availableTokens: snapshot.availableTokens,
      resetTime: snapshot.resetTime,
      store: snapshot.store
    });
  } catch (error) {
    next(error);
  }
});

router.get('/ping', createTokenBucketMiddleware(demoTokenBucket), async (req, res) => {
  if (process.env.MONGODB_URI) {
    try {
      await RequestLog.create({
        ip: req.ip,
        route: '/api/demo/ping'
      });
    } catch (error) {
      console.warn('Request log skipped:', error.message);
    }
  }

  res.json({
    message: 'Pong from the token bucket rate-limited endpoint.',
    limit: req.rateLimit?.limit ?? null,
    remaining: req.rateLimit?.remaining ?? null,
    availableTokens: req.rateLimit?.availableTokens ?? null,
    resetTime: req.rateLimit?.resetTime ?? null
  });
});

export default router;
