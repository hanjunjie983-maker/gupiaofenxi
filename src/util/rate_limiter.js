import { sleep } from './retry.js';

// Simple token bucket. Global budget per source prevents accidental rate-limit
// violations; production would centralize this in Redis for multi-worker safety.
export class TokenBucket {
  constructor({ capacity = 10, refillPerSecond = 5, now = Date.now } = {}) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.tokens = capacity;
    this.lastRefill = now();
    this._now = now;
  }

  _refill() {
    const now = this._now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSecond);
    this.lastRefill = now;
  }

  async acquire(n = 1) {
    while (true) {
      this._refill();
      if (this.tokens >= n) {
        this.tokens -= n;
        return;
      }
      if (this.refillPerSecond <= 0) {
        throw new Error('TokenBucket: capacity exhausted and refill rate is 0');
      }
      const waitMs = Math.max(10, ((n - this.tokens) / this.refillPerSecond) * 1000);
      await sleep(waitMs);
    }
  }
}
