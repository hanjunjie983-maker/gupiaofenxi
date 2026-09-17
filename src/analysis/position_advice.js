function clamp(v, lo = 0, hi = 1) { return Math.min(hi, Math.max(lo, v)); }

const PROFILES = {
  conservative: { cap: 0.08, riskBudget: 0.01, label: '保守型' },
  balanced: { cap: 0.15, riskBudget: 0.02, label: '稳健型' },
  aggressive: { cap: 0.25, riskBudget: 0.04, label: '进取型' }
};

export function computePositionAdvice({ worth_buying = 0, fanli = null, risks = [], backtest = null, valuation = null, industry = null, capital = 1000000, riskLevel = 'balanced' } = {}) {
  const profile = PROFILES[riskLevel] || PROFILES.balanced;
  const p = Number.isFinite(worth_buying) ? worth_buying : 0;
  const dd = backtest?.metrics?.max_drawdown;
  const sharpe = backtest?.metrics?.sharpe;

  let base = clamp((p - 0.35) / 0.65);
  if (p < 0.4 || (Number.isFinite(sharpe) && sharpe < -0.5)) base = 0;
  if (Number.isFinite(dd) && dd < -0.20) base *= 0.7;
  base *= Math.max(0.5, 1 - risks.length * 0.1);

  const positionPct = clamp(base * profile.cap, 0, profile.cap);
  const amount = Math.round(capital * positionPct);
  const tranches = [
    { name: '首次建仓', pct: 0.5, amount: Math.round(amount * 0.5), note: '先建立一半底仓，避免一次性买在短期高点' },
    { name: '回撤加仓', pct: 0.3, amount: Math.round(amount * 0.3), note: '若价格回撤且基本面/景气未恶化，再投入 30%' },
    { name: '确认加仓', pct: 0.2, amount: Math.round(amount * 0.2), note: '若后续概率/景气改善，再投入剩余 20%' }
  ];

  const suggestion = p >= 0.65 && risks.length <= 1 ? '重点观察'
    : p >= 0.5 ? '关注'
    : p >= 0.4 ? '一般观察'
    : '谨慎观察';

  const stockType = classifyStock({ valuation, industry, fanli, backtest, risks });

  return {
    capital,
    risk_level: riskLevel,
    risk_profile: profile.label,
    suggestion,
    stock_type: stockType,
    suggested_position_pct: Number(positionPct.toFixed(4)),
    suggested_amount: amount,
    tranches,
    risk_budget_pct: profile.riskBudget,
    risk_budget_amount: Math.round(capital * profile.riskBudget),
    max_reference_loss: Math.round(amount * 0.10),
    reason: buildReason({ p, risks, backtest, valuation, industry }),
    disclaimer: '仓位建议仅为研究用风险管理模板，不构成投资建议，也不保证收益。'
  };
}

function classifyStock({ valuation, industry, fanli, backtest, risks }) {
  const pe = valuation?.pe;
  const pb = valuation?.pb;
  const cycle = industry?.cycle_score;
  const score = fanli?.fanli_score;
  const sharpe = backtest?.metrics?.sharpe;
  if (risks.length >= 3) return '高风险观察型';
  if (Number.isFinite(pe) && pe < 15 && Number.isFinite(pb) && pb < 2) return '低估值稳健型';
  if (Number.isFinite(score) && score >= 6) return '质量成长型';
  if (Number.isFinite(cycle) && cycle >= 0.6 && Number.isFinite(sharpe) && sharpe > 0) return '景气动量型';
  return '均衡观察型';
}

function buildReason({ p, risks, backtest, valuation, industry }) {
  const parts = [`值得买概率 ${(p * 100).toFixed(1)}%`];
  if (Number.isFinite(valuation?.pe)) parts.push(`PE ${valuation.pe}`);
  if (Number.isFinite(industry?.cycle_score)) parts.push(`行业景气 ${industry.cycle_score}`);
  if (Number.isFinite(backtest?.metrics?.sharpe)) parts.push(`历史夏普 ${backtest.metrics.sharpe.toFixed(2)}`);
  if (risks.length) parts.push(`风险 ${risks.length} 项`);
  return parts.join(' · ');
}
