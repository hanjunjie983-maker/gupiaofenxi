import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createMemoryStore } from '../src/store/memory.js';
import { runRealBacktest, buildFutureLabels } from '../src/backtest/real_backtest.js';
import { walkForwardRealProbability } from '../src/probability/real_training.js';
import { mulberry32 } from '../src/probability/math.js';

// V24 最终验收（进程内）：不依赖外部网络/子进程，验证核心链路。
const store = createMemoryStore();
const rnd = mulberry32(24);
let close = 100;
for (let i = 0; i < 200; i++) {
  close = Math.max(1, close * (1 + (rnd() - 0.47) * 0.03));
  const tradeDate = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
  store.savePriceRows([{ ticker: '600519', exchange: 'SH', trade_date: tradeDate, open: close, high: close * 1.01, low: close * 0.99, close, preclose: close, adj_close: close, volume: 1000, amount: 1e8, turnover: 0.01, pct_chg: 0, tradestatus: '1', is_st: '0', adjustflag: '2' }]);
}

const server = createServer({ config: loadConfig({ LOG_LEVEL: 'silent' }), store });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const checks = [];
const check = async (name, fn) => {
  try { const detail = await fn(); checks.push({ name, ok: true, detail }); }
  catch (err) { checks.push({ name, ok: false, error: err.message }); }
};

try {
  await check('health_live', async () => (await fetch(`${base}/health/live`)).status);
  await check('home_page', async () => (await fetch(`${base}/`)).status);
  await check('stock_page', async () => (await fetch(`${base}/stock.html`)).status);
  await check('sources_page', async () => (await fetch(`${base}/sources.html`)).status);
  await check('routing', async () => (await (await fetch(`${base}/v1/sources/routing`)).json()).data.mode);
  await check('monitor', async () => (await (await fetch(`${base}/v1/monitor/overview`)).json()).data.status);
  await check('real_backtest', async () => runRealBacktest(store.listPriceRows('600519'), { lookback: 20 }).metrics.sharpe);
  await check('future_labels', async () => buildFutureLabels(store.listPriceRows('600519'), { horizon: 20 }).length);
  await check('real_probability', async () => walkForwardRealProbability(store.listPriceRows('600519'), { lookback: 20, horizon: 20, trainWindow: 80, testWindow: 20, nBoot: 20 }).aggregate.brier);
  await check('portfolio', async () => (await (await fetch(`${base}/v1/portfolio/optimize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tickers: 8, periods: 60, seed: 24 }) })).json()).data.weights.length);
  await check('agent_tools', async () => (await (await fetch(`${base}/v1/agent/tools`)).json()).data.length);
  const report = { ok: checks.every((c) => c.ok), checks, note: 'unit/API suite run separately: node test/server.test.js' };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  server.close();
}
