import { analyzeTicker } from '../analysis/analyzer.js';
import { fetchStockUniverse, STATIC_FALLBACK_UNIVERSE, STATIC_FALLBACK_NAMES } from './stock_universe.js';

export const DEFAULT_WORTH_BUYING_TICKERS = STATIC_FALLBACK_UNIVERSE;
const cache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_BUDGET_MS = 30000;
const ANALYSIS_CONCURRENCY = 4;
const DAILY_CANDIDATES = 14;

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
        if (!results[i]) results[i] = { error: 'no_result' };
      } catch (err) {
        results[i] = { error: err.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency || limit, items.length) }, worker));
  return results;
}

// 建议分档同时看绝对分和相对名次：绝对分刻画“自身好不好”，相对名次刻画“今天在候选里排第几”。
export function recommendationFor({ finalScore = 0, smartScore = 0, relativePercentile = 0 } = {}) {
  if (finalScore >= 68 && smartScore >= 55) return '分批买入';
  if (finalScore >= 58) return '可分批建仓 / 重点关注';
  if (finalScore >= 48) return '持有观察';
  if (relativePercentile >= 0.65) return '相对靠前 / 谨慎观察';
  if (finalScore >= 38) return '谨慎观察';
  return '暂不买入 / 观望';
}

function reasonFor(row, relativeRank, candidateCount) {
  const parts = [];
  parts.push(`绝对评分 ${Number(row.smart_score || 0).toFixed(1)}，在今日 ${candidateCount} 只候选股中排名第 ${relativeRank}`);
  if (Number.isFinite(row.fanli_score)) parts.push(`范蠡六维 ${Number(row.fanli_score).toFixed(2)}/10`);
  if (Number.isFinite(row.P_worth_buying)) parts.push(`值得买概率 ${(row.P_worth_buying * 100).toFixed(1)}%`);
  if (row.risks?.length) parts.push(`风险项：${row.risks.slice(0, 3).join('、')}`);
  if (row.smart_score < 48) parts.push('绝对分仍偏低，建议等估值、概率或行业景气改善');
  return parts.join('；');
}

export async function getWorthBuyingRanking({ tickers, store, config, fetchImpl, budgetMs = DEFAULT_BUDGET_MS } = {}) {
  let source = 'provided';
  let list = [];
  const names = new Map();
  if (Array.isArray(tickers) && tickers.length) {
    list = [...new Set(tickers.map((t) => String(t).trim()).filter(Boolean))].slice(0, 12);
  } else {
    const universe = await fetchStockUniverse({ fetchImpl, limit: DAILY_CANDIDATES });
    source = universe.source;
    list = universe.candidates.map((x) => x.code);
    for (const c of universe.candidates) if (c.name) names.set(c.code, c.name);
  }
  if (!list.length) {
    list = DEFAULT_WORTH_BUYING_TICKERS.slice(0, 10);
    for (const code of list) names.set(code, STATIC_FALLBACK_NAMES[code] || code);
  }

  const key = `${source}:${list.join(',')}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return { ...cached.value, cached: true };

  const rows = await mapLimit(list, 2, async (ticker) => {
    const report = await analyzeTicker({ ticker, store, config, fetchImpl });
    const resolvedName = report.name && report.name !== report.ticker
      ? report.name
      : (names.get(ticker) || STATIC_FALLBACK_NAMES[ticker] || ticker);
    return {
      ticker: report.ticker,
      name: String(resolvedName).replace(/\s+/g, ''),
      price: report.price,
      P_worth_buying: report.worth_buying_probability?.P_worth_buying ?? null,
      P_worth_buying_heuristic: report.worth_buying_probability?.P_worth_buying_heuristic ?? null,
      calibrated: report.worth_buying_probability?.calibrated ?? false,
      calibration: report.worth_buying_probability?.calibration || null,
      confidence_interval: report.worth_buying_probability?.confidence_interval || null,
      fanli_score: report.fanli?.fanli_score ?? null,
      P_positive_return: report.probability?.latest_prediction?.P_positive_return ?? null,
      backtest_sharpe: report.backtest?.metrics?.sharpe ?? null,
      annualized_return: report.backtest?.metrics?.annualized_return ?? null,
      volatility: report.factors?.vol_20d?.raw ?? null,
      pe: report.valuation?.pe ?? null,
      roe: report.fundamentals?.metrics?.roe ?? null,
      roic: report.fundamentals?.metrics?.roic ?? null,
      gross_margin: report.fundamentals?.metrics?.gross_margin ?? null,
      pb: report.valuation?.pb ?? null,
      risks: report.risks || [],
      suggestion: report.position_advice?.suggestion || null,
      fanli_summary: report.fanli_summary || null,
      smart_action: report.smart_recommendation?.action || null,
      smart_score: report.smart_recommendation?.score ?? null,
      stock_type: report.position_advice?.stock_type || null,
      suggested_position_pct: report.position_advice?.suggested_position_pct ?? null,
      suggested_amount: report.position_advice?.suggested_amount ?? null,
      fund_holdings: report.fund_holdings ? { status: 'ok', report_date: report.fund_holdings.report_date, funds: report.fund_holdings.funds?.map((f) => ({ fund_name: f.fund_name, fund_company: f.fund_company, shares_ratio: f.shares_ratio })) || [] } : { status: 'data_missing' },
      as_of: report.as_of
    };
  }, { budgetMs, concurrency: ANALYSIS_CONCURRENCY });

  const base = rows.filter((r) => r && !r.error && Number.isFinite(r.smart_score)).sort((a, b) => b.smart_score - a.smart_score);
  const candidateCount = base.length;
  const results = base.map((row, index) => {
    const relativePercentile = candidateCount <= 1 ? 1 : 1 - index / (candidateCount - 1);
    const finalScore = Number((0.7 * row.smart_score + 0.3 * relativePercentile * 100).toFixed(2));
    return {
      ...row,
      relative_rank: index + 1,
      candidate_count: candidateCount,
      relative_percentile: Number((relativePercentile * 100).toFixed(1)),
      final_score: finalScore,
      smart_action_absolute: row.smart_action,
      smart_action: recommendationFor({ finalScore, smartScore: row.smart_score, relativePercentile }),
      recommendation_reason: reasonFor(row, index + 1, candidateCount)
    };
  }).sort((a, b) => b.final_score - a.final_score);

  const value = {
    as_of: new Date().toISOString().slice(0, 10),
    requested: list,
    universe_source: source,
    universe_note: source === 'eastmoney_clist'
      ? '候选池来自东方财富公开行情快照：先取全市场成交额与涨幅榜，再按流动性、规模、估值、动量预筛；前 8 名固定保留，其余名额按当天轮换，所以每天名单会变化。'
      : '行情快照接口暂时不可用，改用内置研究池（前 8 名固定，其余按当天轮换）。',
    count: results.length,
    results,
    errors: rows.filter((r) => r && r.error),
    note: '榜单先做全市场预筛，再做完整评分；绝对分与相对名次都会展示。概率不是保证，不构成投资建议。'
  };
  cache.set(key, { at: Date.now(), value });
  return { ...value, cached: false };
}

export async function getDailyRecommendations(args = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `daily:${today}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < 24 * 60 * 60 * 1000) return { ...cached.value, cached: true };
  const ranking = await getWorthBuyingRanking({ ...args, tickers: undefined });
  const value = {
    ...ranking,
    date: today,
    count: Math.min(10, ranking.results.length),
    results: ranking.results.slice(0, 10),
    title: '每日值得看十支（研究用排名）',
    note: `${ranking.universe_note}每日名单会随行情与轮换变化，不构成投资建议。`
  };
  cache.set(key, { at: Date.now(), value });
  return { ...value, cached: false };
}
