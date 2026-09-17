export function loadConfig(env = process.env) {
  return {
    appVersion: '24.1.0',
    host: env.HOST || '0.0.0.0',
    port: Number(env.PORT || 8787),
    databaseUrl: env.DATABASE_URL || '',
    edgarUserAgent: env.EDGAR_USER_AGENT || 'FanliQuant/23.0 (research; contact@example.com)',
    requestTimeoutMs: Number(env.REQUEST_TIMEOUT_MS || 15000),
    retryMaxAttempts: Number(env.RETRY_MAX_ATTEMPTS || 3),
    retryBaseDelayMs: Number(env.RETRY_BASE_DELAY_MS || 500),
    defaultTtlMs: Number(env.CACHE_TTL_MS || 5 * 60 * 1000),
    defaultCik: env.DEFAULT_CIK || '0000320193',
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE || 240),
    logLevel: env.LOG_LEVEL || 'info',
    sourceMode: env.SOURCE_MODE || 'official_first'
  };
}



