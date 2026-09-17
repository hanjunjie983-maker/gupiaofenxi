import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createMemoryStore } from '../src/store/memory.js';
import { mulberry32 } from '../src/probability/math.js';

// 前端/API 端到端 smoke：mock 财报 + 合成价格 + 因子概率，不访问外网。
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

const mockFetch = async () => new Response(JSON.stringify(facts), { status: 200, headers: { 'content-type': 'application/json' } });
const store = createMemoryStore();
for (let i = 0; i < 30; i++) {
  const close = 100 + i;
  store.savePriceRows([{ ticker: 'aapl', exchange: 'US', trade_date: `2026-08-${String(i + 1).padStart(2, '0')}`, open: close, high: close + 1, low: close - 1, close, preclose: close - 0.5, adj_close: close, volume: 1000000, amount: 1e9, turnover: 0.01, pct_chg: 1, tradestatus: '1', is_st: '0', adjustflag: '3' }]);
}

const config = loadConfig();
const server = createServer({ config, store, fetchImpl: mockFetch });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const j = async (url, opts) => (await fetch(`${base}${url}`, opts)).json();

try {
  await j('/v1/sources/sec-edgar-facts/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticker: 'AAPL', cik: '0000320193' }) });
  const assets = [];
  const rnd = mulberry32(9);
  for (let i = 0; i < 25; i++) {
    assets.push({ ticker: `F${i}`, price_factors: { mom_20d: { zscore: rnd() * 4 - 2 }, vol_20d: { zscore: rnd() * 4 - 2 }, max_drawdown_60d: { zscore: rnd() * 4 - 2 } }, fundamentals: { roe: rnd(), gross_margin: rnd(), debt_ratio: rnd(), fcf_margin: rnd() }, source_url: 'smoke://synthetic' });
  }
  await j('/v1/probability/from-factors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assets, predict: [{ ticker: 'AAPL', price_factors: assets[0].price_factors, fundamentals: assets[0].fundamentals }], seed: 9 }) });
  const [fanli, fundamentals, factorTable, probability, stockHtml, stockJs] = await Promise.all([
    j('/v1/stocks/AAPL/fanli-v2'), j('/v1/stocks/AAPL/fundamentals'), j('/v1/stocks/AAPL/factor-table'), j('/v1/stocks/AAPL/probability-v2'), fetch(`${base}/stock.html`).then((r) => r.text()), fetch(`${base}/js/stock.js`).then((r) => r.text())
  ]);
  const report = {
    ok: fanli.code === 0 && fundamentals.code === 0 && factorTable.code === 0 && probability.code === 0 && stockHtml.includes('范蠡六维 V2') && stockJs.includes('/probability-v2'),
    fanli_status: fanli.data.fanli.status,
    fundamentals_period: fundamentals.data.period_end,
    factor_table_factors: Object.keys(factorTable.data.factors).length,
    probability_positive: probability.data.P_positive_return,
    stock_page_ok: stockHtml.includes('个股研究')
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  server.close();
}
