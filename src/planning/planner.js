import { mulberry32, mean, std, quantile } from '../probability/math.js';
import { getWorthBuyingRanking } from '../rankings/worth_buying_ranking.js';
import { getDailyFundRanking } from '../funds/fund_ranking.js';

export const RISK_PROFILES = {
  conservative: { label: '保守型', stock: 0.30, fund: 0.50, cash: 0.20, maxSingleStock: 0.05, maxSingleFund: 0.15 },
  balanced: { label: '稳健型', stock: 0.45, fund: 0.40, cash: 0.15, maxSingleStock: 0.08, maxSingleFund: 0.18 },
  aggressive: { label: '进取型', stock: 0.65, fund: 0.25, cash: 0.10, maxSingleStock: 0.12, maxSingleFund: 0.20 }
};

// 分批建仓比例：先建 40%，确认后再补 30% / 30%，避免一次性买在高点。
export const TRANCHE_PLAN = [0.4, 0.3, 0.3];

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

export function allocateSleeves({ capital, riskLevel = 'balanced', stocks = [], funds = [] }) {
  const profile = RISK_PROFILES[riskLevel] || RISK_PROFILES.balanced;
  const stockBudget = capital * profile.stock;
  const fundBudget = capital * profile.fund;

  const stockScores = stocks.slice(0, 10).map((s) => s.final_score ?? s.smart_score ?? (Number.isFinite(s.P_worth_buying) ? s.P_worth_buying * 100 : null) ?? 50);
  const fundScores = funds.slice(0, 8).map((f) => f.final_score ?? f.fund_score ?? 50);
  const stockSum = stockScores.reduce((a, b) => a + b, 0) || 1;
  const fundSum = fundScores.reduce((a, b) => a + b, 0) || 1;

  const stockAlloc = stocks.slice(0, 10).map((s, i) => ({
    ticker: s.ticker,
    name: s.name,
    score: s.final_score ?? s.smart_score ?? null,
    action: s.smart_action || s.action || null,
    relative_rank: s.relative_rank ?? null,
    weight: (stockScores[i] / stockSum) * profile.stock,
    amount: Math.round((stockScores[i] / stockSum) * stockBudget)
  }));
  const fundAlloc = funds.slice(0, 8).map((f, i) => ({
    code: f.code,
    name: f.name,
    score: f.final_score ?? f.fund_score ?? null,
    action: f.action || null,
    relative_rank: f.relative_rank ?? null,
    weight: (fundScores[i] / fundSum) * profile.fund,
    amount: Math.round((fundScores[i] / fundSum) * fundBudget)
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

// 把资金拆成三笔的建仓时间表（金额同样按比例拆分，不预测价格）。
export function buildBuyPlan({ capital, stockAmount, fundAmount, horizonMonths = 12, now = new Date() }) {
  const investable = stockAmount + fundAmount;
  const offsets = [1, 30, 60];
  const notes = [
    '首笔建仓：先投入 40% 的可投资金，避免一次性买在高点。',
    '第二笔：若基本面、估值或行业景气未恶化，再投入 30%。',
    '第三笔：完成剩余 30%，之后进入定期复盘与再平衡。'
  ];
  const rows = TRANCHE_PLAN.map((ratio, i) => ({
    step: i + 1,
    date: new Date(now.getTime() + offsets[i] * 86400000).toISOString().slice(0, 10),
    ratio,
    amount: Math.round(investable * ratio),
    stock_amount: Math.round(stockAmount * ratio),
    fund_amount: Math.round(fundAmount * ratio),
    note: notes[i]
  }));
  rows.push({
    step: 4,
    date: new Date(now.getTime() + 90 * 86400000).toISOString().slice(0, 10),
    ratio: 0,
    amount: 0,
    stock_amount: 0,
    fund_amount: 0,
    note: `第 4 步起每 3 个月复盘一次，最长跟踪 ${horizonMonths} 个月；只在条件变化时买卖，不按固定日预测价格。`
  });
  return { investable_amount: Math.round(investable), tranches: rows };
}

export function buildSellRules({ maxDrawdown = 0.15 } = {}) {
  const dd = Math.round(maxDrawdown * 100);
  return [
    { condition: '基本面恶化（ROIC、现金流或毛利率连续两期明显下滑）', action: '先减半仓，重新做完整分析' },
    { condition: '行业景气度跌破 0.35 或政策/需求逻辑反转', action: '降低该行业权重，把仓位换到更稳的品种' },
    { condition: `组合回撤接近 ${dd}%（本轮设定的最大回撤）`, action: '减仓到计划最低仓位，保留现金等更好的赔率' },
    { condition: '估值分位升到历史高位且盈利预期不再上调', action: '分批止盈，不追求卖在最高点' },
    { condition: '出现风险项 >= 3 个（如流动性差、财报临近、质押偏高）', action: '暂停加仓，等风险落地再评估' },
    { condition: '资金用途变化或投资期限缩短', action: '优先降低波动，而不是追求收益' }
  ];
}

const planCache = new Map();

export async function generateUnifiedPlan({ store, config, fetchImpl, capital = 1000000, riskLevel = 'balanced', horizonMonths = 12, maxDrawdown = 0.15, budgetMs } = {}) {
  const cacheKey = `${capital}:${riskLevel}:${horizonMonths}:${maxDrawdown}`;
  const cached = planCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return { ...cached.value, cached: true };

  const [stockRanking, fundRanking] = await Promise.all([
    getWorthBuyingRanking({ store, config, fetchImpl, budgetMs: budgetMs ?? 30000 }),
    getDailyFundRanking({ store, config, fetchImpl, capital, riskLevel, budgetMs: budgetMs ?? 25000 })
  ]);

  const allocation = allocateSleeves({ capital, riskLevel, stocks: stockRanking.results, funds: fundRanking.results });
  const stockByTicker = new Map(stockRanking.results.map((r) => [r.ticker, r]));
  const fundByCode = new Map(fundRanking.results.map((r) => [r.code, r]));

  // 情景模拟直接复用榜单里的真实统计量，避免重复抓取导致接口超时。
  const assets = [];
  for (const row of allocation.stocks) {
    const src = stockByTicker.get(row.ticker) || {};
    assets.push({
      ticker: row.ticker,
      name: row.name,
      weight: row.weight,
      amount: row.amount,
      expectedAnnualReturn: clamp(Number.isFinite(src.annualized_return) ? src.annualized_return : 0.05, -0.20, 0.30),
      annualVolatility: clamp(Number.isFinite(src.volatility) ? src.volatility : 0.30, 0.12, 0.80)
    });
  }
  for (const row of allocation.funds) {
    const src = fundByCode.get(row.code) || {};
    const oneYear = Number(src.returns?.oneYear);
    assets.push({
      code: row.code,
      name: row.name,
      weight: row.weight,
      amount: row.amount,
      expectedAnnualReturn: clamp(Number.isFinite(oneYear) ? oneYear / 100 : 0.05, -0.20, 0.30),
      annualVolatility: clamp(Number.isFinite(src.nav_metrics?.volatility) ? src.nav_metrics.volatility : 0.20, 0.08, 0.60)
    });
  }

  const simulation = simulatePlan({ assets, capital, horizonMonths });
  const schedule = buildSchedule({ horizonMonths });
  const stockAmount = allocation.stocks.reduce((s, x) => s + x.amount, 0);
  const fundAmount = allocation.funds.reduce((s, x) => s + x.amount, 0);
  const buyPlan = buildBuyPlan({ capital, stockAmount, fundAmount, horizonMonths });
  const sellRules = buildSellRules({ maxDrawdown });

  const selectedStocks = allocation.stocks.map((row) => {
    const src = stockByTicker.get(row.ticker) || {};
    return {
      ticker: row.ticker,
      name: row.name,
      action: src.smart_action || row.action,
      absolute_action: src.smart_action_absolute || null,
      why_not_absolute: src.smart_action_absolute && src.smart_action_absolute !== src.smart_action
        ? `绝对评分对应的原始结论是“${src.smart_action_absolute}”，进入今日相对排名后调整为“${src.smart_action}”。`
        : null,
      score: row.score,
      final_score: src.final_score ?? null,
      relative_rank: src.relative_rank ?? row.relative_rank,
      candidate_count: src.candidate_count ?? null,
      P_worth_buying: src.P_worth_buying ?? null,
      fanli_score: src.fanli_score ?? null,
      price: src.price ?? null,
      risks: src.risks || [],
      reason: src.recommendation_reason || null,
      weight: row.weight,
      amount: row.amount
    };
  });
  const selectedFunds = allocation.funds.map((row) => {
    const src = fundByCode.get(row.code) || {};
    return {
      code: row.code,
      name: row.name,
      action: src.action || row.action,
      absolute_action: src.action_absolute || null,
      score: row.score,
      final_score: src.final_score ?? null,
      relative_rank: src.relative_rank ?? row.relative_rank,
      candidate_count: src.candidate_count ?? null,
      one_year_return: src.returns?.oneYear ?? null,
      max_drawdown: src.nav_metrics?.maxDrawdown ?? null,
      reason: src.recommendation_reason || null,
      weight: row.weight,
      amount: row.amount
    };
  });

  const plan = {
    as_of: new Date().toISOString().slice(0, 10),
    plain_summary: `按你的资金和风险偏好，建议股票约 ${Math.round(allocation.allocation.stock_weight * 100)}%、基金约 ${Math.round(allocation.allocation.fund_weight * 100)}%、现金约 ${Math.round(allocation.allocation.cash_weight * 100)}%。分三笔建仓，单笔金额见“分批建仓时间表”；未来金额是概率区间，不是保证收益，也不是某一天一定到某个价格。`,
    capital,
    risk_level: riskLevel,
    risk_profile_label: allocation.profile,
    horizon_months: horizonMonths,
    max_drawdown_limit: maxDrawdown,
    allocation,
    buy_plan: buyPlan,
    selected_stocks: selectedStocks,
    selected_funds: selectedFunds,
    sell_rules: sellRules,
    simulation,
    schedule,
    data_sources: {
      stock_universe: stockRanking.universe_source,
      stock_universe_note: stockRanking.universe_note,
      fund_universe: fundRanking.universe_source,
      fund_universe_note: fundRanking.universe_note
    },
    warnings: [
      '本规划是研究模型输出，不构成投资建议。',
      '未来收益与回撤均为概率分布，不是确定预测，无法预知某一天的具体价格。',
      '实际执行需考虑税费、滑点、流动性与个人情况。',
      '名单每天会变化，建议按时间表复盘，而不是按单一日的结论长期不动。'
    ],
    disclaimer: '本统一投资规划中心仅用于研究与风险管理，不承诺收益，不保证精准，不替代持牌投资顾问。'
  };
  planCache.set(cacheKey, { at: Date.now(), value: plan });
  return { ...plan, cached: false };
}
