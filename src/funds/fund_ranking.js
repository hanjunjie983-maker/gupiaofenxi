import { FundDataConnector } from './fund_data.js';
import { computeFundAnalysis } from './fund_engine.js';

export const DEFAULT_FUNDS = [
  { code: '510300', theme: '沪深300' },
  { code: '510500', theme: '中证500' },
  { code: '159915', theme: '创业板' },
  { code: '588000', theme: '科创50' },
  { code: '512880', theme: '证券' },
  { code: '512690', theme: '酒' },
  { code: '512170', theme: '医疗' },
  { code: '515030', theme: '新能源车' },
  { code: '512660', theme: '军工' },
  { code: '512480', theme: '半导体' }
];

const cache = new Map();
const DAY_MS = 24 * 60 * 60 * 1000;

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function analyzeFund(code, { store, config, fetchImpl, capital, riskLevel, maxHoldings }) {
  const connector = new FundDataConnector({ fetchImpl, userAgent: config?.edgarUserAgent });
  const data = await connector.run({ code });
  const analysis = await computeFundAnalysis({ fund: data, store, config, fetchImpl, capital, riskLevel, maxHoldings });
  return { ...analysis, holdings: analysis.holdings, theme: DEFAULT_FUNDS.find((f) => f.code === code)?.theme || null };
}

export async function getFundDetail({ code, store, config, fetchImpl, capital = 1000000, riskLevel = 'balanced' }) {
  return analyzeFund(code, { store, config, fetchImpl, capital, riskLevel, maxHoldings: 3 });
}

export async function getDailyFundRanking({ store, config, fetchImpl, capital = 1000000, riskLevel = 'balanced' } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `daily:${today}:${capital}:${riskLevel}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < DAY_MS) return { ...cached.value, cached: true };
  const results = await mapLimit(DEFAULT_FUNDS, 2, async (item) => {
    try { return await analyzeFund(item.code, { store, config, fetchImpl, capital, riskLevel, maxHoldings: 2 }); }
    catch (err) { return { code: item.code, name: item.code, theme: item.theme, error: err.message }; }
  });
  const valid = results.filter((x) => !x.error).sort((a, b) => (b.fund_score ?? -1) - (a.fund_score ?? -1));
  const value = { date: today, count: valid.length, results: valid, errors: results.filter((x) => x.error), note: '基金推荐基于公开持仓、基金净值与持仓股票分析，不构成投资建议。' };
  cache.set(key, { at: Date.now(), value });
  return { ...value, cached: false };
}
