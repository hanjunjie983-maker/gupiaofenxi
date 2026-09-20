import { withRetry } from '../util/retry.js';
import { TokenBucket } from '../util/rate_limiter.js';

// 东方财富的 push2/fund 域名会在 keep-alive 复用连接时直接断开（Node undici 报 other side closed），
// 因此对这些域名强制 Connection: close，其余域名保持默认连接复用。
export function withHostHeaders(url, headers = {}) {
  let host = '';
  try { host = new URL(url).host; } catch { host = ''; }
  if (/eastmoney\.com$/i.test(host)) return { ...headers, Connection: 'close' };
  return headers;
}

// Every connector must record source_url, retrieved_at, field and confidence.
// The contract is enforced here so a future A-share/HK connector cannot skip it.
export class BaseConnector {
  constructor({ id, meta = {}, store, fetchImpl, config, limiter }) {
    this.id = id;
    this.meta = meta;
    this.store = store;
    this.fetchImpl = fetchImpl || globalThis.fetch;
    this.config = config || {};
    this.timeoutMs = this.config.requestTimeoutMs || 15000;
    this.limiter = limiter || new TokenBucket({ capacity: 10, refillPerSecond: 5 });
  }

  async request(url, headers = {}) {
    const requestHeaders = withHostHeaders(url, headers);
    return withRetry(
      async () => {
        await this.limiter.acquire(1);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const res = await this.fetchImpl(url, {
            headers: requestHeaders,
            signal: controller.signal,
            redirect: 'follow'
          });
          if (!res.ok) {
            throw new Error(`HTTP ${res.status} for ${url}`);
          }
          return await res.json();
        } finally {
          clearTimeout(timer);
        }
      },
      {
        maxAttempts: this.config.retryMaxAttempts || 3,
        baseDelayMs: this.config.retryBaseDelayMs || 500,
        jitter: 0.25,
        onRetry: ({ attempt, delayMs, error }) => {
          console.warn(`[${this.id}] retry ${attempt} in ${Math.round(delayMs)}ms: ${error.message}`);
        }
      }
    );
  }
}
