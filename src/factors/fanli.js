// 范蠡六维评分。V5 只能基于价格因子计算「择人任时」「修备风控」两个维度，
// 其余维度需要财报/估值/行业数据，如实标记 data_missing，不伪造分数。

export const FANLI_WEIGHTS = {
  待乏需求: 0.20,
  贵贱估值: 0.20,
  完物质量: 0.20,
  无息币周转: 0.10,
  择人任时: 0.20,
  修备风控: 0.10
};

function normCdf(x) {
  // Abramowitz-Stegun 近似，足够用于把 Z-score 映射到 0-10 分。
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function zToScore(z, direction = 1) {
  if (z === null || !Number.isFinite(z)) return null;
  const p = normCdf(z);
  return direction === 1 ? p * 10 : (1 - p) * 10;
}

function avg(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null;
}

export function computeFanli(factors, options = {}) {
  const f = factors || {};
  const dimensions = {
    待乏需求: { score: null, status: 'data_missing', required: ['industry_cycle'] },
    贵贱估值: { score: null, status: 'data_missing', required: ['pe_percentile', 'pb_percentile'] },
    完物质量: { score: null, status: 'data_missing', required: ['roic', 'roe', 'fcf', 'gross_margin'] },
    无息币周转: { score: null, status: 'data_missing', required: ['cash_ratio', 'cash_conversion_cycle'] },
    择人任时: { score: null, status: 'computed', required: ['momentum'] },
    修备风控: { score: null, status: 'computed', required: ['volatility', 'max_drawdown'] }
  };

  const mom = avg([f.mom_20d?.zscore ?? null, f.mom_60d?.zscore ?? null]);
  const timingScore = mom !== null ? zToScore(mom, 1) : null;
  dimensions['择人任时'].score = timingScore;

  const volZ = f.vol_20d?.zscore ?? null;
  const ddZ = f.max_drawdown_60d?.zscore ?? null;
  const riskScore = avg([volZ !== null ? zToScore(volZ, -1) : null, ddZ !== null ? zToScore(ddZ, -1) : null]);
  dimensions['修备风控'].score = riskScore;

  let weighted = 0;
  let coverage = 0;
  for (const [name, weight] of Object.entries(FANLI_WEIGHTS)) {
    const s = dimensions[name].score;
    if (s !== null && Number.isFinite(s)) {
      weighted += s * weight;
      coverage += weight;
    }
  }

  return {
    dimensions,
    weights: FANLI_WEIGHTS,
    fanli_score: coverage > 0 ? weighted / coverage : null,
    coverage: Number(coverage.toFixed(2)),
    status: coverage >= 1 ? 'full' : 'partial'
  };
}
