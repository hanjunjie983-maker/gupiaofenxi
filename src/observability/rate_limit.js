// 进程内简单令牌桶限流；生产多实例应换成 Redis 全局限流。
const buckets = new Map();

export function checkRateLimit(key, { capacity = 240, refillPerSecond = capacity / 60 } = {}) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: capacity, last: now };
    buckets.set(key, b);
  }
  const elapsed = (now - b.last) / 1000;
  b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSecond);
  b.last = now;
  if (b.tokens < 1) {
    return { allowed: false, retryAfterSeconds: Math.ceil((1 - b.tokens) / refillPerSecond), remaining: 0 };
  }
  b.tokens -= 1;
  return { allowed: true, remaining: Math.floor(b.tokens) };
}

export function resetRateLimits() {
  buckets.clear();
}
