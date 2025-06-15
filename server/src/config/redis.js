import Redis from 'ioredis';

let redis;

export const initRedis = async () => {
  const redisUri = process.env.REDIS_URI;

  if (!redisUri) {
    console.warn('REDIS_URI is not set. Token bucket limiter will run in-memory mode.');
    return null;
  }

  try {
    redis = new Redis(redisUri);
    redis.on('connect', () => console.log('Redis connected'));
    redis.on('error', (err) => console.error('Redis error:', err.message));
    return redis;
  } catch (error) {
    console.error('Redis connection failed:', error.message);
    return null;
  }
};

export const getRedis = () => redis;
