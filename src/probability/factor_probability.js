import { computeProbability } from './engine.js';
import { mulberry32 } from './math.js';

export const FACTOR_FEATURES = [
  'mom_20d_z', 'mom_60d_z', 'vol_20d_z', 'max_drawdown_z',
  'roe', 'gross_margin', 'debt_ratio', 'fcf_margin'
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 把价格因子 + 基本面因子展平为模型特征；缺失值以 0 填充并记录 missing_features。
export function buildFeatures(asset = {}) {
  const price = asset.price_factors || {};
  const fund = asset.fundamentals || {};
  const raw = {
    mom_20d_z: num(price.mom_20d?.zscore),
    mom_60d_z: num(price.mom_60d?.zscore),
    vol_20d_z: num(price.vol_20d?.zscore),
    max_drawdown_z: num(price.max_drawdown_60d?.zscore),
    roe: num(fund.roe),
    gross_margin: num(fund.gross_margin),
    debt_ratio: num(fund.debt_ratio),
    fcf_margin: num(fund.fcf_margin)
  };
  const missing = [];
  const features = {};
  for (const k of FACTOR_FEATURES) {
    if (raw[k] === null) missing.push(k);
    features[k] = raw[k] ?? 0;
  }
  return { features, missing_features: missing };
}

// 无真实未来收益标签时，用确定性 PRNG 生成合成标签，仅用于验证特征→概率链路。
export function syntheticLabels(features, ticker, seed = 42) {
  let h = 0;
  for (const c of ticker) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = mulberry32((seed + h) >>> 0);
  const score = 0.6 * features.mom_20d_z - 0.4 * features.vol_20d_z - 0.3 * features.max_drawdown_z
    + 1.2 * features.roe + 0.8 * features.gross_margin - 0.6 * features.debt_ratio + 0.5 * features.fcf_margin;
  const p = 1 / (1 + Math.exp(-score));
  return {
    positive_return: rnd() < p ? 1 : 0,
    outperform_benchmark: rnd() < p ? 1 : 0,
    max_drawdown_gt_10: rnd() < (1 - p) * 0.5 ? 1 : 0
  };
}

export function buildSamples(assets, { seed = 42, useSyntheticLabels = true } = {}) {
  return assets.map((asset) => {
    const { features, missing_features } = buildFeatures(asset);
    const labels = asset.labels || (useSyntheticLabels ? syntheticLabels(features, asset.ticker || 'UNK', seed) : null);
    return { ticker: asset.ticker, features, labels, missing_features, source_url: asset.source_url || null };
  }).filter((s) => s.labels);
}

export function trainFactorProbability({ assets = [], predict = [], seed = 42, horizon = '20D', as_of } = {}) {
  const samples = buildSamples(assets, { seed, useSyntheticLabels: true });
  if (samples.length < 20) throw new Error('at least 20 assets with labels are required for stable training');
  const predictRows = predict.length ? predict : assets.slice(0, 1).map((a) => ({ ticker: a.ticker, features: buildFeatures(a).features }));
  const normalized = predictRows.map((p) => ({ ticker: p.ticker, features: buildFeatures(p).features }));
  const result = computeProbability({
    samples: samples.map((s) => ({ features: s.features, labels: s.labels })),
    predict: normalized,
    ticker: normalized[0]?.ticker || 'FACTOR',
    as_of,
    horizon,
    options: { calibration: 'platt', seed }
  });
  return {
    ...result,
    labels_source: 'synthetic_for_pipeline_validation',
    feature_source: 'price_factors + fundamentals',
    source_urls: assets.map((a) => a.source_url).filter(Boolean),
    missing_features: samples.map((s) => ({ ticker: s.ticker, missing: s.missing_features }))
  };
}
