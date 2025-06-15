import { Router } from 'express';
import { demoTokenBucket, createTokenBucketMiddleware } from '../middleware/tokenBucketLimiter.js';
import { RequestLog } from '../models/RequestLog.js';

const router = Router();

router.get('/status', (req, res) => {
  const clientId = req.ip || req.connection.remoteAddress;
  const snapshot = demoTokenBucket.getBucketSnapshot(clientId);

  res.json({
    message: 'Live token bucket status',
    limit: snapshot.limit,
    remaining: snapshot.remaining,
    resetTime: snapshot.resetTime
  });
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
    resetTime: req.rateLimit?.resetTime ?? null
  });
});

export default router;