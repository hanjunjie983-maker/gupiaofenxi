import { mulberry32, mean, std, quantile } from '../probability/math.js';
import { getWorthBuyingRanking } from '../rankings/worth_buying_ranking.js';
import { getDailyFundRanking, getFundDetail } from '../funds/fund_ranking.js';
import { analyzeTicker } from '../analysis/analyzer.js';

export const RISK_PROFILES = {
  conservative: { label: '保守型', stock: 0.30, fund: 0.50, cash: 0.20, maxSingleStock: 0.05, maxSingleFund: 0.15 },
  balanced: { label: '稳健型', stock: 0.45, fund: 0.40, cash: 0.15, maxSingleStock: 0.08, maxSingleFund: 0.18 },
  aggressive: { label: '进取型', stock: 0.65, fund: 0.25, cash: 0.10, maxSingleStock: 0.12, maxSingleFund: 0.20 }
};

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

export function allocateSleeves({ capital, riskLevel = 'balanced', stocks = [], funds = [] }) {
  const profile = RISK_PROFILES[riskLevel] || RISK_PROFILES.balanced;
  const stockBudget = capital * profile.stock;
  const fundBudget = capital * profile.fund;
  const cash = capital * profile.cash;

  const stockScores = stocks.slice(0, 10).map((s) => s.smart_score ?? s.P_worth_buying * 100 ?? 50);
  const fundScores = funds.slice(0, 8).map((f) => f.fund_score ?? 50);
  const stockSum = stockScores.reduce((a, b) => a + b, 0) || 1;
  const fundSum = fundScores.reduce((a, b) => a + b, 0) || 1;

  const stockAlloc = stocks.slice(0, 10).map((s, i) => ({
    ticker: s.ticker, name: s.name, score: s.smart_score ?? null, weight: (stockScores[i] / stockSum) * profile.stock, amount: Math.round((stockScores[i] / stockSum) * stockBudget)
  }));
  const fundAlloc = funds.slice(0, 8).map((f, i) => ({
    code: f.code, name: f.name, score: f.fund_score ?? null, weight: (fundScores[i] / fundSum) * profile.fund, amount: Math.round((fundScores[i] / fundSum) * fundBudget)
  }));

  // 单标的上限后重新归一化
  const capSleeve = (rows, cap) => {
    let changed = true;
    const out = rows.map((r) => ({ ...r }));
    while (changed) {
      changed = false;
      const over = out.filter((r) => r.weight > cap);
      if (!over.length) break;
      let excess = 0;
      for (const r of over) { excess += r.weight - cap; r.weight = cap; }
      const under = out.filter((r) => r.weight < cap);
      const sum = under.reduce((s, r) => s + r.weight, 0) || 1;
      for (const r of under) r.weight += excess * (r.weight / sum);
      changed = true;
    }
    for (const r of out) r.amount = Math.round(capital * r.weight);
    return out;
  };

  const stockRows = capSleeve(stockAlloc, profile.maxSingleStock);
  const fundRows = capSleeve(fundAlloc, profile.maxSingleFund);
  const riskyAmount = stockRows.reduce((s, x) => s + x.amount, 0) + fundRows.reduce((s, x) => s + x.amount, 0);
  const cashAmount = Math.max(0, capital - riskyAmount);
  return {
    profile: profile.label,
    allocation: {
      stock_weight: Number((stockRows.reduce((s, x) => s + x.amount, 0) / capital).toFixed(4)),
      fund_weight: Number((fundRows.reduce((s, x) => s + x.amount, 0) / capital).toFixed(4)),
      cash_weight: Number((cashAmount / capital).toFixed(4))
    },
    stocks: stockRows,
    funds: fundRows,
    cash: { weight: Number((cashAmount / capital).toFixed(4)), amount: cashAmount }
  };
}

export function simulatePlan({ assets, capital, horizonMonths = 12, simulations = 2000, seed = 42 }) {
  const rnd = mulberry32(seed);
  const paths = [];
  const maxDrawdowns = [];
  const monthlyWeighted = assets.map((a) => ({
    weight: a.weight,
    monthlyReturn: clamp((a.expectedAnnualReturn ?? 0.05) / 12, -0.05, 0.08),
    monthlyVol: clamp((a.annualVolatility ?? 0.2) / Math.sqrt(12), 0.005, 0.25)
  }));

  for (let s = 0; s < simulations; s++) {
    let value = capital;
    let peak = capital;
    let maxDd = 0;
    for (let m = 0; m < horizonMonths; m++) {
      const market = (rnd() - 0.5) * 3.464;
      let port = 0;
      for (const a of monthlyWeighted) {
        const idio = (rnd() - 0.5) * 3.464;
        const z = 0.6 * market + 0.8 * idio;
        port += a.weight * (a.monthlyReturn + a.monthlyVol * z);
      }
      value *= (1 + clamp(port, -0.5, 0.5));
      peak = Math.max(peak, value);
      maxDd = Math.min(maxDd, value / peak - 1);
    }
    paths.push(value);
    maxDrawdowns.push(maxDd);
  }

  const q = (p) => quantile(paths, p);
  return {
    simulations,
    horizon_months: horizonMonths,
    percentiles: { p05: q(0.05), p25: q(0.25), p50: q(0.50), p75: q(0.75), p95: q(0.95) },
    scenarios: {
      pessimistic: { probability: 0.20, range: [q(0.05), q(0.25)] },
      neutral: { probability: 0.50, range: [q(0.25), q(0.75)] },
      optimistic: { probability: 0.20, range: [q(0.75), q(0.95)] }
    },
    risk: {
      probability_of_loss: paths.filter((v) => v < capital).length / simulations,
      median_max_drawdown: quantile(maxDrawdowns, 0.50),
      p05_max_drawdown: quantile(maxDrawdowns, 0.05),
      var_95: capital - q(0.05),
      cvar_95: capital - mean(paths.filter((v) => v <= q(0.05)))
    },
    disclaimer: '以上为蒙特卡洛情景模拟，不是未来预测，不保证收益，也不保证最大回撤。'
  };
}

export function buildSchedule({ horizonMonths = 12, now = new Date() }) {
  const schedule = [];
  const add = (offsetDays, action, note) => {
    const d = new Date(now.getTime() + offsetDays * 86400000);
    schedule.push({ date: d.toISOString().slice(0, 10), action, note });
  };
  add(1, '首次建仓', '按计划分批买入，不一次性满仓。');
  add(30, '第一次复盘', '检查基本面、估值、行业景气是否变化。');
  add(90, '季度再平衡', '偏离目标权重超过 5% 时再平衡。');
  for (let m = 6; m <= horizonMonths; m += 3) add(m * 30, '定期复盘', '更新概率、风险和仓位；不预测单一价格。');
  return schedule;
}

const planCache = new Map();

export async function generateUnifiedPlan({ store, config, fetchImpl, capital = 1000000, riskLevel = 'balanced', horizonMonths = 12, maxDrawdown = 0.15 }) {
  const cacheKey = `${capital}:${riskLevel}:${horizonMonths}:${maxDrawdown}`;
  const cached = planCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return { ...cached.value, cached: true };
  const [stockRanking, fundRanking] = await Promise.all([
    getWorthBuyingRanking({ store, config, fetchImpl }),
    getDailyFundRanking({ store, config, fetchImpl, capital, riskLevel })
  ]);

  const topStocks = stockRanking.results.slice(0, 4);
  const topFunds = fundRanking.results.slice(0, 3);
  const stockDetails = await Promise.all(topStocks.map(async (s) => {
    try { return await analyzeTicker({ ticker: s.ticker, store, config, fetchImpl, capital, riskLevel }); }
    catch { return null; }
  }));
  const fundDetails = await Promise.all(topFunds.map(async (f) => {
    try { return await getFundDetail({ code: f.code, store, config, fetchImpl, capital, riskLevel }); }
    catch { return null; }
  }));

  const assets = [];
  for (const d of stockDetails.filter(Boolean)) {
    const vol = d.factors?.vol_20d?.raw ?? 0.30;
    const expected = d.backtest?.metrics?.annualized_return ?? 0.05;
    assets.push({ ticker: d.ticker, name: d.name, weight: 0, expectedAnnualReturn: clamp(expected, -0.20, 0.30), annualVolatility: clamp(vol, 0.12, 0.80) });
  }
  for (const d of fundDetails.filter(Boolean)) {
    const vol = d.nav_metrics?.volatility ?? 0.20;
    const expected = (d.returns?.oneYear ?? 5) / 100;
    assets.push({ code: d.code, name: d.name, weight: 0, expectedAnnualReturn: clamp(expected, -0.20, 0.30), annualVolatility: clamp(vol, 0.08, 0.60) });
  }

  const allocation = allocateSleeves({ capital, riskLevel, stocks: stockRanking.results, funds: fundRanking.results });
  const assetMap = new Map(assets.map((a) => [a.ticker || a.code, a]));
  for (const a of [...allocation.stocks, ...allocation.funds]) {
    const key = a.ticker || a.code;
    const hit = assetMap.get(key);
    if (hit) { hit.weight = a.weight; hit.amount = a.amount; }
  }

  const simulation = simulatePlan({ assets, capital, horizonMonths });
  const schedule = buildSchedule({ horizonMonths });

  const plan = {
    as_of: new Date().toISOString().slice(0, 10),
    plain_summary: `按你的资金和风险偏好，建议股票约 ${Math.round(allocation.allocation.stock_weight * 100)}%、基金约 ${Math.round(allocation.allocation.fund_weight * 100)}%、现金约 ${Math.round(allocation.allocation.cash_weight * 100)}%。未来金额是概率区间，不是保证收益，也不是某一天一定到某个价格。`,
    capital,
    risk_level: riskLevel,
    horizon_months: horizonMonths,
    max_drawdown_limit: maxDrawdown,
    allocation,
    selected_stocks: stockDetails.filter(Boolean).map((d) => ({ ticker: d.ticker, name: d.name, action: d.smart_recommendation?.action, score: d.smart_recommendation?.score, position: allocation.stocks.find((x) => x.ticker === d.ticker) })),
    selected_funds: fundDetails.filter(Boolean).map((d) => ({ code: d.code, name: d.name, action: d.action, score: d.fund_score, position: allocation.funds.find((x) => x.code === d.code) })),
    simulation,
    schedule,
    warnings: ['本规划是研究模型输出，不构成投资建议。', '未来收益与回撤均为概率分布，不是确定预测。', '实际执行需考虑税费、滑点、流动性与个人情况。'],
    disclaimer: '本统一投资规划中心仅用于研究与风险管理，不承诺收益，不保证精准，不替代持牌投资顾问。'
  };
  planCache.set(cacheKey, { at: Date.now(), value: plan });
  return { ...plan, cached: false };
}





