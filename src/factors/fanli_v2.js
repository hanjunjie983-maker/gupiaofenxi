import { FANLI_WEIGHTS } from './fanli.js';

function clamp(v, lo = 0, hi = 10) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  return Math.min(hi, Math.max(lo, Number(v)));
}

function avg(values) {
  const f = values.filter((v) => Number.isFinite(v));
  return f.length ? f.reduce((a, b) => a + b, 0) / f.length : null;
}

function zToScore(z, direction = 1) {
  if (z === null || z === undefined || !Number.isFinite(Number(z))) return null;
  const p = 1 / (1 + Math.exp(-Number(z)));
  return direction === 1 ? p * 10 : (1 - p) * 10;
}

function dim(score, method, confidence = 1, note = '') {
  if (score === null || score === undefined) {
    return { score: 5, status: 'estimated', estimated: true, confidence: 0.3, method: 'neutral_fallback', note: note || '公开数据不足，暂用中性分 5，不代表真实好坏。' };
  }
  return { score: Number(score.toFixed(4)), status: 'computed', estimated: false, confidence, method, note };
}

export function computeFanliV2({ price = {}, fundamentals = {}, valuation = null, cycle = null } = {}) {
  // 1) 完物质量：ROE/ROIC/毛利率/负债率/FCF/经营现金流
  const roeScore = clamp(fundamentals.roe * 5);
  const roicScore = clamp(fundamentals.roic * 0.5);
  const gmScore = clamp(fundamentals.gross_margin * 20);
  const debtScore = fundamentals.debt_ratio !== null && fundamentals.debt_ratio !== undefined ? clamp((1 - fundamentals.debt_ratio / 100) * 10) : null;
  const fcfScore = clamp(fundamentals.fcf_margin * 10);
  const cashFlowScore = clamp(fundamentals.operating_cashflow_to_revenue * 10);
  const quality = avg([roeScore, roicScore, gmScore, debtScore, fcfScore, cashFlowScore]);

  // 2) 择人任时：动量 Z
  const momZ = price.mom_20d?.zscore ?? price.mom_60d?.zscore ?? null;
  const timing = momZ !== null ? zToScore(momZ, 1) : null;

  // 3) 修备风控：低波动 + 小回撤
  const volZ = price.vol_20d?.zscore ?? null;
  const ddZ = price.max_drawdown_60d?.zscore ?? null;
  const risk = avg([volZ !== null ? zToScore(volZ, -1) : null, ddZ !== null ? zToScore(ddZ, -1) : null]);

  // 4) 无息币周转：现金比率 + 总资产周转率
  const cashScore = fundamentals.cash_ratio !== null && fundamentals.cash_ratio !== undefined ? clamp(fundamentals.cash_ratio * 5) : null;
  const assetTurnoverScore = fundamentals.total_asset_turnover !== null && fundamentals.total_asset_turnover !== undefined ? clamp(fundamentals.total_asset_turnover * 10) : null;
  const turnoverScore = avg([cashScore, assetTurnoverScore]);

  // 5) 待乏需求：行业景气 + 营收增速；无数据时用动量近似
  const growthScore = fundamentals.revenue_growth !== null && fundamentals.revenue_growth !== undefined ? clamp(5 + fundamentals.revenue_growth * 0.5) : null;
  let cycleScore = cycle !== null && growthScore !== null ? clamp((cycle * 10) * 0.6 + growthScore * 0.4)
    : cycle !== null ? clamp(cycle * 10)
    : growthScore;
  let cycleMethod = 'industry_cycle + revenue_growth';
  if (cycleScore === null) {
    const momRaw = Number(price.mom_20d?.raw);
    cycleScore = Number.isFinite(momRaw) ? clamp(5 + momRaw * 20) : null;
    cycleMethod = Number.isFinite(momRaw) ? 'momentum_proxy' : 'neutral_fallback';
  }

  // 6) 贵贱估值：PE/PB 评分；无数据时用中性分
  let valuationScore = valuation !== null ? clamp(valuation * 10) : null;
  let valuationMethod = 'pe_pb_heuristic';

  const dimensions = {
    待乏需求: dim(cycleScore, cycleMethod, cycleScore === null ? 0.3 : 0.8),
    贵贱估值: dim(valuationScore, valuationMethod, valuationScore === null ? 0.3 : 0.8),
    完物质量: dim(quality, 'roe_roic_margin_debt_fcf_cashflow', quality === null ? 0.3 : 0.9),
    无息币周转: dim(turnoverScore, 'cash_ratio_asset_turnover', turnoverScore === null ? 0.3 : 0.8),
    择人任时: dim(timing, 'momentum_zscore', timing === null ? 0.3 : 0.8),
    修备风控: dim(risk, 'volatility_drawdown_zscore', risk === null ? 0.3 : 0.8)
  };

  const estimatedDimensions = Object.entries(dimensions).filter(([, v]) => v.estimated).map(([k]) => k);
  const computedWeight = Object.entries(FANLI_WEIGHTS).reduce((sum, [name, w]) => sum + (dimensions[name].estimated ? 0 : w), 0);

  let weighted = 0;
  for (const [name, w] of Object.entries(FANLI_WEIGHTS)) weighted += dimensions[name].score * w;

  return {
    version: 'fanli-v3',
    dimensions,
    weights: FANLI_WEIGHTS,
    fanli_score: Number(weighted.toFixed(4)),
    coverage: 1,
    data_completeness: Number(computedWeight.toFixed(2)),
    estimated_dimensions: estimatedDimensions,
    status: estimatedDimensions.length ? 'partial_estimated' : 'full',
    method: 'price + fundamentals + valuation + industry cycle; missing dimensions use transparent neutral/proxy estimates',
    disclaimer: '估算维度仅为补全展示，不代表真实数据，投资判断请优先参考已计算维度。'
  };
}
