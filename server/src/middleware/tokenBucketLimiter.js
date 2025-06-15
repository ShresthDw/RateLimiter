class TokenBucket {
  constructor(capacity, refillRate, refillInterval = 60000) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.refillInterval = refillInterval;
    this.buckets = new Map();
  }

  getBucketSnapshot(clientId, now = Date.now()) {
    let bucket = this.buckets.get(clientId);

    if (!bucket) {
      bucket = {
        tokens: this.capacity,
        lastRefill: now
      };
      this.buckets.set(clientId, bucket);
    }

    const currentTokens = this.getCurrentTokens(bucket, now);
    const remaining = Math.floor(currentTokens);
    const timeUntilNextToken = Math.max(0, this.msUntilNextToken(currentTokens));

    return {
      remaining,
      limit: this.capacity,
      resetTime: new Date(now + timeUntilNextToken)
    };
  }

  getCurrentTokens(bucket, now) {
    const elapsedMs = now - bucket.lastRefill;
    const tokensPerMs = this.refillRate / this.refillInterval;
    const replenishedTokens = elapsedMs * tokensPerMs;

    return Math.min(this.capacity, bucket.tokens + replenishedTokens);
  }

  msUntilNextToken(currentTokens) {
    const tokensPerMs = this.refillRate / this.refillInterval;

    if (currentTokens >= 1) {
      return (1 - (currentTokens % 1)) / tokensPerMs;
    }

    return (1 - currentTokens) / tokensPerMs;
  }

  allowRequest(clientId) {
    const now = Date.now();
    let bucket = this.buckets.get(clientId);

    if (!bucket) {
      bucket = {
        tokens: this.capacity,
        lastRefill: now
      };
      this.buckets.set(clientId, bucket);
    }

    const currentTokens = this.getCurrentTokens(bucket, now);
    bucket.tokens = currentTokens;
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      const remaining = Math.floor(bucket.tokens);
      const timeUntilNextToken = Math.max(0, this.msUntilNextToken(bucket.tokens));
      const resetTime = new Date(now + timeUntilNextToken);

      return {
        allowed: true,
        remaining,
        limit: this.capacity,
        resetTime
      };
    } else {
      const timeUntilNextToken = Math.max(0, this.msUntilNextToken(bucket.tokens));
      const resetTime = new Date(now + timeUntilNextToken);

      return {
        allowed: false,
        remaining: 0,
        limit: this.capacity,
        resetTime
      };
    }
  }
}

export const apiTokenBucket = new TokenBucket(100, 100, 15 * 60 * 1000);
export const demoTokenBucket = new TokenBucket(20, 20, 60 * 1000);

export const createTokenBucketMiddleware = (bucket) => {
  return (req, res, next) => {
    const clientId = req.ip || req.connection.remoteAddress;
    const result = bucket.allowRequest(clientId);

    req.rateLimit = {
      limit: result.limit,
      current: result.remaining,
      remaining: result.remaining,
      resetTime: result.resetTime
    };

    res.setHeader('X-RateLimit-Limit', result.limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetTime.toISOString());

    if (!result.allowed) {
      return res.status(429).json({
        message: 'Too many requests. Token bucket limit exceeded. Please try again later.',
        retryAfter: Math.ceil((result.resetTime.getTime() - Date.now()) / 1000)
      });
    }

    next();
  };
};
