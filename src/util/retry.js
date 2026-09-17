export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exponential backoff with full jitter. Used by all upstream connectors so a
// single failing source cannot hammer an exchange/regulator endpoint.
export async function withRetry(fn, opts = {}) {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 8000,
    jitter = 0.25,
    onRetry = () => {}
  } = opts;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break;
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delayMs = Math.max(10, exponential * (1 + jitter * (Math.random() * 2 - 1)));
      onRetry({ attempt, delayMs, error: err });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
