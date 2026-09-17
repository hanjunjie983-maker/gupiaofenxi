import { mean, std } from '../probability/math.js';

export function cumulativeReturn(nav) {
  if (!nav.length) return 0;
  return nav[nav.length - 1] / nav[0] - 1;
}

export function maxDrawdown(nav) {
  if (!nav.length) return 0;
  let peak = nav[0];
  let dd = 0;
  for (const v of nav) {
    if (v > peak) peak = v;
    const d = v / peak - 1;
    if (d < dd) dd = d;
  }
  return dd; // 负值
}

export function annualizedReturn(nav, periodsPerYear = 12) {
  const total = cumulativeReturn(nav);
  const years = (nav.length - 1) / periodsPerYear;
  if (years <= 0) return 0;
  return (1 + total) ** (1 / years) - 1;
}

export function annualizedVol(returns, periodsPerYear = 12) {
  const s = std(returns);
  if (s === null) return 0;
  return s * Math.sqrt(periodsPerYear);
}

export function sharpe(returns, periodsPerYear = 12, riskFree = 0) {
  const m = mean(returns);
  const s = std(returns);
  if (m === null || s === null || s === 0) return 0;
  return ((m - riskFree) / s) * Math.sqrt(periodsPerYear);
}

export function winRate(returns) {
  const f = returns.filter((r) => Number.isFinite(r));
  if (!f.length) return 0;
  return f.filter((r) => r > 0).length / f.length;
}

export function turnoverBetween(wPrev, wNext) {
  const keys = new Set([...wPrev.keys(), ...wNext.keys()]);
  let sum = 0;
  for (const k of keys) sum += Math.abs((wNext.get(k) || 0) - (wPrev.get(k) || 0));
  return sum;
}
