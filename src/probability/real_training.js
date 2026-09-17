import { fitProbabilityModel } from './engine.js';
import { brierScore, reliabilityTable } from './calibration.js';
import { mean, std } from './math.js';

function sorted(rows) {
  return rows.slice().filter((r) => r.tradestatus !== '0').sort((a, b) => String(a.trade_date).localeCompare(String(b.trade_date)));
}

function price(row) {
  return Number(row.adj_close ?? row.close);
}

function featuresAt(rows, i, lookback = 20) {
  const slice = rows.slice(Math.max(0, i - lookback + 1), i + 1);
  const closes = slice.map(price).filter(Number.isFinite);
  if (closes.length < 2) return null;
  const rets = closes.slice(1).map((c, k) => c / closes[k] - 1);
  const mom = closes[closes.length - 1] / closes[0] - 1;
  const vol = (std(rets.slice(-20)) ?? 0) * Math.sqrt(252);
  let peak = closes[0];
  let dd = 0;
  for (const c of closes) { if (c > peak) peak = c; dd = Math.min(dd, c / peak - 1); }
  const turnover = mean(slice.map((r) => Number(r.turnover)).filter(Number.isFinite)) ?? 0;
  return { mom: mom, vol: vol, drawdown: dd, turnover: turnover };
}

// 用真实价格构建 point-in-time 标签：特征只到 t，标签用 t→t+horizon。
export function buildRealTrainingSamples(rows, { lookback = 20, horizon = 20 } = {}) {
  const data = sorted(rows);
  const samples = [];
  for (let i = lookback; i < data.length - horizon; i++) {
    const features = featuresAt(data, i, lookback);
    if (!features) continue;
    const entry = price(data[i]);
    const exit = price(data[i + horizon]);
    let peak = entry;
    let maxDd = 0;
    for (let k = i; k <= i + horizon; k++) {
      const c = price(data[k]);
      if (c > peak) peak = c;
      maxDd = Math.min(maxDd, c / peak - 1);
    }
    samples.push({
      trade_date: data[i].trade_date,
      features,
      labels: {
        positive_return: exit / entry - 1 > 0 ? 1 : 0,
        max_drawdown_gt_10: maxDd < -0.10 ? 1 : 0
      }
    });
  }
  return samples;
}

// 真实 Walk-Forward：扩展训练窗，滚动预测测试窗，输出 Brier/可靠性。
export function walkForwardRealProbability(rows, options = {}) {
  const samples = buildRealTrainingSamples(rows, options);
  const target = options.target || 'positive_return';
  const trainWindow = options.trainWindow || Math.max(60, Math.floor(samples.length * 0.6));
  const testWindow = options.testWindow || Math.max(10, Math.floor(samples.length * 0.1));
  const folds = [];
  const preds = [];
  const labels = [];

  for (let start = trainWindow; start < samples.length; start += testWindow) {
    const train = samples.slice(0, start);
    const test = samples.slice(start, Math.min(samples.length, start + testWindow));
    if (train.length < 30 || test.length < 3) continue;
    const model = fitProbabilityModel(train, target, { calibration: options.calibration || 'platt' });
    const testPreds = test.map((s) => model.predictCalibrated(model.feature_names.map((n) => Number(s.features[n] ?? 0))));
    const testLabels = test.map((s) => s.labels[target] ? 1 : 0);
    folds.push({ train_size: train.length, test_size: test.length, brier: brierScore(testPreds, testLabels) });
    preds.push(...testPreds);
    labels.push(...testLabels);
  }

  const finalModel = fitProbabilityModel(samples, target, { calibration: options.calibration || 'platt' });
  const latestFeatures = samples[samples.length - 1]?.features;
  const x = latestFeatures ? finalModel.feature_names.map((n) => Number(latestFeatures[n] ?? 0)) : null;
  const latest = x ? finalModel.predict(x, { nBoot: options.nBoot || 100, seed: options.seed || 42 }) : null;

  return {
    target,
    sample_size: samples.length,
    folds,
    aggregate: {
      n_predictions: preds.length,
      brier: preds.length ? brierScore(preds, labels) : null,
      base_rate: labels.length ? mean(labels) : null,
      reliability: preds.length ? reliabilityTable(preds, labels, 10) : []
    },
    latest_prediction: latest ? { P_positive_return: latest.p_calibrated, confidence_interval: latest.confidence_interval, features: latestFeatures } : null,
    model: 'Bayesian Logistic + Platt + Walk-Forward (real price labels)',
    labels_source: 'real_price_future_returns',
    lookback: options.lookback || 20,
    horizon: options.horizon || 20
  };
}
