import { loadConfig } from '../src/config.js';
import { createMemoryStore } from '../src/store/memory.js';
import { EastmoneyConnector } from '../src/ingest/eastmoney.js';
import { runRealBacktest, buildFutureLabels } from '../src/backtest/real_backtest.js';

const config = loadConfig();
const store = createMemoryStore();
const connector = new EastmoneyConnector({ config, store });
try {
  const ingest = await connector.run({ ticker: '600519', market: 'SH', startDate: '2024-01-01', endDate: '2026-09-16' });
  const rows = store.listPriceRows('600519');
  const bt = runRealBacktest(rows, { lookback: 20, cost: 0.001 });
  const labels = buildFutureLabels(rows, { horizon: 20 });
  console.log(JSON.stringify({
    ok: true,
    source_url: ingest.source_url,
    retrieved_at: ingest.retrieved_at,
    confidence: ingest.confidence,
    rows: rows.length,
    backtest: bt.metrics,
    labels: { count: labels.length, positive_rate: labels.reduce((s, x) => s + x.labels.positive_return, 0) / labels.length, drawdown_rate: labels.reduce((s, x) => s + x.labels.max_drawdown_gt_10, 0) / labels.length }
  }, null, 2));
} catch (err) {
  console.error(`REAL_ASHARE_BACKTEST_FAILED: ${err.message}`);
  process.exitCode = 1;
}
