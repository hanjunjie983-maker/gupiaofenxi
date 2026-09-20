import { FundDataConnector } from './fund_data.js';
import { computeFundAnalysis } from './fund_engine.js';
import { fetchFundUniverse, STATIC_FUND_UNIVERSE } from './fund_universe.js';
import { withHostHeaders } from '../ingest/base.js';

export const DEFAULT_FUNDS = STATIC_FUND_UNIVERSE.map((code) => ({ code, theme: null }));
const cache = new Map();
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BUDGET_MS = 25000;
const ANALYSIS_CONCURRENCY = 4;
const DAILY_CANDIDATES = 8;

// 带时间预算的并发执行：超过 deadline 后不再启动新任务，保证接口能在平台超时前返回结果。
async function mapLimit(items, limit, fn, { budgetMs = DEFAULT_BUDGET_MS, concurrency = limit } = {}) {
  const results = new Array(items.length);
  const deadline = Date.now() + budgetMs;
  let next = 0;
  async function worker() {
    while (next < items.length && Date.now() < deadline) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
        if (!results[i]) results[i] = { code: items[i], error: 'no_result' };
      } catch (err) {
        results[i] = { code: items[i], error: err.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency || limit, items.length) }, worker));
  return results;
}

// 分档同时看绝对分与当天相对名次，避免“行情偏冷时所有基金都是同一句话”。
export function fundAction({ finalScore = 0, fundScore = 0, relativePercentile = 0 } = {}) {
  if (finalScore >= 62 && fundScore >= 50) return '重点配置';
  if (finalScore >= 52) return '可分批配置';
  if (finalScore >= 44) return '持有观察';
  if (relativePercentile >= 0.65) return '相对靠前 / 谨慎观察';
  if (finalScore >= 36) return '谨慎观察';
  return '暂不配置';
}

function reasonFor(row, rank, count) {
  const parts = [];
  parts.push(`绝对评分 ${Number(row.fund_score || 0).toFixed(1)}，在今日 ${count} 只候选基金中排名第 ${rank}`);
  if (row.returns?.oneYear !== null && row.returns?.oneYear !== undefined) parts.push(`近一年 ${Number(row.returns.oneYear).toFixed(1)}%`);
  if (row.nav_metrics?.maxDrawdown !== null && row.nav_metrics?.maxDrawdown !== undefined) parts.push(`最大回撤 ${(row.nav_metrics.maxDrawdown * 100).toFixed(1)}%`);
  if (row.fund_score < 45) parts.push('绝对分仍偏低，建议等净值动量或持仓质量改善后再提高关注度');
  return parts.join('；');
}

async function analyzeFund(code, { store, config, fetchImpl, capital, riskLevel, maxHoldings }) {
  const connector = new FundDataConnector({ fetchImpl, userAgent: config?.edgarUserAgent });
  const data = await connector.run({ code });
  const analysis = await computeFundAnalysis({ fund: data, store, config, fetchImpl, capital, riskLevel, maxHoldings });
  return { ...analysis, theme: null };
}

export async function getFundDetail({ code, store, config, fetchImpl, capital = 1000000, riskLevel = 'balanced' }) {
  return analyzeFund(code, { store, config, fetchImpl, capital, riskLevel, maxHoldings: 3 });
}

export async function getDailyFundRanking({ store, config, fetchImpl, capital = 1000000, riskLevel = 'balanced', budgetMs = DEFAULT_BUDGET_MS } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `daily:${today}:${capital}:${riskLevel}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < DAY_MS) return { ...cached.value, cached: true };

  const universe = await fetchFundUniverse({ fetchImpl, limit: DAILY_CANDIDATES });
  const codes = universe.candidates.map((x) => x.code).slice(0, DAILY_CANDIDATES);
  const universeNames = new Map(universe.candidates.map((x) => [x.code, x.name]).filter(([, n]) => n));
  const results = await mapLimit(codes, 2, async (code) => {
    try { return await analyzeFund(code, { store, config, fetchImpl, capital, riskLevel, maxHoldings: 1 }); }
    catch (err) { return { code, name: code, error: err.message }; }
  }, { budgetMs, concurrency: ANALYSIS_CONCURRENCY });

  const valid = results.filter((x) => x && !x.error && Number.isFinite(x.fund_score)).sort((a, b) => b.fund_score - a.fund_score);
  const count = valid.length;
  const scored = valid.map((row, index) => {
    const relativePercentile = count <= 1 ? 1 : 1 - index / (count - 1);
    const finalScore = Number((0.75 * row.fund_score + 0.25 * relativePercentile * 100).toFixed(2));
    const name = row.name && row.name !== row.code ? row.name : (universeNames.get(row.code) || row.code);
    return {
      ...row,
      name,
      relative_rank: index + 1,
      candidate_count: count,
      relative_percentile: Number((relativePercentile * 100).toFixed(1)),
      final_score: finalScore,
      action_absolute: row.action,
      action: fundAction({ finalScore, fundScore: row.fund_score, relativePercentile }),
      recommendation_reason: reasonFor(row, index + 1, count)
    };
  }).sort((a, b) => b.final_score - a.final_score);

  const value = {
    date: today,
    universe_source: universe.source,
    universe_note: universe.source === 'eastmoney_fund_rank'
      ? '候选池来自东方财富公开基金排行（按近一年收益排序取前 40 名，再取前 10 只做完整分析）；排行每天更新，名单会变化。'
      : '基金排行接口暂时不可用，使用内置 ETF 研究池。',
    count: scored.length,
    results: scored,
    errors: results.filter((x) => x.error),
    note: '每日先按真实基金排行预筛，再结合前十大持仓股票分析做相对排名。绝对分与相对名次同时展示，不构成投资建议。'
  };
  cache.set(key, { at: Date.now(), value });
  return { ...value, cached: false };
}
