import { valuationScore, industryCycleScore } from '../factors/valuation_cycle.js';

function clamp(v, lo = 0.01, hi = 0.99) {
  return Math.min(hi, Math.max(lo, v));
}

// 「值得买概率」= 研究用合成概率，不是投资建议，也不是已校准概率。
// 组合：真实 Walk-Forward 基准概率 + 估值 + 范蠡评分 + 历史回测 Sharpe - 风险惩罚。
export function computeWorthBuyingProbability({ probability, valuation, industry, fanli, backtest, risks = [] } = {}) {
  const base = probability?.latest_prediction?.P_positive_return ?? 0.5;
  const val = valuationScore(valuation) ?? 0.5;
  const cyc = industryCycleScore(industry) ?? 0.5;
  const fanliScore = Number.isFinite(fanli?.fanli_score) ? fanli.fanli_score / 10 : 0.5;
  const sharpe = Number.isFinite(backtest?.metrics?.sharpe) ? backtest.metrics.sharpe : 0;
  const riskPenalty = Math.min(0.15, risks.length * 0.02);

  const baseContrib = base;
  const valuationContrib = (val - 0.5) * 0.20;
  const industryContrib = (cyc - 0.5) * 0.10;
  const fanliContrib = (fanliScore - 0.5) * 0.20;
  const sharpeContrib = Math.max(-1, Math.min(2, sharpe)) * 0.03;
  const riskContrib = -riskPenalty;

  const components = {
    base_probability: { value: base, contribution: baseContrib, note: '真实 Walk-Forward 上涨概率基准' },
    valuation_score: { value: val, contribution: valuationContrib, note: '(估值分-0.5)×20%' },
    industry_cycle_score: { value: cyc, contribution: industryContrib, note: '(景气分-0.5)×10%' },
    fanli_score: { value: fanliScore, contribution: fanliContrib, note: '(范蠡分/10-0.5)×20%' },
    sharpe: { value: sharpe, contribution: sharpeContrib, note: 'Sharpe×3% (截断 -1~2)' },
    risk_penalty: { value: riskPenalty, contribution: riskContrib, note: '风险项数×2%，上限15%' }
  };

  const raw = baseContrib + valuationContrib + industryContrib + fanliContrib + sharpeContrib + riskContrib;
  const heuristicP = clamp(raw, 0.05, 0.95);
  const baseRate = probability?.aggregate?.base_rate;
  const brier = probability?.aggregate?.brier;
  const brierBaseline = Number.isFinite(baseRate) ? baseRate * (1 - baseRate) : null;
  const brierSkill = Number.isFinite(brier) && brierBaseline > 0 ? 1 - brier / brierBaseline : 0;
  // 用 Brier skill 收缩启发式调整：模型越可靠，越保留启发式调整；越不可靠，越回归基准概率。
  const calibrationWeight = Math.min(0.9, Math.max(0.2, 0.5 + brierSkill));
  const calibratedP = clamp(base + calibrationWeight * (heuristicP - base), 0.05, 0.95);

  const ci = probability?.latest_prediction?.confidence_interval;
  const lower = clamp(Math.min(ci?.[0] ?? calibratedP - 0.1, calibratedP - 0.05));
  const upper = clamp(Math.max(ci?.[1] ?? calibratedP + 0.1, calibratedP + 0.05));

  return {
    label: '值得买概率（校准后，研究用，非建议）',
    P_worth_buying: Number(calibratedP.toFixed(4)),
    P_worth_buying_heuristic: Number(heuristicP.toFixed(4)),
    confidence_interval: [Number(lower.toFixed(4)), Number(upper.toFixed(4))],
    sample_size: probability?.sample_size ?? 0,
    method: 'brier_skill_shrinkage_v1',
    calibrated: true,
    calibration: { brier, brier_baseline: brierBaseline, brier_skill: brierSkill, calibration_weight: calibrationWeight, base_probability: base, heuristic_probability: heuristicP },
    components,
    note: '校准基于真实 Walk-Forward 的 Brier skill 对启发式调整做收缩；仍为研究指标，不构成买入建议。'
  };
}


