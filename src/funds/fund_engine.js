import { analyzeTicker } from '../analysis/analyzer.js';
import { std } from '../probability/math.js';
import { valuationScore } from '../factors/valuation_cycle.js';

function clamp(v, lo = 0, hi = 100) { return Math.min(hi, Math.max(lo, v)); }

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { results[i] = await fn(items[i], i); } catch (err) { results[i] = { error: err.message, item: items[i] }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function navMetrics(trend = []) {
  const values = trend.map((x) => Number(x.y)).filter(Number.isFinite);
  if (values.length < 20) return { volatility: null, maxDrawdown: null, periods: values.length };
  const rets = values.slice(1).map((v, i) => v / values[i] - 1);
  const volatility = (std(rets.slice(-250)) ?? 0) * Math.sqrt(252);
  let peak = values[0];
  let dd = 0;
  for (const v of values) { if (v > peak) peak = v; dd = Math.min(dd, v / peak - 1); }
  return { volatility, maxDrawdown: dd, periods: values.length };
}

function momentumScore(returns = {}) {
  const parts = [];
  if (Number.isFinite(returns.oneYear)) parts.push([returns.oneYear, 0.4]);
  if (Number.isFinite(returns.sixMonth)) parts.push([returns.sixMonth, 0.3]);
  if (Number.isFinite(returns.threeMonth)) parts.push([returns.threeMonth, 0.2]);
  if (Number.isFinite(returns.oneMonth)) parts.push([returns.oneMonth, 0.1]);
  if (!parts.length) return 50;
  const weighted = parts.reduce((s, [r, w]) => s + clamp(50 + r * 1.5) * w, 0);
  const weight = parts.reduce((s, [, w]) => s + w, 0);
  return weighted / weight;
}

function managerScore(manager) {
  if (!Array.isArray(manager) || !manager.length) return 60;
  const years = manager.map((m) => Number(m.workTime) || 0).sort((a, b) => b - a)[0] || 0;
  return clamp(55 + Math.min(35, years * 5));
}

function aggregateHoldings(holdings, analyses) {
  const valid = analyses.filter((x) => x && !x.error && x.report);
  if (!valid.length) return null;
  const wsum = valid.reduce((s, x) => s + (x.holding.weight || 0), 0) || 1;
  const weighted = (pick) => valid.reduce((s, x) => {
    const v = pick(x);
    return s + (Number.isFinite(v) ? v : 0) * (x.holding.weight || 0);
  }, 0) / wsum;
  const scoreOf = (v) => Number.isFinite(v) ? v : null;
  return {
    score: weighted((x) => scoreOf(x.report.smart_recommendation?.score) ?? scoreOf(x.report.worth_buying_probability?.P_worth_buying * 100) ?? 50),
    fanli: weighted((x) => scoreOf(x.report.fanli?.fanli_score * 10) ?? 50),
    quality: weighted((x) => scoreOf(x.report.fanli?.dimensions?.['完物质量']?.score * 10) ?? 50),
    turnover: weighted((x) => scoreOf(x.report.fanli?.dimensions?.['无息币周转']?.score * 10) ?? 50),
    valuation: weighted((x) => {
      const v = valuationScore(x.report.valuation);
      return Number.isFinite(v) ? v * 100 : 50;
    }),
    risk: weighted((x) => scoreOf(x.report.fanli?.dimensions?.['修备风控']?.score * 10) ?? 50)
  };
}

export async function computeFundAnalysis({ fund, store, config, fetchImpl, capital = 1000000, riskLevel = 'balanced', maxHoldings = 3 } = {}) {
  const top = (fund.holdings || []).slice(0, maxHoldings);
  const analyses = await mapLimit(top, 2, async (holding) => {
    const report = await analyzeTicker({ ticker: holding.code, store, config, fetchImpl, capital, riskLevel });
    return { holding, report };
  });

  const agg = aggregateHoldings(top, analyses);
  const nav = navMetrics(fund.net_worth_trend || []);
  const mom = momentumScore(fund.returns || {});
  const mgr = managerScore(fund.manager);
  // 风险曲线按“股混基金正常波动区间”标定：年化波动 15% 以内、回撤 20% 以内不扣分，
  // 超出部分按比例扣分，避免正常波动的基金一律被打到 0 分。
  const volExcess = Math.max(0, (nav.volatility ?? 0.20) - 0.15);
  const ddExcess = Math.max(0, Math.abs(nav.maxDrawdown ?? -0.15) - 0.20);
  const riskScore = clamp(100 - volExcess * 120 - ddExcess * 100);
  const holdingsScore = agg?.score ?? 50;
  const fundScore = Number((holdingsScore * 0.5 + mom * 0.25 + riskScore * 0.15 + mgr * 0.10).toFixed(2));

  let action = '暂不配置';
  if (fundScore >= 70) action = '重点配置';
  else if (fundScore >= 58) action = '可分批配置';
  else if (fundScore >= 45) action = '持有观察';
  else if (fundScore >= 33) action = '谨慎观察';

  const profileCap = riskLevel === 'conservative' ? 0.08 : riskLevel === 'aggressive' ? 0.25 : 0.15;
  const positionPct = clamp((fundScore - 35) / 50, 0, 1) * profileCap;
  const amount = Math.round(capital * positionPct);

  const holdingDetails = analyses.map((x, i) => ({
    code: top[i]?.code,
    name: top[i]?.name,
    weight: top[i]?.weight,
    action: x?.report?.smart_recommendation?.action || null,
    score: x?.report?.smart_recommendation?.score ?? null,
    fanli_score: x?.report?.fanli?.fanli_score ?? null,
    worth_buying: x?.report?.worth_buying_probability?.P_worth_buying ?? null,
    error: x?.error || null
  }));

  const fanli = {
    待乏需求: { score: Number((mom / 10).toFixed(2)), note: '基金久期收益动量' },
    贵贱估值: { score: Number(((agg?.valuation ?? 50) / 10).toFixed(2)), note: '前十大持仓加权 PE/PB' },
    完物质量: { score: Number(((agg?.quality ?? 50) / 10).toFixed(2)), note: '持仓股票质量加权' },
    无息币周转: { score: Number(((agg?.turnover ?? 50) / 10).toFixed(2)), note: '持仓股票周转加权' },
    择人任时: { score: Number(((mom * 0.7 + mgr * 0.3) / 10).toFixed(2)), note: '基金动量 + 经理年限' },
    修备风控: { score: Number(((riskScore * 0.6 + (agg?.risk ?? 50) * 0.4) / 10).toFixed(2)), note: '净值波动/回撤 + 持仓风险' }
  };

  const topHoldingNames = (fund.holdings || []).slice(0, 3).map((h) => h.name).filter(Boolean).join('、');
  return {
    code: fund.code,
    name: fund.name,
    plain_summary: `${fund.name} 主要买的是 ${topHoldingNames || '公开披露的持仓股票'}；综合评分 ${fundScore}/100，建议是“${action}”。基金评分越高只代表研究模型越看好，不代表一定赚钱。`,
    as_of: new Date().toISOString().slice(0, 10),
    fund_score: fundScore,
    action,
    position_suggestion: { position_pct: Number(positionPct.toFixed(4)), amount, capital, risk_level: riskLevel },
    returns: fund.returns,
    nav_metrics: nav,
    holdings_report_date: fund.holdings_report_date,
    holdings: holdingDetails,
    fanli,
    recommendation_reason: `近一年收益 ${fund.returns?.oneYear ?? '—'}%，净值波动 ${nav.volatility === null ? '—' : (nav.volatility * 100).toFixed(1) + '%'}，最大回撤 ${nav.maxDrawdown === null ? '—' : (nav.maxDrawdown * 100).toFixed(1) + '%'}；持仓股票平均智能分 ${holdingsScore.toFixed(1)}，因此建议“${action}”。`,
    reasons: [
      `基金综合评分 ${fundScore}/100`,
      `基金动量 ${mom.toFixed(1)}/100`,
      `风险评分 ${riskScore.toFixed(1)}/100`,
      `前十大持仓分析 ${holdingDetails.filter((x) => x.score !== null).length}/${holdingDetails.length} 只`
    ],
    warnings: [
      '基金分析基于前十大公开持仓与净值历史，持仓可能滞后。',
      '基金评分是研究模型输出，不构成投资建议。'
    ],
    sources: [{ url: fund.source_url, retrieved_at: fund.retrieved_at, confidence: fund.confidence }],
    disclaimer: '基金评分与推荐为研究模型输出，不构成投资建议，不承诺收益。'
  };
}



