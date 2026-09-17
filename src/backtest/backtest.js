import { mulberry32 } from '../probability/math.js';
import { cumulativeReturn, maxDrawdown, annualizedReturn, annualizedVol, sharpe, winRate, turnoverBetween } from './metrics.js';

// 合成面板：每个 ticker 的 signal 为 AR(1)，收益 = signal * ic + 噪声。
// signal 在 t 期可观测，用于 t 期选股；收益 return[t] 为 t→t+1 持有期收益，避免前视。
export function generatePanel({ tickers = 20, periods = 120, seed = 42, ic = 0.12, phi = 0.8, vol = 0.08, periodsPerYear = 12 } = {}) {
  const rnd = mulberry32(seed);
  const signals = [];
  const returns = [];
  for (let i = 0; i < tickers; i++) {
    let s = (rnd() - 0.5) * 2;
    const sig = [];
    const ret = [];
    for (let t = 0; t < periods; t++) {
      s = phi * s + (rnd() - 0.5) * 2;
      sig.push(s);
      // 肥尾：用两个均匀噪声混合近似 t 分布
      const noise = vol * (rnd() - 0.5 + rnd() - 0.5);
      ret.push(ic * s + noise);
    }
    signals.push(sig);
    returns.push(ret);
  }
  // signals[ticker][period], returns[ticker][period]
  return { tickers: Array.from({ length: tickers }, (_, i) => `S${String(i + 1).padStart(3, '0')}`), periods, signals, returns, periodsPerYear };
}

function rankTopBottom(signalAtT, q) {
  const idx = signalAtT.map((s, i) => ({ i, s })).filter((x) => Number.isFinite(x.s));
  idx.sort((a, b) => b.s - a.s);
  const k = Math.max(1, Math.floor(idx.length * q));
  const top = idx.slice(0, k).map((x) => x.i);
  const bottom = idx.slice(-k).map((x) => x.i);
  return { top, bottom };
}

export function runBacktest(panel, { topQuantile = 0.2, rebalanceEvery = 1, cost = 0.001, longOnly = true, periodsPerYear } = {}) {
  const { tickers, signals, returns } = panel;
  const n = tickers.length;
  const T = panel.periods;
  const ppy = periodsPerYear || panel.periodsPerYear || 12;
  const nav = [1];
  const navLong = [1];
  const navShort = [1];
  const portReturns = [];
  const portReturnsLong = [];
  const portReturnsShort = [];
  const rebalances = [];
  let wPrevLong = new Map();
  let wPrevShort = new Map();

  for (let t = 0; t < T - 1; t++) {
    let wLong = wPrevLong;
    let wShort = wPrevShort;
    if (t % rebalanceEvery === 0) {
      const { top, bottom } = rankTopBottom(signals.map((sig) => sig[t]), topQuantile);
      wLong = new Map(top.map((i) => [i, 1 / top.length]));
      wShort = new Map(bottom.map((i) => [i, 1 / bottom.length]));
      const turn = (turnoverBetween(wPrevLong, wLong) + turnoverBetween(wPrevShort, wShort)) / 2;
      rebalances.push({ t, turnover: turn, n_top: top.length, n_bottom: bottom.length });
    }

    const retLong = [...wLong.entries()].reduce((s, [i, w]) => s + w * returns[i][t], 0);
    const retShort = [...wShort.entries()].reduce((s, [i, w]) => s + w * returns[i][t], 0);
    portReturnsLong.push(retLong);
    portReturnsShort.push(retShort);

    const turnCost = t % rebalanceEvery === 0 ? cost * (rebalances[rebalances.length - 1]?.turnover || 0) : 0;
    const retLongNet = retLong - turnCost;
    const retShortNet = -retShort - turnCost;
    navLong.push(navLong[navLong.length - 1] * (1 + retLongNet));
    navShort.push(navShort[navShort.length - 1] * (1 + retShortNet));

    const port = longOnly ? retLongNet : retLongNet + retShortNet;
    portReturns.push(port);
    nav.push(nav[nav.length - 1] * (1 + port));
    wPrevLong = wLong;
    wPrevShort = wShort;
  }

  const summarize = (nv, rets) => ({
    cumulative_return: cumulativeReturn(nv),
    annualized_return: annualizedReturn(nv, ppy),
    annualized_vol: annualizedVol(rets, ppy),
    sharpe: sharpe(rets, ppy),
    max_drawdown: maxDrawdown(nv),
    win_rate: winRate(rets),
    periods: rets.length
  });

  return {
    nav,
    nav_long: navLong,
    nav_short: navShort,
    portfolio_returns: portReturns,
    metrics: {
      long_short: summarize(nav, portReturns),
      long_only: summarize(navLong, portReturnsLong),
      short_only: summarize(navShort, portReturnsShort)
    },
    rebalance_count: rebalances.length,
    config: { topQuantile, rebalanceEvery, cost, longOnly, periodsPerYear: ppy }
  };
}
