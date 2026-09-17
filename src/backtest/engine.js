import { generatePanel, runBacktest } from './backtest.js';
import { fitProbabilityModel } from '../probability/engine.js';
import { brierScore, reliabilityTable } from '../probability/calibration.js';

// Walk-Forward 概率校准评估：按时间顺序扩展训练窗，滚动预测测试窗。
// 只做点预测校准评估，不在此处跑 Bootstrap（Bootstrap 在单次概率输出时做）。
export function evaluateCalibration(samples, { trainSize = 0.6, step = 20, target = 'positive_return', calibration = 'platt' } = {}) {
  const n = samples.length;
  const minTrain = Math.max(10, Math.floor(n * trainSize));
  const folds = [];
  const allPreds = [];
  const allLabels = [];
  const allRaw = [];

  for (let start = minTrain; start < n; start += step) {
    const train = samples.slice(0, start);
    const test = samples.slice(start, Math.min(n, start + step));
    if (test.length < 5) break;
    const model = fitProbabilityModel(train, target, { calibration });
    const names = model.feature_names;
    const X = test.map((s) => names.map((k) => Number(s.features?.[k] ?? 0)));
    const y = test.map((s) => (s.labels?.[target] ? 1 : 0));
    const preds = X.map((x) => model.predictCalibrated(x));
    folds.push({ train_size: train.length, test_size: test.length, brier: brierScore(preds, y) });
    preds.forEach((p, i) => { allPreds.push(p); allLabels.push(y[i]); });
  }

  const meanPredByBin = reliabilityTable(allPreds, allLabels, 10);
  const calibrationBrier = brierScore(allPreds, allLabels);
  const baseRate = allLabels.reduce((a, b) => a + b, 0) / (allLabels.length || 1);
  const brierBaseline = brierScore(new Array(allLabels.length).fill(baseRate), allLabels);

  return {
    target,
    folds,
    aggregate: {
      n_predictions: allPreds.length,
      base_rate: baseRate,
      brier: calibrationBrier,
      brier_baseline: brierBaseline,
      brier_skill: brierBaseline === 0 ? 0 : 1 - calibrationBrier / brierBaseline,
      reliability: meanPredByBin
    }
  };
}

export function runBacktestJob(config = {}) {
  const panel = config.data || generatePanel({
    tickers: config.tickers || 20,
    periods: config.periods || 120,
    seed: config.seed || 42,
    ic: config.ic || 0.12,
    phi: config.phi || 0.8,
    vol: config.vol || 0.08,
    periodsPerYear: config.periods_per_year || 12
  });
  const backtest = runBacktest(panel, {
    topQuantile: config.top_quantile || 0.2,
    rebalanceEvery: config.rebalance_every || 1,
    cost: config.cost ?? 0.001,
    longOnly: config.long_only ?? true,
    periodsPerYear: config.periods_per_year || panel.periodsPerYear || 12
  });
  return { panel: { tickers: panel.tickers, periods: panel.periods }, backtest };
}

