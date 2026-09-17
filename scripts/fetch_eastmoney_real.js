import { loadConfig } from '../src/config.js';
import { createMemoryStore } from '../src/store/memory.js';
import { EastmoneyConnector } from '../src/ingest/eastmoney.js';

const config = loadConfig();
const store = createMemoryStore();
const connector = new EastmoneyConnector({ config, store });
try {
  const kline = await connector.run({ ticker: '600519', market: 'SH', startDate: '2024-01-01', endDate: '2026-09-16' });
  const valuation = await connector.runValuation({ ticker: '600519', market: 'SH' });
  const industry = await connector.runIndustry({ secid: '90.BK0477', startDate: '2024-01-01', endDate: '2026-09-16' });
  console.log(JSON.stringify({
    ok: true,
    kline: { source_url: kline.source_url, retrieved_at: kline.retrieved_at, confidence: kline.confidence, rows: kline.rows, first: kline.first_row, last: kline.last_row },
    valuation: { source_url: valuation.source_url, retrieved_at: valuation.retrieved_at, confidence: valuation.confidence, name: valuation.name, pe: valuation.pe, pb: valuation.pb, price: valuation.price },
    industry: { source_url: industry.source_url, retrieved_at: industry.retrieved_at, confidence: industry.confidence, name: industry.name, momentum_20d: industry.momentum_20d, momentum_60d: industry.momentum_60d, volatility_20d: industry.volatility_20d, cycle_score: industry.cycle_score }
  }, null, 2));
} catch (err) {
  console.error(`REAL_EASTMONEY_FAILED: ${err.message}`);
  process.exitCode = 1;
}
