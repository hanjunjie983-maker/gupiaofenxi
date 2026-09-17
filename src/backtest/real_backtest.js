import { cumulativeReturn, maxDrawdown, annualizedReturn, annualizedVol, sharpe, winRate } from './metrics.js';

function sorted(rows) {
  return rows.slice().sort((a, b) => String(a.trade_date).localeCompare(String(b.trade_date)));
}

// 真实单标的回测：signal(t)=过去 lookback 日收益；signal>0 持有，否则空仓。
// 收益结算为 t→t+1，避免前视；仓位变化扣 cost。
export function runRealBacktest(rows, { lookback = 20, commissionBps = 2, stampDutyBps = 5, slippageBps = 5, impactBps = 2, cost = null, periodsPerYear = 252 } = {}) {
  const data = sorted(rows).filter((r) => r.tradestatus !== '0' && Number.isFinite(Number(r.adj_close ?? r.close)));
  const nav = [1];
  const returns = [];
  let position = 0;
  let turnover = 0;
  let totalCost = 0;
  for (let t = lookback; t < data.length - 1; t++) {
    const p0 = Number(data[t].adj_close ?? data[t].close);
    const pPrev = Number(data[t - lookback].adj_close ?? data[t - lookback].close);
    const pNext = Number(data[t + 1].adj_close ?? data[t + 1].close);
    const signal = p0 / pPrev - 1;
    const nextPosition = signal > 0 ? 1 : 0;
    const ret = nextPosition * (pNext / p0 - 1);
    const delta = Math.abs(nextPosition - position);
    let costToday;
    if (cost !== null) {
      costToday = delta * cost;
    } else {
      const buy = (commissionBps + slippageBps + impactBps) / 10000;
      const sell = (commissionBps + stampDutyBps + slippageBps + impactBps) / 10000;
      costToday = delta * (nextPosition > position ? buy : sell);
    }
    turnover += delta;
    totalCost += costToday;
    const net = ret - costToday;
    returns.push(net);
    nav.push(nav[nav.length - 1] * (1 + net));
    position = nextPosition;
  }
  return {
    ticker: data[0]?.ticker || null,
    exchange: data[0]?.exchange || null,
    start_date: data[lookback]?.trade_date || null,
    end_date: data[data.length - 2]?.trade_date || null,
    nav,
    returns,
    metrics: {
      cumulative_return: cumulativeReturn(nav),
      annualized_return: annualizedReturn(nav, periodsPerYear),
      annualized_vol: annualizedVol(returns, periodsPerYear),
      sharpe: sharpe(returns, periodsPerYear),
      max_drawdown: maxDrawdown(nav),
      win_rate: winRate(returns),
      turnover,
      total_cost: totalCost,
      periods: returns.length
    },
    config: { lookback, commissionBps, stampDutyBps, slippageBps, impactBps, cost, periodsPerYear }
  };
}

// 真实未来标签：用 t→t+horizon 的真实价格计算，仅用于回测/评估，不能作为 t 时点特征。
export function buildFutureLabels(rows, { horizon = 20 } = {}) {
  const data = sorted(rows).filter((r) => r.tradestatus !== '0' && Number.isFinite(Number(r.adj_close ?? r.close)));
  const samples = [];
  for (let t = 0; t < data.length - horizon; t++) {
    const entry = Number(data[t].adj_close ?? data[t].close);
    const exit = Number(data[t + horizon].adj_close ?? data[t + horizon].close);
    let peak = entry;
    let maxDd = 0;
    for (let i = t; i <= t + horizon; i++) {
      const c = Number(data[i].adj_close ?? data[i].close);
      if (c > peak) peak = c;
      maxDd = Math.min(maxDd, c / peak - 1);
    }
    const futureReturn = exit / entry - 1;
    samples.push({
      trade_date: data[t].trade_date,
      ticker: data[t].ticker,
      future_return: futureReturn,
      labels: {
        positive_return: futureReturn > 0 ? 1 : 0,
        max_drawdown_gt_10: maxDd < -0.10 ? 1 : 0
      }
    });
  }
  return samples;
}


