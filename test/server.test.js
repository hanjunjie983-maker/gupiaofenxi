process.env.LOG_LEVEL = 'silent';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/http_server.js';
import { loadConfig } from '../src/config.js';
import { createMemoryStore } from '../src/store/memory.js';
import { SecEdgarConnector } from '../src/ingest/edgar.js';
import { BaostockConnector } from '../src/ingest/baostock.js';
import { buildWeekdayFallback, normalizeImportedDays } from '../src/calendar/calendar.js';
import { QualityGate } from '../src/quality/engine.js';
import { withRetry } from '../src/util/retry.js';
import { TokenBucket } from '../src/util/rate_limiter.js';
import { winsorize, sectorNeutralize } from '../src/factors/stats.js';
import { computeFactors } from '../src/factors/engine.js';
import { computeFanli, FANLI_WEIGHTS } from '../src/factors/fanli.js';
import { fitLogistic } from '../src/probability/logistic.js';
import { computeProbability, fitProbabilityModel } from '../src/probability/engine.js';
import { brierScore, reliabilityTable } from '../src/probability/calibration.js';
import { mulberry32 } from '../src/probability/math.js';
import { generatePanel, runBacktest } from '../src/backtest/backtest.js';
import { runBacktestJob, evaluateCalibration } from '../src/backtest/engine.js';
import { optimizePortfolio } from '../src/portfolio/engine.js';
import { kellyWeight, inverseVolWeights } from '../src/portfolio/risk.js';
import { aggregateHealth } from '../src/admin/health.js';
import { createApiKey, listKeys, maskKey } from '../src/admin/keys.js';
import { initDefaultDocs, publishDoc, getDoc, listDocs } from '../src/compliance/disclaimers.js';
import { computeDashboard } from '../src/dashboard/engine.js';
import { pitEffectiveDate, nextTradingDay, joinPit } from '../src/factors/point_in_time.js';
import { SecCompanyFactsConnector } from '../src/ingest/edgar_facts.js';
import { fundamentalFactors, mergeFactorSets } from '../src/factors/fundamental.js';
import { pickLatest, CANDIDATE_TAGS } from '../src/factors/xbrl_map.js';
import { computeFanliV2 } from '../src/factors/fanli_v2.js';
import { computeFanliSummary } from '../src/factors/fanli_summary.js';
import { computeSmartRecommendation } from '../src/analysis/smart_recommendation.js';
import { buildFeatures, buildSamples, trainFactorProbability } from '../src/probability/factor_probability.js';
import { resetRateLimits } from '../src/observability/rate_limit.js';
import { listTools, runTool } from '../src/agent/tools.js';
import { EastmoneyConnector } from '../src/ingest/eastmoney.js';
import { valuationScore } from '../src/factors/valuation_cycle.js';
import { runRealBacktest, buildFutureLabels } from '../src/backtest/real_backtest.js';
import { buildRealTrainingSamples, walkForwardRealProbability } from '../src/probability/real_training.js';
import { getRoutingPlan, chooseSource } from '../src/sources/router.js';
import { computeMonitor } from '../src/observability/monitor.js';
import { computeWorthBuyingProbability } from '../src/analysis/worth_buying.js';

const sampleRaw = {
  cik: '320193',
  name: 'Apple Inc.',
  tickers: ['AAPL'],
  filings: { recent: { form: ['10-K'], filingDate: ['2025-10-31'], reportDate: ['2025-09-27'], accessionNumber: ['0000320193-25-000001'] } }
};

const mockFetch = async () => new Response(JSON.stringify(sampleRaw), {
  status: 200,
  headers: { 'content-type': 'application/json' }
});

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test('GET /health returns ok', async () => {
  const server = createServer({ config: loadConfig(), store: createMemoryStore(), fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const res = await fetch(`${base}/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.version, '24.1.0');
  } finally {
    server.close();
  }
});

test('GET /v1/sources lists configured and planned sources', async () => {
  const server = createServer({ config: loadConfig(), store: createMemoryStore(), fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const res = await fetch(`${base}/v1/sources`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.data.some((s) => s.id === 'sec-edgar' && s.status === 'configured'));
    assert.ok(body.data.some((s) => s.id === 'baostock' && s.status === 'configured'));
    assert.ok(body.data.some((s) => s.id === 'tushare' && s.status === 'not_configured'));
  } finally {
    server.close();
  }
});

test('GET /v1/sources/:id/status returns 404 for unknown source', async () => {
  const server = createServer({ config: loadConfig(), store: createMemoryStore(), fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const res = await fetch(`${base}/v1/sources/unknown/status`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

test('POST /v1/sources/sec-edgar/run returns provenance record', async () => {
  const server = createServer({ config: loadConfig(), store: createMemoryStore(), fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const res = await fetch(`${base}/v1/sources/sec-edgar/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cik: '320193' })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.code, 0);
    assert.ok(body.data.source_url.startsWith('https://data.sec.gov/submissions/CIK'));
    assert.ok(body.data.retrieved_at);
    assert.equal(body.data.confidence, 0.9);
    assert.equal(body.data.field, 'edgar_submissions');
    assert.ok(body.data.raw_sha256);
  } finally {
    server.close();
  }
});

test('SecEdgarConnector.normalize builds stable provenance record', () => {
  const connector = new SecEdgarConnector({ config: loadConfig(), store: createMemoryStore(), fetchImpl: mockFetch });
  const url = 'https://data.sec.gov/submissions/CIK0000320193.json';
  const record = connector.normalize(sampleRaw, '320193', url);
  assert.equal(record.cik, '0000320193');
  assert.equal(record.tickers[0], 'AAPL');
  assert.equal(record.latest_forms[0].form, '10-K');
  assert.equal(record.source_url, url);
});

test('BaostockConnector.normalizeRow maps sh.600519 to price_daily schema', () => {
  const connector = new BaostockConnector({ config: loadConfig(), store: createMemoryStore() });
  const row = connector.normalizeRow({
    date: '2026-09-16', code: 'sh.600519', open: '1388.00', high: '1399.00', low: '1380.00',
    close: '1392.00', preclose: '1388.00', volume: '1755123', amount: '2443567890.00',
    adjustflag: '3', turn: '0.11', tradestatus: '1', pctChg: '0.29', isST: '0'
  });
  assert.equal(row.ticker, '600519');
  assert.equal(row.exchange, 'SH');
  assert.equal(row.trade_date, '2026-09-16');
  assert.equal(row.close, 1392);
  assert.equal(row.volume, 1755123);
  assert.equal(row.adjustflag, '3');
});

test('BaostockConnector.run fixture passes quality gate and saves rows', async () => {
  const store = createMemoryStore();
  store.saveCalendarDays(normalizeImportedDays(
    ['2026-09-14', '2026-09-15', '2026-09-16'].map((d) => ({ calendar_date: d, is_open: true })),
    { source: 'demo', confidence: 0.95, is_verified: true }
  ));
  const connector = new BaostockConnector({ config: loadConfig(), store });
  const result = await connector.run({ ticker: 'sh.600519', mode: 'fixture' });
  assert.equal(result.rows, 3);
  assert.equal(result.rejected_rows, 0);
  assert.equal(result.source_id, 'baostock');
  assert.ok(result.source_url.startsWith('baostock://'));
  assert.ok(result.raw_sha256);
  assert.equal(store.listPriceRows('600519').length, 3);
  assert.equal(store.getRun('baostock').rows, 3);
  assert.equal(store.listAuditEvents().length, 1);
});

test('POST /v1/sources/baostock/run returns rows and price_daily lists them', async () => {
  const server = createServer({ config: loadConfig(), store: createMemoryStore(), fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const runRes = await fetch(`${base}/v1/sources/baostock/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticker: 'sh.600519', mode: 'fixture' })
    });
    const runBody = await runRes.json();
    assert.equal(runRes.status, 200);
    assert.equal(runBody.data.rows, 3);

    const priceRes = await fetch(`${base}/v1/price_daily?ticker=600519`);
    const priceBody = await priceRes.json();
    assert.equal(priceRes.status, 200);
    assert.equal(priceBody.data.length, 3);
    assert.equal(priceBody.data[0].exchange, 'SH');
  } finally {
    server.close();
  }
});

test('calendar weekday fallback excludes weekends and is unverified', () => {
  const days = buildWeekdayFallback('2026-09-14', '2026-09-20');
  assert.equal(days.length, 5);
  assert.ok(days.every((d) => d.is_verified === false));
  assert.ok(days.every((d) => d.source === 'weekday_fallback'));
  assert.equal(days[0].calendar_date, '2026-09-14');
});

test('POST /v1/calendar/import stores verified days and GET /v1/calendar returns them', async () => {
  const server = createServer({ config: loadConfig(), store: createMemoryStore(), fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const importRes = await fetch(`${base}/v1/calendar/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ days: [{ calendar_date: '2026-09-16', is_open: true }], source: 'demo_official' })
    });
    const importBody = await importRes.json();
    assert.equal(importRes.status, 200);
    assert.equal(importBody.data.saved.inserted, 1);

    const getRes = await fetch(`${base}/v1/calendar?start=2026-09-16&end=2026-09-16`);
    const getBody = await getRes.json();
    assert.equal(getBody.data.length, 1);
    assert.equal(getBody.data[0].is_verified, true);
  } finally {
    server.close();
  }
});

test('QualityGate rejects bad OHLC relation and negative volume', () => {
  const gate = new QualityGate({ store: createMemoryStore() });
  const report = gate.check([{
    ticker: '600519', exchange: 'SH', trade_date: '2026-09-16',
    open: 100, high: 80, low: 120, close: 90, preclose: 88,
    volume: -100, amount: 0, turnover: 0, pct_chg: 1, tradestatus: '1', is_st: '0', adjustflag: '3'
  }]);
  assert.equal(report.summary.rejected_rows, 1);
  assert.ok(report.results[0].errors.some((e) => e.rule === 'ohlc_relation'));
  assert.ok(report.results[0].errors.some((e) => e.rule === 'numeric_sanity'));
});

test('QualityGate rejects non-trading day when calendar marks it closed', () => {
  const store = createMemoryStore();
  store.saveCalendarDays(normalizeImportedDays(
    [{ calendar_date: '2026-09-19', is_open: false }],
    { source: 'demo', confidence: 0.95, is_verified: true }
  ));
  const gate = new QualityGate({ store });
  const report = gate.check([{
    ticker: '600519', exchange: 'SH', trade_date: '2026-09-19',
    open: 100, high: 105, low: 99, close: 104, preclose: 100,
    volume: 1000, amount: 0, turnover: 0, pct_chg: 1, tradestatus: '1', is_st: '0', adjustflag: '3'
  }]);
  assert.equal(report.summary.rejected_rows, 1);
  assert.ok(report.results[0].errors.some((e) => e.rule === 'trading_day'));
});

test('withRetry retries then succeeds', async () => {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    if (calls < 3) throw new Error('transient');
    return 'ok';
  };
  const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 5, jitter: 0 });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('TokenBucket allows capacity burst then rejects when refill is zero', async () => {
  const bucket = new TokenBucket({ capacity: 3, refillPerSecond: 0, now: () => 0 });
  await bucket.acquire(3);
  await assert.rejects(() => bucket.acquire(1), /capacity exhausted/);
});


test('winsorize caps extreme outliers at MAD boundary', () => {
  const out = winsorize([1, 2, 3, 100], 3);
  assert.equal(out[3], 5.5);
  assert.deepEqual(out.slice(0, 3), [1, 2, 3]);
});

test('sectorNeutralize demeans within sector', () => {
  const out = sectorNeutralize([1, 2, 3, 4], ['A', 'A', 'B', 'B']);
  assert.deepEqual(out, [-0.5, 0.5, -0.5, 0.5]);
});

test('computeFactors computes momentum, volatility and drawdown from price rows', () => {
  const rows = [];
  for (let i = 0; i < 30; i++) {
    let close = 100 + i;
    if (i === 20) close = 70; // 制造一个回撤，确保 max_drawdown < 0
    rows.push({
      ticker: '600519', exchange: 'SH', trade_date: `2026-08-${String(i + 1).padStart(2, '0')}`,
      close, turnover: 0.1, amount: 1e9
    });
  }
  const result = computeFactors(rows, { asOf: '2026-08-30' });
  assert.equal(result.universe_size, 1);
  const f = result.stocks[0].factors;
  assert.ok(Number.isFinite(f.mom_20d.raw));
  assert.ok(Number.isFinite(f.vol_20d.raw));
  assert.ok(f.max_drawdown_60d.raw < 0);
  assert.equal(f.mom_20d.zscore, 0); // 单一样本 Z-score 为 0
});

test('computeFanli returns partial score and marks missing fundamental dimensions', () => {
  const fanli = computeFanli({
    mom_20d: { zscore: 1.0 },
    vol_20d: { zscore: 0.0 },
    max_drawdown_60d: { zscore: -0.5 }
  });
  assert.equal(fanli.status, 'partial');
  assert.equal(fanli.dimensions['贵贱估值'].status, 'data_missing');
  assert.equal(fanli.dimensions['择人任时'].status, 'computed');
  assert.ok(Number.isFinite(fanli.fanli_score));
  assert.equal(Object.keys(FANLI_WEIGHTS).length, 6);
});


function syntheticSamples(n = 300, seed = 42) {
  const rnd = mulberry32(seed);
  const samples = [];
  for (let i = 0; i < n; i++) {
    const momentum_z = rnd() * 4 - 2;
    const vol_z = rnd() * 4 - 2;
    const drawdown_z = rnd() * 4 - 2;
    const liquidity_z = rnd() * 4 - 2;
    const score = 0.6 * momentum_z - 0.4 * vol_z - 0.3 * drawdown_z + 0.2 * liquidity_z;
    const p = 1 / (1 + Math.exp(-score));
    samples.push({
      features: { momentum_z, vol_z, drawdown_z, liquidity_z },
      labels: {
        positive_return: rnd() < p ? 1 : 0,
        outperform_benchmark: rnd() < p ? 1 : 0,
        max_drawdown_gt_10: rnd() < (1 - p) * 0.5 ? 1 : 0
      }
    });
  }
  return samples;
}

test('fitLogistic recovers signal direction on synthetic data', () => {
  const X = [[-2], [-1], [0], [1], [2], [-2], [-1], [1], [2], [2]];
  const y = [0, 0, 0, 1, 1, 0, 0, 1, 1, 1];
  const lr = fitLogistic(X, y, { lambda: 1 });
  assert.ok(lr.weights[0] > 0);
  assert.ok(lr.predictProba([[2]])[0] > lr.predictProba([[-2]])[0]);
});

test('computeProbability returns calibrated probabilities and CI bounds', () => {
  const samples = syntheticSamples(300, 42);
  const result = computeProbability({
    samples,
    predict: [{ ticker: 'SYN', features: { momentum_z: 1.0, vol_z: -0.5, drawdown_z: -0.5, liquidity_z: 0.5 } }],
    horizon: '20D'
  });
  const p = result.predictions[0];
  assert.equal(result.sample_size, 300);
  assert.ok(p.P_positive_return >= 0 && p.P_positive_return <= 1);
  assert.ok(p.P_outperform_benchmark >= 0 && p.P_outperform_benchmark <= 1);
  assert.ok(p.P_max_drawdown_gt_10 >= 0 && p.P_max_drawdown_gt_10 <= 1);
  assert.ok(p.positive_return_ci[0] <= p.positive_return_ci[1]);
});

test('bootstrap CI is within [0,1] and non-empty', () => {
  const samples = syntheticSamples(300, 7);
  const model = fitProbabilityModel(samples, 'positive_return', { calibration: 'platt' });
  const x = [1.0, -0.5, -0.5, 0.5];
  const pred = model.predict(x, { nBoot: 80, seed: 7 });
  assert.ok(pred.confidence_interval[0] >= 0);
  assert.ok(pred.confidence_interval[1] <= 1);
  assert.ok(pred.confidence_interval[0] < pred.confidence_interval[1]);
});

test('POST /v1/probability/compute and GET /v1/stocks/:ticker/probability', async () => {
  const server = createServer({ config: loadConfig(), store: createMemoryStore(), fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const samples = syntheticSamples(150, 5);
    const postRes = await fetch(`${base}/v1/probability/compute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ samples, predict: [{ ticker: 'SYN', features: { momentum_z: 1, vol_z: -0.5, drawdown_z: -0.5, liquidity_z: 0.5 } }] })
    });
    const postBody = await postRes.json();
    assert.equal(postRes.status, 200);
    assert.ok(postBody.data.predictions[0].P_positive_return !== undefined);

    const getRes = await fetch(`${base}/v1/stocks/SYN/probability`);
    const getBody = await getRes.json();
    assert.equal(getRes.status, 200);
    assert.equal(getBody.data.ticker, 'SYN');
    assert.ok(getBody.data.disclaimer);
  } finally {
    server.close();
  }
});


test('generatePanel returns deterministic panel with expected shape', () => {
  const a = generatePanel({ tickers: 10, periods: 50, seed: 42 });
  const b = generatePanel({ tickers: 10, periods: 50, seed: 42 });
  assert.equal(a.tickers.length, 10);
  assert.equal(a.signals.length, 10);
  assert.equal(a.signals[0].length, 50);
  assert.deepEqual(a.signals, b.signals);
});

test('runBacktest long-short has positive return when signal is predictive', () => {
  const panel = generatePanel({ tickers: 30, periods: 200, seed: 42, ic: 0.15, vol: 0.05 });
  const result = runBacktest(panel, { topQuantile: 0.2, cost: 0.0005, longOnly: false });
  assert.ok(result.metrics.long_short.cumulative_return > 0);
  assert.ok(result.metrics.long_short.max_drawdown <= 0);
  assert.ok(Number.isFinite(result.metrics.long_short.sharpe));
  assert.ok(result.rebalance_count > 0);
});

test('evaluateCalibration returns folds, brier and reliability', () => {
  const samples = syntheticSamples(300, 42);
  const result = evaluateCalibration(samples, { target: 'positive_return', trainSize: 0.6, step: 30, calibration: 'platt' });
  assert.ok(result.folds.length > 0);
  assert.ok(Number.isFinite(result.aggregate.brier));
  assert.ok(Number.isFinite(result.aggregate.brier_baseline));
  assert.ok(result.aggregate.reliability.length > 0);
});

test('POST /v1/backtests/run and GET /v1/backtests/:id', async () => {
  const server = createServer({ config: loadConfig(), store: createMemoryStore(), fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const postRes = await fetch(`${base}/v1/backtests/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tickers: 20, periods: 60, seed: 7 })
    });
    const postBody = await postRes.json();
    assert.equal(postRes.status, 200);
    const id = postBody.data.id;
    assert.ok(id);

    const getRes = await fetch(`${base}/v1/backtests/${id}`);
    const getBody = await getRes.json();
    assert.equal(getRes.status, 200);
    assert.equal(getBody.data.id, id);
    assert.ok(getBody.data.job.backtest.metrics.long_short);
  } finally {
    server.close();
  }
});

test('optimizePortfolio weights sum to 1 and respect max weight', () => {
  const result = optimizePortfolio({ seed: 42, tickers: 8, periods: 252, max_weight: 0.25, max_cvar: 0.05 });
  const sum = result.weights.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(result.weights.every((w) => w <= 0.25 + 1e-9));
  assert.ok(result.rebalance_plan.every((p) => Math.abs(p.delta) > 0.001));
});

test('risk parity contributions are approximately equal under pure inverse-vol', () => {
  const result = optimizePortfolio({ seed: 42, tickers: 8, periods: 252, blend: 1, max_weight: 0.5, max_cvar: 1 });
  const risky = result.risk_contributions;
  const spread = Math.max(...risky) - Math.min(...risky);
  assert.ok(spread < 0.02, `risk contribution spread ${spread}`);
});

test('fractional Kelly is capped by fraction and inverse vol weights sum to 1', () => {
  const w = kellyWeight({ p: 0.6, odds: 1, fraction: 0.25 });
  const full = (0.6 * 1 - 0.4) / 1;
  assert.equal(w, full * 0.25);
  const inv = inverseVolWeights([0.2, 0.4, 0.8]);
  assert.ok(Math.abs(inv.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('POST /v1/portfolio/optimize and GET /v1/portfolio/:id', async () => {
  const server = createServer({ config: loadConfig(), store: createMemoryStore(), fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const postRes = await fetch(`${base}/v1/portfolio/optimize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tickers: 8, periods: 120, seed: 7, max_weight: 0.3 })
    });
    const postBody = await postRes.json();
    assert.equal(postRes.status, 200);
    const id = postBody.data.id;
    assert.ok(id);
    const getRes = await fetch(`${base}/v1/portfolio/${id}`);
    const getBody = await getRes.json();
    assert.equal(getRes.status, 200);
    assert.equal(getBody.data.id, id);
    assert.ok(getBody.data.weights.length > 0);
  } finally {
    server.close();
  }
});

test('aggregateHealth scores configured and ok sources', () => {
  const store = createMemoryStore();
  store.saveRun({ source_id: 'baostock', status: 'ok', rows: 3, error: null, retry_count: 0 });
  const health = aggregateHealth(store);
  assert.ok(Number.isFinite(health.overall_score));
  assert.equal(health.items.find((s) => s.id === 'baostock').score, 100);
  assert.equal(health.items.find((s) => s.id === 'tushare').status, 'not_configured');
});

test('createApiKey returns plaintext once and listKeys masks secret', () => {
  const store = createMemoryStore();
  const created = createApiKey(store, { name: 'test-key' });
  assert.ok(created.key.startsWith('fk_'));
  assert.equal(created.masked, maskKey(created.key));
  const listed = listKeys(store);
  assert.equal(listed.length, 1);
  assert.ok(!('key' in listed[0]));
  assert.ok(!('key_hash' in listed[0]));
});

test('compliance disclaimers support versioning and latest lookup', () => {
  const store = createMemoryStore();
  initDefaultDocs(store);
  const before = getDoc(store, 'disclaimer');
  assert.equal(before.version, '1.0.0');
  publishDoc(store, { type: 'disclaimer', version: '1.1.0', title: '免责声明', content: '更新后的声明' });
  const latest = getDoc(store, 'disclaimer');
  assert.equal(latest.version, '1.1.0');
  assert.equal(listDocs(store, 'disclaimer').length, 2);
});

test('GET /v1/sources/health and compliance/admin endpoints', async () => {
  const server = createServer({ config: loadConfig(), store: createMemoryStore(), fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const healthRes = await fetch(`${base}/v1/sources/health`);
    const healthBody = await healthRes.json();
    assert.equal(healthRes.status, 200);
    assert.ok(Number.isFinite(healthBody.data.overall_score));

    const docsRes = await fetch(`${base}/v1/compliance/disclaimers?type=disclaimer`);
    const docsBody = await docsRes.json();
    assert.equal(docsRes.status, 200);
    assert.equal(docsBody.data.version, '1.0.0');

    const keyRes = await fetch(`${base}/v1/admin/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'web' })
    });
    const keyBody = await keyRes.json();
    assert.equal(keyRes.status, 201);
    assert.ok(keyBody.data.key);
    assert.ok(!('key_hash' in keyBody.data));
    const keysRes = await fetch(`${base}/v1/admin/keys`);
    const keysBody = await keysRes.json();
    assert.equal(keysBody.data[0].masked, keyBody.data.masked);
    assert.ok(!('key' in keysBody.data[0]));
  } finally {
    server.close();
  }
});





test('computeDashboard degrades gracefully on empty store', () => {
  const store = createMemoryStore();
  initDefaultDocs(store);
  const dash = computeDashboard({ store });
  assert.equal(dash.market_temperature.status, 'data_missing');
  assert.equal(dash.fanli_compass.status, 'data_missing');
  assert.equal(dash.probability_snapshot.status, 'data_missing');
  assert.equal(dash.risk_warning.status, 'computed');
  assert.ok(dash.compliance_reminder.title);
});

test('computeDashboard computes market temperature with enough price rows', () => {
  const store = createMemoryStore();
  initDefaultDocs(store);
  for (let i = 0; i < 30; i++) {
    store.savePriceRows([{ ticker: '600519', exchange: 'SH', trade_date: `2026-08-${String(i + 1).padStart(2, '0')}`, close: 100 + i, open: 100 + i, high: 101 + i, low: 99 + i, volume: 1000, amount: 1e9, turnover: 0.1, preclose: 99 + i, pct_chg: 0, tradestatus: '1', is_st: '0', adjustflag: '3', adj_close: 100 + i }]);
  }
  const dash = computeDashboard({ store });
  assert.equal(dash.market_temperature.status, 'computed');
  assert.equal(dash.fanli_compass.status, 'computed');
  assert.ok(dash.market_temperature.temperature !== null);
});

test('computeDashboard aggregates probability and portfolio risk', () => {
  const store = createMemoryStore();
  initDefaultDocs(store);
  const probability = { predictions: [{ P_positive_return: 0.6, P_outperform_benchmark: 0.7, P_max_drawdown_gt_10: 0.2 }, { P_positive_return: 0.8, P_outperform_benchmark: 0.5, P_max_drawdown_gt_10: 0.1 }] };
  const portfolio = { cvar: 0.06, cvar_cap: 0.04 };
  const dash = computeDashboard({ store, probability, portfolio });
  assert.equal(dash.probability_snapshot.status, 'computed');
  assert.equal(dash.probability_snapshot.count, 2);
  assert.equal(dash.risk_warning.level, 'high');
  assert.ok(dash.risk_warning.triggers.includes('组合 CVaR 超预算'));
});

test('GET /v1/dashboard/overview returns aggregated dashboard', async () => {
  const server = createServer({ config: loadConfig(), store: createMemoryStore(), fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const res = await fetch(`${base}/v1/dashboard/overview`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.data.source_health);
    assert.ok(body.data.market_temperature);
    assert.ok(body.data.risk_warning);
    assert.ok(body.data.compliance_reminder);
  } finally {
    server.close();
  }
});

test('GET / serves homepage and /stock.html serves stock page', async () => {
  const server = createServer({ config: loadConfig(), store: createMemoryStore(), fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const homeRes = await fetch(`${base}/`);
    const homeText = await homeRes.text();
    assert.equal(homeRes.status, 200);
    assert.ok(homeText.includes('范蠡罗盘'));

    const stockRes = await fetch(`${base}/stock.html`);
    const stockText = await stockRes.text();
    assert.equal(stockRes.status, 200);
    assert.ok(stockText.includes('个股研究'));
  } finally {
    server.close();
  }
});

test('GET /css/style.css serves stylesheet', async () => {
  const server = createServer({ config: loadConfig(), store: createMemoryStore(), fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const res = await fetch(`${base}/css/style.css`);
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/css'));
    assert.ok(text.includes('--accent'));
  } finally {
    server.close();
  }
});


test('pitEffectiveDate returns next trading day from calendar', () => {
  const calendar = [
    { calendar_date: '2026-09-14', is_open: true },
    { calendar_date: '2026-09-15', is_open: true },
    { calendar_date: '2026-09-16', is_open: true }
  ];
  assert.equal(pitEffectiveDate('2026-09-14', calendar), '2026-09-15');
  assert.equal(pitEffectiveDate('2026-09-16', calendar), null); // 日历内无后续交易日
});

test('nextTradingDay falls back to weekday when no calendar', () => {
  assert.equal(nextTradingDay('2026-09-18', []), '2026-09-21'); // 周五 → 下周一
  assert.equal(nextTradingDay('2026-09-19', []), '2026-09-21'); // 周六 → 下周一
});

test('joinPit only joins announcement after effective date', () => {
  const calendar = [{ calendar_date: '2026-09-15', is_open: true }, { calendar_date: '2026-09-16', is_open: true }];
  const rows = [
    { ticker: '600519', exchange: 'SH', trade_date: '2026-09-14' },
    { ticker: '600519', exchange: 'SH', trade_date: '2026-09-15' },
    { ticker: '600519', exchange: 'SH', trade_date: '2026-09-16' }
  ];
  const anns = [{ ticker: '600519', exchange: 'SH', publish_date: '2026-09-14', field: 'eps', value: 10 }];
  const joined = joinPit(rows, anns, calendar);
  assert.equal(joined[0].eps, null);      // 9-14 行情，公告 9-15 生效
  assert.equal(joined[1].eps, 10);        // 9-15 生效
  assert.equal(joined[2].eps, 10);
  assert.equal(joined[0]._pit_pending_count, 1);
});

const factsSample = {
  entityName: 'Apple Inc.',
  facts: {
    'us-gaap': {
      Revenues: { units: { USD: [{ form: '10-K', end: '2025-09-27', val: 400000000000 }] } },
      NetIncomeLoss: { units: { USD: [{ form: '10-K', end: '2025-09-27', val: 100000000000 }] } },
      StockholdersEquity: { units: { USD: [{ form: '10-K', end: '2025-09-27', val: 60000000000 }] } },
      Assets: { units: { USD: [{ form: '10-K', end: '2025-09-27', val: 360000000000 }] } },
      Liabilities: { units: { USD: [{ form: '10-K', end: '2025-09-27', val: 300000000000 }] } },
      GrossProfit: { units: { USD: [{ form: '10-K', end: '2025-09-27', val: 180000000000 }] } },
      NetCashProvidedByUsedInOperatingActivities: { units: { USD: [{ form: '10-K', end: '2025-09-27', val: 120000000000 }] } },
      PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: [{ form: '10-K', end: '2025-09-27', val: 10000000000 }] } }
    }
  }
};

test('SecCompanyFactsConnector.normalize computes fundamental ratios', () => {
  const connector = new SecCompanyFactsConnector({ config: loadConfig(), store: createMemoryStore() });
  const rec = connector.normalize(factsSample, '320193', 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json');
  assert.equal(rec.ratios.roe, 100000000000 / 60000000000);
  assert.equal(rec.ratios.gross_margin, 180000000000 / 400000000000);
  assert.equal(rec.ratios.debt_ratio, 300000000000 / 360000000000);
  assert.equal(rec.ratios.fcf, 110000000000);
  assert.ok(rec.raw_sha256);
});

test('fundamentalFactors and mergeFactorSets merge price and fundamentals', () => {
  const fund = fundamentalFactors({ roe: 0.2, gross_margin: 0.5, debt_ratio: 0.4, fcf: 1e9, fcf_margin: 0.2, roa: 0.1 });
  assert.equal(fund.roe, 0.2);
  const merged = mergeFactorSets({ mom_20d: { raw: 0.1, winsorized: 0.1, zscore: 0 } }, fund);
  assert.ok(merged.mom_20d);
  assert.equal(merged.roe.raw, 0.2);
});

test('pickLatest prefers the most recent 10-K tag', () => {
  const raw = {
    facts: { 'us-gaap': {
      RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [{ form: '10-K', end: '2025-09-27', val: 400000000000 }] } },
      Revenues: { units: { USD: [{ form: '10-K', end: '2018-09-29', val: 265595000000 }] } }
    } }
  };
  const picked = pickLatest(raw, CANDIDATE_TAGS.revenue);
  assert.equal(picked.tag, 'RevenueFromContractWithCustomerExcludingAssessedTax');
  assert.equal(picked.val, 400000000000);
});

test('computeFanliV2 computes quality dimension from fundamentals', () => {
  const fanli = computeFanliV2({
    price: { mom_20d: { zscore: 0.8 }, vol_20d: { zscore: -0.5 }, max_drawdown_60d: { zscore: -0.4 } },
    fundamentals: { roe: 0.3, roic: 0.25, gross_margin: 0.5, debt_ratio: 0.4, fcf_margin: 0.2, operating_cashflow_to_revenue: 0.8, cash_ratio: 1.2, total_asset_turnover: 0.4, revenue_growth: 10 }
  });
  assert.equal(fanli.dimensions['完物质量'].status, 'computed');
  assert.equal(fanli.dimensions['无息币周转'].status, 'computed');
  assert.ok(fanli.dimensions['完物质量'].score > 0);
  assert.equal(fanli.dimensions['择人任时'].status, 'computed');
  assert.equal(fanli.dimensions['待乏需求'].status, 'computed');
  assert.ok(fanli.coverage > 0);
  assert.equal(fanli.status, 'partial_estimated');
});

function factorAssets(n = 30, seed = 42) {
  const rnd = mulberry32(seed);
  const assets = [];
  for (let i = 0; i < n; i++) {
    assets.push({
      ticker: `F${i + 1}`,
      price_factors: {
        mom_20d: { zscore: rnd() * 4 - 2 },
        mom_60d: { zscore: rnd() * 4 - 2 },
        vol_20d: { zscore: rnd() * 4 - 2 },
        max_drawdown_60d: { zscore: rnd() * 4 - 2 }
      },
      fundamentals: { roe: rnd(), gross_margin: rnd(), debt_ratio: rnd(), fcf_margin: rnd() },
      source_url: 'https://example.com/synthetic'
    });
  }
  return assets;
}

test('buildFeatures maps price and fundamental factors with missing markers', () => {
  const { features, missing_features } = buildFeatures({
    price_factors: { mom_20d: { zscore: 1.2 }, vol_20d: { zscore: -0.5 } },
    fundamentals: { roe: 0.2, gross_margin: 0.4 }
  });
  assert.equal(features.mom_20d_z, 1.2);
  assert.equal(features.roe, 0.2);
  assert.equal(features.debt_ratio, 0);
  assert.ok(missing_features.includes('debt_ratio'));
});

test('trainFactorProbability returns predictions, CI and calibration metrics', () => {
  const assets = factorAssets(30, 7);
  const result = trainFactorProbability({ assets, predict: [{ ticker: 'F1', price_factors: assets[0].price_factors, fundamentals: assets[0].fundamentals }], seed: 7 });
  assert.equal(result.sample_size, 30);
  assert.equal(result.labels_source, 'synthetic_for_pipeline_validation');
  assert.ok(result.predictions[0].P_positive_return >= 0);
  assert.ok(result.predictions[0].positive_return_ci[1] >= result.predictions[0].positive_return_ci[0]);
  assert.ok(Number.isFinite(result.metrics.positive_return.brier_calibrated));
});

test('POST /v1/probability/from-factors and GET /v1/stocks/:ticker/probability-v2', async () => {
  const server = createServer({ config: loadConfig(), store: createMemoryStore(), fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const assets = factorAssets(25, 3);
    const postRes = await fetch(`${base}/v1/probability/from-factors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assets, predict: [{ ticker: 'F1', price_factors: assets[0].price_factors, fundamentals: assets[0].fundamentals }], seed: 3 })
    });
    const postBody = await postRes.json();
    assert.equal(postRes.status, 200);
    assert.equal(postBody.data.sample_size, 25);
    const getRes = await fetch(`${base}/v1/stocks/F1/probability-v2`);
    const getBody = await getRes.json();
    assert.equal(getRes.status, 200);
    assert.ok(getBody.data.P_positive_return >= 0);
    assert.ok(getBody.data.disclaimer);
  } finally {
    server.close();
  }
});

test('stock page and stock.js reference V2 endpoints', async () => {
  const server = createServer({ config: loadConfig(), store: createMemoryStore(), fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const html = await (await fetch(`${base}/stock.html`)).text();
    const js = await (await fetch(`${base}/js/stock.js`)).text();
    assert.ok(html.includes('范蠡六维 V3'));
    assert.ok(html.includes('全因子表'));
    assert.ok(js.includes('/fanli-v3'));
    assert.ok(js.includes('/fundamentals'));
    assert.ok(js.includes('/factor-table'));
    assert.ok(js.includes('/probability-v2'));
    assert.ok(js.includes('/valuation'));
    assert.ok(js.includes('/industry-cycle'));
  } finally {
    server.close();
  }
});

test('health live/ready and request id header', async () => {
  resetRateLimits();
  const server = createServer({ config: loadConfig(), store: createMemoryStore(), fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const live = await fetch(`${base}/health/live`);
    const ready = await fetch(`${base}/health/ready`);
    assert.equal(live.status, 200);
    assert.equal(ready.status, 200);
    assert.ok(live.headers.get('x-request-id'));
    assert.equal((await live.json()).status, 'alive');
    assert.equal((await ready.json()).status, 'ready');
  } finally {
    server.close();
    resetRateLimits();
  }
});

test('rate limit returns 429 after capacity', async () => {
  resetRateLimits();
  const config = { ...loadConfig(), rateLimitPerMinute: 1 };
  const server = createServer({ config, store: createMemoryStore(), fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const first = await fetch(`${base}/v1/sources`);
    const second = await fetch(`${base}/v1/sources`);
    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal((await second.json()).code, 42900);
  } finally {
    server.close();
    resetRateLimits();
  }
});



test('agent tool registry and source_health tool audit', async () => {
  const store = createMemoryStore();
  const tools = listTools();
  assert.ok(tools.some((t) => t.name === 'fetch_sec_facts'));
  assert.ok(tools.some((t) => t.name === 'query_sql' && t.status === 'not_configured'));
  const result = await runTool('source_health', {}, { store, config: loadConfig(), fetchImpl: mockFetch });
  assert.equal(result.ok, true);
  assert.ok(store.listAuditEvents().some((e) => e.action === 'tool:source_health'));
});

test('POST /v1/agent/research returns fanli and tools used', async () => {
  const store = createMemoryStore();
  for (let i = 0; i < 25; i++) {
    const close = 100 + i;
    store.savePriceRows([{ ticker: 'aapl', exchange: 'US', trade_date: `2026-08-${String(i + 1).padStart(2, '0')}`, open: close, high: close + 1, low: close - 1, close, preclose: close - 0.5, adj_close: close, volume: 1000000, amount: 1e9, turnover: 0.01, pct_chg: 1, tradestatus: '1', is_st: '0', adjustflag: '3' }]);
  }
  const server = createServer({ config: loadConfig(), store, fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const res = await fetch(`${base}/v1/agent/research`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticker: 'AAPL', cik: '0000320193' }) });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.code, 0);
    assert.ok(body.data.fanli);
    assert.ok(body.data.tools_used.length > 0);
  } finally {
    server.close();
  }
});

test('EastmoneyConnector.normalizeKlines maps real A-share kline JSON', () => {
  const connector = new EastmoneyConnector({ config: loadConfig(), store: createMemoryStore() });
  const rows = connector.normalizeKlines({ data: { klines: ['2026-09-15,100.00,101.00,102.00,99.00,1000000,100000000.00,3.00,1.00,1.00,0.50'] } }, '600519', 'SH', 1);
  assert.equal(rows[0].ticker, '600519');
  assert.equal(rows[0].exchange, 'SH');
  assert.equal(rows[0].close, 101);
  assert.equal(rows[0].adjustflag, '2');
});

test('Eastmoney valuation scoring and runValuation', async () => {
  const raw = { data: { f43: 125800, f57: '600519', f58: '贵州茅台', f116: 1572602654058, f162: 1766, f167: 626 } };
  const mock = async () => new Response(JSON.stringify(raw), { status: 200, headers: { 'content-type': 'application/json' } });
  const store = createMemoryStore();
  const connector = new EastmoneyConnector({ config: loadConfig(), store, fetchImpl: mock });
  const rec = await connector.runValuation({ ticker: '600519', market: 'SH' });
  assert.equal(rec.pe, 17.66);
  assert.equal(rec.pb, 6.26);
  assert.ok(valuationScore(rec) > 0);
  assert.ok(store.listAuditEvents().length > 0);
});

test('POST eastmoney endpoints and GET valuation/fanli-v3', async () => {
  const kline = { data: { code: '600519', name: '贵州茅台', klines: Array.from({ length: 30 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')},100.00,${100 + i}.00,${101 + i}.00,99.00,1000000,100000000.00,3.00,1.00,1.00,0.50`) } };
  const valuation = { data: { f43: 125800, f57: '600519', f58: '贵州茅台', f116: 1572602654058, f162: 1766, f167: 626 } };
  const industry = { data: { code: 'BK0477', name: '酿酒概念', klines: Array.from({ length: 80 }, (_, i) => `2026-06-${String((i % 30) + 1).padStart(2, '0')},100.00,${100 + i}.00,${101 + i}.00,99.00,1000000,100000000.00,3.00,1.00,1.00,0.50`) } };
  const mock = async (url) => {
    const body = String(url).includes('/stock/get') ? valuation : String(url).includes('BK0477') ? industry : kline;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const store = createMemoryStore();
  const server = createServer({ config: loadConfig(), store, fetchImpl: mock });
  const base = await listen(server);
  try {
    const runRes = await fetch(`${base}/v1/sources/eastmoney/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticker: '600519', market: 'SH', start_date: '2026-08-01', end_date: '2026-09-16' }) });
    assert.equal(runRes.status, 200);
    const valRes = await fetch(`${base}/v1/sources/eastmoney/valuation/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticker: '600519', market: 'SH' }) });
    assert.equal(valRes.status, 200);
    const indRes = await fetch(`${base}/v1/sources/eastmoney/industry/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secid: '90.BK0477', ticker: '600519' }) });
    assert.equal(indRes.status, 200);
    const valGet = await fetch(`${base}/v1/stocks/600519/valuation`);
    assert.equal(valGet.status, 200);
    const fanli = await fetch(`${base}/v1/stocks/600519/fanli-v3`);
    const fanliBody = await fanli.json();
    assert.equal(fanli.status, 200);
    assert.equal(fanliBody.data.fanli.dimensions['贵贱估值'].status, 'computed');
    assert.equal(fanliBody.data.fanli.dimensions['待乏需求'].status, 'computed');
  } finally {
    server.close();
  }
});

function realPriceRows(n = 80, seed = 22) {
  const rnd = mulberry32(seed);
  const rows = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    close = Math.max(1, close * (1 + (rnd() - 0.45) * 0.03));
    rows.push({ ticker: '600519', exchange: 'SH', trade_date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), close, open: close, high: close * 1.01, low: close * 0.99, volume: 1000, amount: 1e8, turnover: 0.01, preclose: close, pct_chg: 0, tradestatus: '1', is_st: '0', adjustflag: '2', adj_close: close });
  }
  return rows;
}

test('runRealBacktest and buildFutureLabels use price history without lookahead', () => {
  const rows = realPriceRows(80, 22);
  const bt = runRealBacktest(rows, { lookback: 20, cost: 0.001 });
  const labels = buildFutureLabels(rows, { horizon: 20 });
  assert.ok(bt.metrics.periods > 0);
  assert.ok(Number.isFinite(bt.metrics.sharpe));
  assert.ok(bt.metrics.max_drawdown <= 0);
  assert.equal(labels.length, 60);
  assert.ok(labels.every((l) => l.labels.positive_return === 0 || l.labels.positive_return === 1));
});

test('POST /v1/backtests/real uses stored price rows', async () => {
  const store = createMemoryStore();
  for (const row of realPriceRows(80, 7)) store.savePriceRows([row]);
  const server = createServer({ config: loadConfig(), store, fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const res = await fetch(`${base}/v1/backtests/real`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticker: '600519', lookback: 20, horizon: 20 }) });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.data.backtest.metrics.periods > 0);
    assert.ok(body.data.labels.count > 0);
  } finally {
    server.close();
  }
});


test('real training samples and walk-forward probability use future labels only', () => {
  const rows = realPriceRows(160, 23);
  const samples = buildRealTrainingSamples(rows, { lookback: 20, horizon: 20 });
  assert.ok(samples.length > 50);
  assert.ok(samples[0].features.mom !== undefined);
  assert.ok(samples[0].labels.positive_return === 0 || samples[0].labels.positive_return === 1);
  const wf = walkForwardRealProbability(rows, { lookback: 20, horizon: 20, trainWindow: 60, testWindow: 20, nBoot: 20, seed: 23 });
  assert.ok(wf.sample_size > 50);
  assert.ok(wf.aggregate.n_predictions > 0);
  assert.equal(wf.labels_source, 'real_price_future_returns');
  assert.ok(wf.latest_prediction.P_positive_return >= 0);
});

test('POST /v1/probability/real trains from stored real rows', async () => {
  const store = createMemoryStore();
  for (const row of realPriceRows(160, 5)) store.savePriceRows([row]);
  const server = createServer({ config: loadConfig(), store, fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const res = await fetch(`${base}/v1/probability/real`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticker: '600519', lookback: 20, horizon: 20, train_window: 60, test_window: 20, n_boot: 20 }) });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.labels_source, 'real_price_future_returns');
    assert.ok(body.data.latest_prediction.P_positive_return >= 0);
  } finally {
    server.close();
  }
});

test('backtest and portfolio pages are served and reference their APIs', async () => {
  const server = createServer({ config: loadConfig(), store: createMemoryStore(), fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const bt = await (await fetch(`${base}/backtest.html`)).text();
    const pf = await (await fetch(`${base}/portfolio.html`)).text();
    const btJs = await (await fetch(`${base}/js/backtest.js`)).text();
    const pfJs = await (await fetch(`${base}/js/portfolio.js`)).text();
    assert.ok(bt.includes('真实回测'));
    assert.ok(pf.includes('组合与仓位'));
    assert.ok(btJs.includes('/v1/backtests/real'));
    assert.ok(pfJs.includes('/v1/portfolio/optimize'));
  } finally {
    server.close();
  }
});



test('source routing prefers official sources in official_first mode', () => {
  const plan = getRoutingPlan({ sourceMode: 'official_first' });
  assert.equal(plan.mode, 'official_first');
  assert.equal(chooseSource('cn_equity_daily', { sourceMode: 'official_first' }), 'baostock');
  assert.equal(chooseSource('cn_equity_daily', { sourceMode: 'public_only' }), 'eastmoney');
});

test('computeMonitor returns health, metrics and alerts', () => {
  const store = createMemoryStore();
  store.saveRun({ source_id: 'baostock', status: 'error', rows: 0, error: 'timeout', retry_count: 3 });
  const monitor = computeMonitor(store);
  assert.ok(monitor.metrics.runs >= 1);
  assert.ok(monitor.alerts.some((a) => a.code === 'SOURCE_ERROR'));
});

test('sources page and routing/monitor endpoints', async () => {
  const server = createServer({ config: loadConfig(), store: createMemoryStore(), fetchImpl: mockFetch });
  const base = await listen(server);
  try {
    const html = await (await fetch(`${base}/sources.html`)).text();
    assert.ok(html.includes('数据源管理'));
    const routing = await (await fetch(`${base}/v1/sources/routing`)).json();
    const monitor = await (await fetch(`${base}/v1/monitor/overview`)).json();
    assert.equal(routing.code, 0);
    assert.equal(monitor.code, 0);
    assert.ok(routing.data.routes.cn_equity_daily.preferred);
  } finally {
    server.close();
  }
});

test('computeWorthBuyingProbability returns composite probability and CI', () => {
  const w = computeWorthBuyingProbability({
    probability: { sample_size: 617, aggregate: { brier: 0.20, base_rate: 0.40 }, latest_prediction: { P_positive_return: 0.42, confidence_interval: [0.38, 0.47] } },
    valuation: { pe: 17.66, pb: 6.26 },
    industry: { cycle_score: 0.52 },
    fanli: { fanli_score: 5.1 },
    backtest: { metrics: { sharpe: -0.2 } },
    risks: ['波动率偏高']
  });
  assert.ok(w.P_worth_buying >= 0 && w.P_worth_buying <= 1);
  assert.ok(w.confidence_interval[0] <= w.confidence_interval[1]);
  assert.equal(w.sample_size, 617);
  assert.equal(w.calibrated, true);
  assert.ok(w.calibration.brier_skill !== undefined);
  assert.ok(w.note.includes('不构成买入建议'));
});





test('computeFanliSummary produces a plain recommendation summary', () => {
  const strong = computeFanliSummary({ fanli: { fanli_score: 8.0, coverage: 1 }, worthBuying: 0.68, risks: [] });
  assert.equal(strong.label, '优秀');
  assert.equal(strong.recommendation, '可重点研究');
  const weak = computeFanliSummary({ fanli: { fanli_score: 3.0, coverage: 1 }, worthBuying: 0.2, risks: ['高波动', '回撤大'] });
  assert.equal(weak.recommendation, '暂不推荐');
  const missing = computeFanliSummary({ fanli: { fanli_score: 6.0, coverage: 0.4 } });
  assert.equal(missing.recommendation, '暂不判断');
});

test('computeSmartRecommendation combines modern factors and Fanli six dimensions', () => {
  const rec = computeSmartRecommendation({
    fanli: { fanli_score: 7.2, data_completeness: 1, estimated_dimensions: [] },
    fanliSummary: { label: '较好' },
    worthBuying: 0.62,
    probability: { latest_prediction: { P_positive_return: 0.58 } },
    backtest: { metrics: { sharpe: 0.8 } },
    valuation: { price: 100, pe: 18 },
    industry: { cycle_score: 0.6 },
    risks: [],
    positionAdvice: { suggested_position_pct: 0.1, suggested_amount: 100000, risk_budget_amount: 20000 },
    volatility: 0.25
  });
  assert.equal(rec.action, '可分批建仓 / 重点关注');
  assert.ok(rec.score > 60);
  assert.ok(rec.buy_signals.length >= 6);
  assert.ok(rec.entry_plan.length >= 3);
  assert.ok(rec.disclaimer.includes('不构成投资建议'));
});

