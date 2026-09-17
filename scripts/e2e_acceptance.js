import { createServer } from '../src/http_server.js';
import { loadConfig } from '../src/config.js';
import { createMemoryStore } from '../src/store/memory.js';
import { mulberry32 } from '../src/probability/math.js';

// V20 端到端验收：数据→质检→因子→财报→范蠡→概率→回测→组合→仪表盘→前端→Agent 工具。
const facts = {
  entityName: 'Apple Inc.',
  facts: { 'us-gaap': {
    RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [{ form: '10-K', end: '2025-09-27', filed: '2025-10-31', val: 400000000000 }] } },
    NetIncomeLoss: { units: { USD: [{ form: '10-K', end: '2025-09-27', filed: '2025-10-31', val: 100000000000 }] } },
    StockholdersEquity: { units: { USD: [{ form: '10-K', end: '2025-09-27', filed: '2025-10-31', val: 60000000000 }] } },
    Assets: { units: { USD: [{ form: '10-K', end: '2025-09-27', filed: '2025-10-31', val: 360000000000 }] } },
    Liabilities: { units: { USD: [{ form: '10-K', end: '2025-09-27', filed: '2025-10-31', val: 300000000000 }] } },
    GrossProfit: { units: { USD: [{ form: '10-K', end: '2025-09-27', filed: '2025-10-31', val: 180000000000 }] } },
    NetCashProvidedByUsedInOperatingActivities: { units: { USD: [{ form: '10-K', end: '2025-09-27', filed: '2025-10-31', val: 120000000000 }] } },
    PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: [{ form: '10-K', end: '2025-09-27', filed: '2025-10-31', val: 10000000000 }] } }
  } }
};

const mockFetch = async (url) => {
  const body = String(url).includes('companyfacts') ? facts : { cik: '320193', name: 'Apple Inc.', tickers: ['AAPL'], filings: { recent: { form: ['10-K'], filingDate: ['2025-10-31'], reportDate: ['2025-09-27'], accessionNumber: ['0000320193-25-000001'] } } };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

const store = createMemoryStore();
for (let i = 0; i < 30; i++) {
  const close = 100 + i;
  store.savePriceRows([{ ticker: 'aapl', exchange: 'US', trade_date: `2026-08-${String(i + 1).padStart(2, '0')}`, open: close, high: close + 1, low: close - 1, close, preclose: close - 0.5, adj_close: close, volume: 1000000, amount: 1e9, turnover: 0.01, pct_chg: 1, tradestatus: '1', is_st: '0', adjustflag: '3' }]);
}

const config = loadConfig();
const server = createServer({ config, store, fetchImpl: mockFetch });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const steps = [];
const call = async (name, url, opts) => {
  const res = await fetch(`${base}${url}`, opts);
  const body = await res.json().catch(() => ({}));
  const ok = res.ok && (body.code === 0 || body.status === 'ok' || body.status === 'alive' || body.status === 'ready');
  steps.push({ name, status: res.status, ok });
  return { res, body };
};

try {
  await call('数据源目录', '/v1/sources');
  await call('质检规则', '/v1/quality/rules');
  await call('Baostock fixture 接入', '/v1/sources/baostock/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticker: 'sh.600519', mode: 'fixture' }) });
  await call('行情因子', '/v1/factors/compute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  await call('SEC 财报接入', '/v1/sources/sec-edgar-facts/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticker: 'AAPL', cik: '0000320193' }) });
  await call('范蠡六维 V2', '/v1/stocks/AAPL/fanli-v2');
  const assets = [];
  const rnd = mulberry32(20);
  for (let i = 0; i < 25; i++) assets.push({ ticker: `F${i}`, price_factors: { mom_20d: { zscore: rnd() * 4 - 2 }, vol_20d: { zscore: rnd() * 4 - 2 }, max_drawdown_60d: { zscore: rnd() * 4 - 2 } }, fundamentals: { roe: rnd(), gross_margin: rnd(), debt_ratio: rnd(), fcf_margin: rnd() }, source_url: 'e2e://synthetic' });
  await call('因子→概率', '/v1/probability/from-factors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assets, predict: [{ ticker: 'AAPL', price_factors: assets[0].price_factors, fundamentals: assets[0].fundamentals }], seed: 20 }) });
  await call('回测', '/v1/backtests/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tickers: 10, periods: 60, seed: 5 }) });
  await call('组合优化', '/v1/portfolio/optimize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tickers: 8, periods: 120, seed: 5 }) });
  await call('首页仪表盘', '/v1/dashboard/overview');
  await call('Agent 工具清单', '/v1/agent/tools');
  const home = await fetch(`${base}/`); steps.push({ name: '前端首页', status: home.status, ok: home.status === 200 });
  const stock = await fetch(`${base}/stock.html`); steps.push({ name: '前端个股页', status: stock.status, ok: stock.status === 200 });
  const report = { ok: steps.every((s) => s.ok), steps };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  server.close();
}

