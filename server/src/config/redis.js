import Redis from 'ioredis';

let redis;

export const initRedis = async () => {
  const redisUri = process.env.REDIS_URL || process.env.REDIS_URI;

  if (!redisUri) {
    console.warn('REDIS_URL is not set. Token bucket limiter will run in-memory mode.');
    return null;
  }

  try {
    redis = new Redis(redisUri, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false
    });
    redis.on('connect', () => console.log('Redis connected'));
    redis.on('error', (err) => console.error('Redis error:', err.message));
    return redis;
  } catch (error) {
    console.error('Redis connection failed:', error.message);
    return null;
  }
};

export const getRedis = () => redis;

export const getRedisStatus = async () => {
  if (!redis || redis.status !== 'ready') return { connected: false };
  const startedAt = performance.now();
  try {
    await redis.ping();
    const keys = await redis.dbsize();
    return { connected: true, latencyMs: Number((performance.now() - startedAt).toFixed(2)), keys };
  } catch { return { connected: false }; }
};
