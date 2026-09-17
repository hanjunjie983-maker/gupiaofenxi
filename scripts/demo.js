import { loadConfig } from '../src/config.js';
import { createMemoryStore } from '../src/store/memory.js';
import { SecEdgarConnector } from '../src/ingest/edgar.js';
import { BaostockConnector } from '../src/ingest/baostock.js';
import { normalizeImportedDays } from '../src/calendar/calendar.js';
import { computeFactors } from '../src/factors/engine.js';
import { computeFanli } from '../src/factors/fanli.js';
import { computeProbability } from '../src/probability/engine.js';
import { mulberry32 } from '../src/probability/math.js';
import { runBacktestJob, evaluateCalibration } from '../src/backtest/engine.js';
import { optimizePortfolio } from '../src/portfolio/engine.js';

const sampleRaw = {
  cik: '320193', name: 'Apple Inc.', tickers: ['AAPL'],
  filings: { recent: { form: ['10-K'], filingDate: ['2025-10-31'], reportDate: ['2025-09-27'], accessionNumber: ['0000320193-25-000001'] } }
};
const mockFetch = async () => new Response(JSON.stringify(sampleRaw), { status: 200, headers: { 'content-type': 'application/json' } });

const config = loadConfig();
const store = createMemoryStore();
store.saveCalendarDays(normalizeImportedDays(
  ['2026-09-14', '2026-09-15', '2026-09-16'].map((d) => ({ calendar_date: d, is_open: true })),
  { source: 'demo_official', confidence: 0.95, is_verified: true }
));

const edgar = new SecEdgarConnector({ config, store, fetchImpl: mockFetch });
await edgar.run(config.defaultCik);
const baostock = new BaostockConnector({ config, store });
await baostock.run({ ticker: 'sh.600519', mode: 'fixture' });

const factors = computeFactors(store.listPriceRows(), { asOf: '2026-09-16' });
const stock = factors.stocks.find((s) => s.ticker === '600519');
const fanli = computeFanli(stock.factors);

// 合成训练样本（确定性 PRNG，保证可复现）。标签由特征线性组合 + 噪声生成。
const rnd = mulberry32(42);
const samples = [];
for (let i = 0; i < 400; i++) {
  const momentum_z = rnd() * 4 - 2;
  const vol_z = rnd() * 4 - 2;
  const drawdown_z = rnd() * 4 - 2;
  const liquidity_z = rnd() * 4 - 2;
  const score = 0.6 * momentum_z - 0.4 * vol_z - 0.3 * drawdown_z + 0.2 * liquidity_z;
  const p = 1 / (1 + Math.exp(-score));
  const positive_return = rnd() < p ? 1 : 0;
  samples.push({
    features: { momentum_z, vol_z, drawdown_z, liquidity_z },
    labels: {
      positive_return,
      outperform_benchmark: rnd() < p ? 1 : 0,
      max_drawdown_gt_10: rnd() < (1 - p) * 0.5 ? 1 : 0
    }
  });
}

const prob = computeProbability({
  samples,
  predict: [{ ticker: '600519', features: { momentum_z: 0.8, vol_z: -0.5, drawdown_z: -0.6, liquidity_z: 0.3 } }],
  ticker: '600519', as_of: '2026-09-16', horizon: '20D'
});

console.log('\n=== 范蠡六维评分（600519）===');
console.log(JSON.stringify(fanli, null, 2));
console.log('\n=== 概率引擎（合成样本，V6 验证）===');
console.log(JSON.stringify(prob, null, 2));
const bt = runBacktestJob({ seed: 42, periods: 120, tickers: 20, cost: 0.001 });
const calib = evaluateCalibration(samples, { target: 'positive_return', trainSize: 0.6, step: 40, calibration: 'platt' });

console.log('\n=== 回测指标（合成面板，V7 验证）===');
console.log(JSON.stringify(bt.backtest.metrics, null, 2));
console.log('\n=== 概率校准评估（positive_return）===');
console.log(JSON.stringify(calib, null, 2));
console.log('\n=== 因子引擎 missing_factors ===');
console.log(JSON.stringify(factors.missing_factors, null, 2));




const pf = optimizePortfolio({ seed: 42, tickers: 8, periods: 252, max_weight: 0.25, max_cvar: 0.05 });
console.log('\n=== 组合优化（合成，V8 验证）===');
console.log(JSON.stringify(pf, null, 2));
