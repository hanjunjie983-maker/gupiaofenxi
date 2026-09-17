import { mulberry32, mean, std, quantile, solveLinear, matVecMul } from '../probability/math.js';

// 生成合成输入：因子模型收益（含协方差），确定性可复现。
export function generateSyntheticInputs({ tickers = 8, periods = 252, seed = 42 } = {}) {
  const rnd = mulberry32(seed);
  const names = Array.from({ length: tickers }, (_, i) => `P${String(i + 1).padStart(3, '0')}`);
  const betas = Array.from({ length: tickers }, () => 0.5 + rnd() * 1.2);
  const idioVol = Array.from({ length: tickers }, () => 0.08 + rnd() * 0.14);
  const returnsHistory = [];
  for (let t = 0; t < periods; t++) {
    const f = (rnd() - 0.5) * 0.04; // 因子收益
    const row = betas.map((b, i) => b * f + idioVol[i] * (rnd() - 0.5 + rnd() - 0.5));
    returnsHistory.push(row);
  }
  const vols = names.map((_, j) => std(returnsHistory.map((r) => r[j])));
  const cov = names.map((_, i) => names.map((_, j) => {
    const colI = returnsHistory.map((r) => r[i]);
    const colJ = returnsHistory.map((r) => r[j]);
    const mi = mean(colI);
    const mj = mean(colJ);
    return colI.reduce((s, v, k) => s + (v - mi) * (colJ[k] - mj), 0) / (periods - 1);
  }));
  return { tickers: names, returns_history: returnsHistory, vols, covariance: cov, periods };
}

export function inverseVolWeights(vols) {
  const inv = vols.map((v) => 1 / v);
  const sum = inv.reduce((a, b) => a + b, 0);
  return inv.map((v) => v / sum);
}

// 对角协方差下的风险平价 = 等风险贡献；逆波动率权重即精确解。
export function riskParityWeights(vols) {
  return inverseVolWeights(vols);
}

export function kellyWeight({ p, odds = 1, fraction = 0.25 }) {
  if (odds <= 0 || p <= 0 || p >= 1) return 0;
  const full = (p * odds - (1 - p)) / odds;
  return Math.max(0, full * fraction);
}

// 历史模拟 CVaR：损失 = -收益，取 alpha 分位数以上损失均值。
export function historicalCvar(portfolioReturns, alpha = 0.95) {
  const losses = portfolioReturns.map((r) => -r);
  const varLoss = quantile(losses, alpha);
  const tail = losses.filter((l) => l >= varLoss);
  return tail.length ? mean(tail) : varLoss;
}

// CVaR 上限：超出预算时按比例缩减风险资产，其余转 CASH。
export function applyCvarCap(weights, returnsHistory, { alpha = 0.95, maxCvar = 0.04 } = {}) {
  const portReturns = returnsHistory.map((row) => row.reduce((s, r, i) => s + r * weights[i], 0));
  const cvar = historicalCvar(portReturns, alpha);
  if (cvar <= maxCvar) return { weights, cash: 0, cvar };
  const scale = maxCvar / cvar;
  const scaled = weights.map((w) => w * scale);
  const cash = 1 - scaled.reduce((a, b) => a + b, 0);
  return { weights: scaled, cash, cvar: maxCvar };
}

// 对角风险贡献：w_i^2 * vol_i^2 / portfolio_var。
export function riskContributions(weights, vols) {
  const varPortfolio = weights.reduce((s, w, i) => s + w * w * vols[i] * vols[i], 0);
  if (varPortfolio === 0) return weights.map(() => 0);
  return weights.map((w, i) => (w * w * vols[i] * vols[i]) / varPortfolio);
}

// 凯利权重：由各标的概率/赔率计算 f*，取分数后按正权重归一化。
export function kellyPortfolio(probs, oddsList, { fraction = 0.25 } = {}) {
  const raw = probs.map((p, i) => kellyWeight({ p, odds: oddsList[i] ?? 1, fraction }));
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) return raw.map(() => 0);
  return raw.map((w) => w / sum);
}

// 权重截断并重归一化（迭代，避免超上限）。
export function capWeights(weights, maxWeight = 0.2) {
  let w = weights.slice();
  for (let iter = 0; iter < 20; iter++) {
    let excess = 0;
    let active = [];
    for (let i = 0; i < w.length; i++) {
      if (w[i] > maxWeight) { excess += w[i] - maxWeight; w[i] = maxWeight; }
      else active.push(i);
    }
    if (excess < 1e-12) break;
    const activeSum = active.reduce((s, i) => s + w[i], 0);
    if (activeSum <= 0) break;
    const add = excess / active.length;
    for (const i of active) w[i] += add;
  }
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / sum);
}
