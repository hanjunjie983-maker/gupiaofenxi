import { fitLogistic } from './logistic.js';
import { calibrate, brierScore, reliabilityTable } from './calibration.js';
import { mulberry32, quantile, mean, std } from './math.js';

const TARGETS = ['positive_return', 'outperform_benchmark', 'max_drawdown_gt_10'];

function featureNames(samples) {
  const first = samples[0]?.features || {};
  return Object.keys(first);
}

function buildMatrix(samples, names) {
  return samples.map((s) => names.map((n) => Number(s.features[n] ?? 0)));
}

function buildLabels(samples, target) {
  return samples.map((s) => (s.labels?.[target] ? 1 : 0));
}

function bootstrapCi(trainX, trainY, x, { nBoot = 200, seed = 42, lambda = 1, calibration = 'platt' } = {}) {
  const rnd = mulberry32(seed);
  const n = trainX.length;
  const preds = [];
  for (let b = 0; b < nBoot; b++) {
    const idx = Array.from({ length: n }, () => Math.floor(rnd() * n));
    const Xb = idx.map((i) => trainX[i]);
    const yb = idx.map((i) => trainY[i]);
    const lr = fitLogistic(Xb, yb, { lambda, maxIter: 200, tol: 1e-8 });
    const scores = lr.predictLinear(Xb);
    const cal = calibrate(scores, yb, calibration);
    const rawScore = x.reduce((s, v, j) => s + v * lr.weights[j], 0);
    preds.push(cal.predict(rawScore));
  }
  preds.sort((a, b) => a - b);
  return {
    lower: quantile(preds, 0.025),
    upper: quantile(preds, 0.975),
    mean: mean(preds),
    n_boot: nBoot
  };
}

export function fitProbabilityModel(samples, target, options = {}) {
  const names = featureNames(samples);
  const X = buildMatrix(samples, names);
  const y = buildLabels(samples, target);
  const lr = fitLogistic(X, y, { lambda: options.lambda ?? 1, maxIter: 300, tol: 1e-8 });
  const raw = lr.predictProba(X);
  const scores = lr.predictLinear(X);
  const cal = calibrate(scores, y, options.calibration || 'platt');
  const calibrated = raw.map((p, i) => cal.predict(scores[i]));

  return {
    target,
    feature_names: names,
    coefficients: lr.coefficients,
    sample_size: samples.length,
    brier_raw: brierScore(raw, y),
    brier_calibrated: brierScore(calibrated, y),
    calibration_method: cal.type,
    reliability: reliabilityTable(calibrated, y),
    predictCalibrated(x) {
      const linear = x.reduce((s, v, j) => s + v * lr.weights[j], 0);
      return cal.predict(linear);
    },
    predictRaw(x) {
      const linear = x.reduce((s, v, j) => s + v * lr.weights[j], 0);
      return 1 / (1 + Math.exp(-linear));
    },
    predict(x, predictOptions = {}) {
      const pRaw = this.predictRaw(x);
      const pCal = this.predictCalibrated(x);
      const ci = bootstrapCi(X, y, x, { ...options, ...predictOptions, calibration: cal.type });
      return { p_raw: pRaw, p_calibrated: pCal, confidence_interval: [ci.lower, ci.upper], ci_mean: ci.mean, n_boot: ci.n_boot };
    }
  };
}

export function computeProbability({ samples, predict, ticker = 'SYN', as_of, horizon = '20D', options = {} } = {}) {
  const names = featureNames(samples);
  const models = {};
  for (const target of TARGETS) {
    models[target] = fitProbabilityModel(samples, target, options);
  }

  const predictions = (predict || []).map((item, idx) => {
    const x = names.map((n) => Number(item.features?.[n] ?? 0));
    const out = {
      ticker: item.ticker || `${ticker}_${idx}`,
      as_of: as_of || new Date().toISOString().slice(0, 10),
      horizon,
      sample_size: samples.length,
      model: 'Bayesian Logistic (L2 MAP) + Platt/Isotonic Calibration + Bootstrap CI',
      features: item.features || {}
    };
    for (const target of TARGETS) {
      const pred = models[target].predict(x, options);
      out[target === 'positive_return' ? 'P_positive_return' : target === 'outperform_benchmark' ? 'P_outperform_benchmark' : 'P_max_drawdown_gt_10'] = Number(pred.p_calibrated.toFixed(4));
      out[`${target}_ci`] = [Number(pred.confidence_interval[0].toFixed(4)), Number(pred.confidence_interval[1].toFixed(4))];
    }
    return out;
  });

  return {
    model: 'Bayesian Logistic (L2 MAP) + Platt/Isotonic Calibration + Bootstrap CI',
    feature_names: names,
    sample_size: samples.length,
    calibration_method: options.calibration || 'platt',
    metrics: Object.fromEntries(TARGETS.map((t) => [t, { brier_raw: models[t].brier_raw, brier_calibrated: models[t].brier_calibrated, reliability: models[t].reliability }])),
    predictions
  };
}

export function riskFlagsAndDrivers(features) {
  const drivers = [];
  const riskFlags = [];
  const rules = {
    momentum_z: { high: '动量强', low: '动量弱' },
    vol_z: { high: '波动率偏高', low: '波动率偏低' },
    drawdown_z: { high: '回撤较大', low: '回撤较小' },
    liquidity_z: { high: '流动性较好', low: '流动性偏低' }
  };
  for (const [k, v] of Object.entries(features)) {
    const z = Number(v);
    const rule = rules[k];
    if (!rule || !Number.isFinite(z)) continue;
    if (z > 0.5) drivers.push(rule.high);
    else if (z < -0.5) riskFlags.push(rule.low);
  }
  return { drivers, riskFlags };
}


