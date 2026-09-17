import { FANLI_WEIGHTS } from './fanli.js';

function clamp(v, lo = 0, hi = 10) {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.min(hi, Math.max(lo, v));
}

function avg(values) {
  const f = values.filter((v) => Number.isFinite(v));
  return f.length ? f.reduce((a, b) => a + b, 0) / f.length : null;
}

function zToScore(z, direction = 1) {
  if (z === null || !Number.isFinite(z)) return null;
  const p = 1 / (1 + Math.exp(-z)); // sigmoid 0-1
  return direction === 1 ? p * 10 : (1 - p) * 10;
}

export function computeFanliV2({ price = {}, fundamentals = {}, valuation = null, cycle = null } = {}) {
  // 完物质量：ROE/ROIC/毛利率/负债率/FCF/经营现金流质量的启发式综合
  const roeScore = clamp(fundamentals.roe * 5);
  const roicScore = fundamentals.roic !== null && fundamentals.roic !== undefined ? clamp(fundamentals.roic * 0.5) : null;
  const gmScore = fundamentals.gross_margin !== null && fundamentals.gross_margin !== undefined ? clamp(fundamentals.gross_margin * 20) : null;
  const debtScore = fundamentals.debt_ratio !== null && fundamentals.debt_ratio !== undefined
    ? clamp((1 - fundamentals.debt_ratio / 100) * 10)
    : null;
  const fcfScore = fundamentals.fcf_margin !== null && fundamentals.fcf_margin !== undefined ? clamp(fundamentals.fcf_margin * 10) : null;
  const cashFlowScore = fundamentals.operating_cashflow_to_revenue !== null && fundamentals.operating_cashflow_to_revenue !== undefined
    ? clamp(fundamentals.operating_cashflow_to_revenue * 10)
    : null;
  const quality = avg([roeScore, roicScore, gmScore, debtScore, fcfScore, cashFlowScore]);

  const momZ = price.mom_20d?.zscore ?? price.mom_60d?.zscore ?? null;
  const volZ = price.vol_20d?.zscore ?? null;
  const ddZ = price.max_drawdown_60d?.zscore ?? null;
  const timing = momZ !== null ? zToScore(momZ, 1) : null;
  const risk = avg([volZ !== null ? zToScore(volZ, -1) : null, ddZ !== null ? zToScore(ddZ, -1) : null]);

  const cashScore = fundamentals.cash_ratio !== null && fundamentals.cash_ratio !== undefined ? clamp(fundamentals.cash_ratio * 5) : null;
  const assetTurnoverScore = fundamentals.total_asset_turnover !== null && fundamentals.total_asset_turnover !== undefined ? clamp(fundamentals.total_asset_turnover * 10) : null;
  const turnoverScore = avg([cashScore, assetTurnoverScore]);

  const growthScore = fundamentals.revenue_growth !== null && fundamentals.revenue_growth !== undefined
    ? clamp(5 + fundamentals.revenue_growth * 0.5)
    : null;
  const cycleScore = cycle !== null && growthScore !== null ? clamp((cycle * 10) * 0.6 + growthScore * 0.4)
    : cycle !== null ? clamp(cycle * 10) : growthScore;

  const dimensions = {
    待乏需求: { score: cycleScore, status: cycleScore !== null ? 'computed' : 'data_missing', required: ['industry_cycle', 'revenue_growth'] },
    贵贱估值: { score: valuation !== null ? clamp(valuation * 10) : null, status: valuation !== null ? 'computed' : 'data_missing', required: ['valuation_percentile'] },
    完物质量: { score: quality, status: quality !== null ? 'computed' : 'data_missing', required: ['roe', 'roic', 'gross_margin', 'debt_ratio', 'fcf_margin', 'operating_cashflow_to_revenue'] },
    无息币周转: { score: turnoverScore, status: turnoverScore !== null ? 'computed' : 'data_missing', required: ['cash_ratio', 'total_asset_turnover'] },
    择人任时: { score: timing, status: timing !== null ? 'computed' : 'data_missing', required: ['momentum'] },
    修备风控: { score: risk, status: risk !== null ? 'computed' : 'data_missing', required: ['volatility', 'max_drawdown'] }
  };

  let weighted = 0;
  let coverage = 0;
  for (const [name, w] of Object.entries(FANLI_WEIGHTS)) {
    const s = dimensions[name].score;
    if (s !== null && Number.isFinite(s)) {
      weighted += s * w;
      coverage += w;
    }
  }

  return {
    version: 'fanli-v2',
    dimensions,
    weights: FANLI_WEIGHTS,
    fanli_score: coverage > 0 ? weighted / coverage : null,
    coverage: Number(coverage.toFixed(2)),
    status: coverage >= 1 ? 'full' : 'partial',
    method: 'price + fundamental quality (draft heuristic)'
  };
}

