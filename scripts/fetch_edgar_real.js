import { loadConfig } from '../src/config.js';
import { createMemoryStore } from '../src/store/memory.js';
import { SecEdgarConnector } from '../src/ingest/edgar.js';

// 真实 SEC EDGAR 抓取回归。需要联网；失败时输出 REAL_FETCH_FAILED 并返回非零码。
const config = loadConfig();
const store = createMemoryStore();
const connector = new SecEdgarConnector({ config, store });

try {
  const record = await connector.run(config.defaultCik);
  console.log(JSON.stringify({
    ok: true,
    source_url: record.source_url,
    retrieved_at: record.retrieved_at,
    field: record.field,
    confidence: record.confidence,
    cik: record.cik,
    name: record.name,
    tickers: record.tickers,
    latest_forms: record.latest_forms.slice(0, 5),
    raw_sha256: record.raw_sha256
  }, null, 2));
} catch (err) {
  console.error(`REAL_FETCH_FAILED: ${err.message}`);
  process.exitCode = 1;
}
