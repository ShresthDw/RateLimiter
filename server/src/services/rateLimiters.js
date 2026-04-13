import { getRateLimitRules, getActiveAlgorithm } from '../config/rateLimitRules.js';
import { demoTokenBucket } from '../middleware/tokenBucketLimiter.js';

class InMemoryLimiter {
  constructor(name) {
    this.name = name;
    this.buckets = new Map();
  }

  result({ allowed, remaining, availableTokens = remaining, rules, now, retryMs = 0 }) {
    return {
      allowed,
      remaining: Math.max(0, Math.floor(remaining)),
      availableTokens: Number(Math.max(0, availableTokens).toFixed(2)),
      limit: rules.limit,
      resetTime: new Date(now + retryMs),
      store: 'memory'
    };
  }

  getMemoryUsage() {
    return this.buckets.size * 64;
  }
}

class FixedWindowLimiter extends InMemoryLimiter {
  constructor() { super('fixed-window'); }

  async allowRequest(clientId, now = Date.now()) {
    const rules = getRateLimitRules();
    let bucket = this.buckets.get(clientId);
    if (!bucket || now - bucket.startedAt >= rules.windowMs) bucket = { startedAt: now, count: 0 };
    const allowed = bucket.count < rules.limit;
    if (allowed) bucket.count += 1;
    this.buckets.set(clientId, bucket);
    return this.result({ allowed, remaining: rules.limit - bucket.count, rules, now, retryMs: rules.windowMs - (now - bucket.startedAt) });
  }

  async getBucketSnapshot(clientId, now = Date.now()) {
    const rules = getRateLimitRules();
    const bucket = this.buckets.get(clientId);
    if (!bucket || now - bucket.startedAt >= rules.windowMs) return this.result({ allowed: true, remaining: rules.limit, rules, now });
    return this.result({ allowed: true, remaining: rules.limit - bucket.count, rules, now, retryMs: rules.windowMs - (now - bucket.startedAt) });
  }
}

class SlidingWindowLimiter extends InMemoryLimiter {
  constructor() { super('sliding-window'); }

  activeTimestamps(clientId, now, windowMs) {
    const timestamps = (this.buckets.get(clientId) || []).filter((time) => now - time < windowMs);
    this.buckets.set(clientId, timestamps);
    return timestamps;
  }

  async allowRequest(clientId, now = Date.now()) {
    const rules = getRateLimitRules();
    const timestamps = this.activeTimestamps(clientId, now, rules.windowMs);
    const allowed = timestamps.length < rules.limit;
    if (allowed) timestamps.push(now);
    const retryMs = timestamps.length ? rules.windowMs - (now - timestamps[0]) : 0;
    return this.result({ allowed, remaining: rules.limit - timestamps.length, rules, now, retryMs });
  }

  async getBucketSnapshot(clientId, now = Date.now()) {
    const rules = getRateLimitRules();
    const timestamps = this.activeTimestamps(clientId, now, rules.windowMs);
    const retryMs = timestamps.length ? rules.windowMs - (now - timestamps[0]) : 0;
    return this.result({ allowed: true, remaining: rules.limit - timestamps.length, rules, now, retryMs });
  }

  getMemoryUsage() {
    return [...this.buckets.values()].reduce((total, timestamps) => total + timestamps.length * 8, 0);
  }
}

class LeakyBucketLimiter extends InMemoryLimiter {
  constructor() { super('leaky-bucket'); }

  getState(clientId, rules, now) {
    const bucket = this.buckets.get(clientId) || { level: 0, lastLeak: now };
    const leaked = ((now - bucket.lastLeak) * rules.limit) / rules.windowMs;
    return { level: Math.max(0, bucket.level - leaked), lastLeak: now };
  }

  async allowRequest(clientId, now = Date.now()) {
    const rules = getRateLimitRules();
    const bucket = this.getState(clientId, rules, now);
    const allowed = bucket.level < rules.limit;
    if (allowed) bucket.level += 1;
    this.buckets.set(clientId, bucket);
    const retryMs = bucket.level >= rules.limit ? rules.windowMs / rules.limit : 0;
    return this.result({ allowed, remaining: rules.limit - bucket.level, availableTokens: rules.limit - bucket.level, rules, now, retryMs });
  }

  async getBucketSnapshot(clientId, now = Date.now()) {
    const rules = getRateLimitRules();
    const bucket = this.getState(clientId, rules, now);
    this.buckets.set(clientId, bucket);
    return this.result({ allowed: true, remaining: rules.limit - bucket.level, availableTokens: rules.limit - bucket.level, rules, now });
  }
}

const limiters = {
  'token-bucket': demoTokenBucket,
  'fixed-window': new FixedWindowLimiter(),
  'sliding-window': new SlidingWindowLimiter(),
  'leaky-bucket': new LeakyBucketLimiter()
};

export const getActiveLimiter = () => limiters[getActiveAlgorithm()];
export const getAllLimiters = () => limiters;
