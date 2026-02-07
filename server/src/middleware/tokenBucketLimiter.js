import { getRateLimitRules } from '../config/rateLimitRules.js';
import { getRedis } from '../config/redis.js';
import { recordRateLimitDecision } from '../services/metrics.js';

const redisConsumeScript = `
  local now = tonumber(ARGV[1])
  local capacity = tonumber(ARGV[2])
  local refillInterval = tonumber(ARGV[3])
  local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens')) or capacity
  local lastRefill = tonumber(redis.call('HGET', KEYS[1], 'lastRefill')) or now
  local elapsed = math.max(0, now - lastRefill)
  local current = math.min(capacity, tokens + (elapsed * capacity / refillInterval))
  local allowed = 0

  if current >= 1 then
    current = current - 1
    allowed = 1
  end

  redis.call('HSET', KEYS[1], 'tokens', current, 'lastRefill', now)
  redis.call('PEXPIRE', KEYS[1], math.max(refillInterval * 2, 60000))
  return { allowed, current }
`;

class TokenBucket {
  constructor(keyPrefix) {
    this.keyPrefix = keyPrefix;
    this.buckets = new Map();
  }

  getCurrentTokens(bucket, rules, now) {
    const elapsedMs = Math.max(0, now - bucket.lastRefill);
    return Math.min(rules.limit, bucket.tokens + (elapsedMs * rules.limit) / rules.windowMs);
  }

  getResult(tokens, rules, now) {
    const remaining = Math.max(0, Math.floor(tokens));
    const fractionalTokens = tokens % 1;
    const tokensUntilNext = tokens >= 1 ? 1 - fractionalTokens : 1 - tokens;
    const retryMs = Math.max(0, (tokensUntilNext * rules.windowMs) / rules.limit);

    return {
      remaining,
      availableTokens: Number(tokens.toFixed(2)),
      limit: rules.limit,
      resetTime: new Date(now + retryMs)
    };
  }

  async getBucketSnapshot(clientId, now = Date.now()) {
    const rules = getRateLimitRules();
    const redis = getRedis();

    if (redis?.status === 'ready') {
      try {
        const values = await redis.hmget(`${this.keyPrefix}:${clientId}`, 'tokens', 'lastRefill');
        if (values[0] !== null && values[1] !== null) {
          const currentTokens = this.getCurrentTokens(
            { tokens: Number(values[0]), lastRefill: Number(values[1]) },
            rules,
            now
          );
          return { ...this.getResult(currentTokens, rules, now), store: 'redis' };
        }
        return { ...this.getResult(rules.limit, rules, now), store: 'redis' };
      } catch (error) {
        console.warn('Redis bucket snapshot failed; using memory fallback:', error.message);
      }
    }

    const bucket = this.buckets.get(clientId) || { tokens: rules.limit, lastRefill: now };
    const currentTokens = this.getCurrentTokens(bucket, rules, now);

    this.buckets.set(clientId, { tokens: currentTokens, lastRefill: now });
    return { ...this.getResult(currentTokens, rules, now), store: 'memory' };
  }

  allowInMemory(clientId, rules, now) {
    const bucket = this.buckets.get(clientId) || { tokens: rules.limit, lastRefill: now };
    const currentTokens = this.getCurrentTokens(bucket, rules, now);
    const allowed = currentTokens >= 1;
    const tokens = allowed ? currentTokens - 1 : currentTokens;

    this.buckets.set(clientId, { tokens, lastRefill: now });
    return { allowed, ...this.getResult(tokens, rules, now), store: 'memory' };
  }

  async allowRequest(clientId) {
    const now = Date.now();
    const rules = getRateLimitRules();
    const redis = getRedis();

    if (redis?.status === 'ready') {
      try {
        const [allowedValue, tokensValue] = await redis.eval(
          redisConsumeScript,
          1,
          `${this.keyPrefix}:${clientId}`,
          now,
          rules.limit,
          rules.windowMs
        );
        const tokens = Number(tokensValue);
        return { allowed: Number(allowedValue) === 1, ...this.getResult(tokens, rules, now), store: 'redis' };
      } catch (error) {
        console.warn('Redis rate-limit operation failed; using memory fallback:', error.message);
      }
    }

    return this.allowInMemory(clientId, rules, now);
  }
}

export const demoTokenBucket = new TokenBucket('rate-limit:demo');

export const createTokenBucketMiddleware = (bucket) => async (req, res, next) => {
  const startedAt = performance.now();
  const clientId = req.ip || req.socket.remoteAddress || 'unknown';

  try {
    const result = await bucket.allowRequest(clientId);
    const responseTimeMs = performance.now() - startedAt;
    recordRateLimitDecision({ clientId, allowed: result.allowed, responseTimeMs });

    req.rateLimit = {
      limit: result.limit,
      current: result.remaining,
      remaining: result.remaining,
      availableTokens: result.availableTokens,
      resetTime: result.resetTime,
      store: result.store
    };

    res.setHeader('X-RateLimit-Limit', result.limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetTime.toISOString());

    if (!result.allowed) {
      return res.status(429).json({
        message: 'Too many requests. Token bucket limit exceeded. Please try again later.',
        retryAfter: Math.max(1, Math.ceil((result.resetTime.getTime() - Date.now()) / 1000))
      });
    }

    return next();
  } catch (error) {
    return next(error);
  }
};
