import { winsorize, zscore, std, sectorNeutralize, mean } from './stats.js';

// 可计算的「价格类」因子。基本面类因子（价值/质量/股息）需要财报数据，
// 在 V5 中如实标记为 data_missing，不伪造。
const PRICE_FACTORS = ['mom_20d', 'mom_60d', 'vol_20d', 'vol_60d', 'max_drawdown_60d', 'turnover_avg_20d', 'amihud_20d'];

function groupByTicker(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.exchange || '?'}:${r.ticker}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return groups;
}

function sorted(rows) {
  return rows.slice().sort((a, b) => String(a.trade_date).localeCompare(String(b.trade_date)));
}

function returnsFromCloses(closes) {
  const rets = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] && closes[i]) rets.push(closes[i] / closes[i - 1] - 1);
  }
  return rets;
}

function tail(arr, n) {
  return arr.length <= n ? arr : arr.slice(arr.length - n);
}

function computeStockFactors(rows, options = {}) {
  const closes = rows.map((r) => Number(r.close)).filter((v) => Number.isFinite(v));
  const rets = returnsFromCloses(closes);
  const vols = tail(rows, 60).map((r) => Number(r.turnover)).filter((v) => Number.isFinite(v));
  const amounts = tail(rows, 20).map((r) => Number(r.amount)).filter((v) => Number.isFinite(v));
  const rets20 = tail(rets, 20);

  const mom20 = closes.length >= 21 ? closes[closes.length - 1] / closes[closes.length - 21] - 1 : null;
  const mom60 = closes.length >= 61 ? closes[closes.length - 1] / closes[closes.length - 61] - 1 : null;
  const vol20 = rets20.length >= 10 ? (std(rets20) ?? 0) * Math.sqrt(252) : null;
  const vol60 = rets.length >= 30 ? (std(rets) ?? 0) * Math.sqrt(252) : null;

  // 最大回撤：基于最近 60 个收盘价，返回负值（-0.15 表示回撤 15%）。
  let maxDrawdown = null;
  if (closes.length >= 2) {
    let peak = closes[0];
    let dd = 0;
    for (const c of tail(closes, 60)) {
      if (c > peak) peak = c;
      const d = c / peak - 1;
      if (d < dd) dd = d;
    }
    maxDrawdown = dd;
  }

  const turnoverAvg = vols.length ? (mean(vols) ?? null) : null;

  // Amihud 非流动性 = mean(|ret| / amount)；金额为 0 时跳过。数值较小，放大 1e8 便于观察。
  let amihud = null;
  const illiq = [];
  for (let i = 0; i < rets20.length && i < amounts.length; i++) {
    if (amounts[i] > 0) illiq.push(Math.abs(rets20[i]) / amounts[i]);
  }
  if (illiq.length) amihud = (mean(illiq) ?? 0) * 1e8;

  return { mom_20d: mom20, mom_60d: mom60, vol_20d: vol20, vol_60d: vol60, max_drawdown_60d: maxDrawdown, turnover_avg_20d: turnoverAvg, amihud_20d: amihud };
}

export function computeFactors(rows, options = {}) {
  const groups = groupByTicker(rows);
  const tickers = [];
  const rawByFactor = {};

  for (const [key, groupRows] of groups) {
    const stock = computeStockFactors(sorted(groupRows), options);
    tickers.push(key);
    for (const f of PRICE_FACTORS) {
      if (!rawByFactor[f]) rawByFactor[f] = [];
      rawByFactor[f].push(stock[f]);
    }
  }

  // 去极值 → Z-score → 可选行业中性化
  const sectors = options.sectors || null;
  const factorValues = {};
  for (const f of PRICE_FACTORS) {
    const win = winsorize(rawByFactor[f], options.madK || 3);
    let z = zscore(win);
    let neutralized = false;
    if (sectors && sectors.length === tickers.length) {
      z = sectorNeutralize(z, sectors);
      neutralized = true;
    }
    factorValues[f] = { raw: rawByFactor[f], winsorized: win, zscore: z, sector_neutralized: neutralized };
  }

  const stocks = tickers.map((ticker, i) => {
    const [exchange, symbol] = ticker.split(':');
    const factors = {};
    for (const f of PRICE_FACTORS) {
      factors[f] = {
        raw: factorValues[f].raw[i] ?? null,
        winsorized: factorValues[f].winsorized[i] ?? null,
        zscore: factorValues[f].zscore[i] ?? null
      };
    }
    return { ticker: symbol, exchange, factors };
  });

  return {
    as_of: options.asOf || new Date().toISOString().slice(0, 10),
    universe_size: stocks.length,
    sector_neutralized: !!(sectors && sectors.length === tickers.length),
    missing_factors: ['value_pe', 'value_pb', 'quality_roic', 'quality_roe', 'quality_fcf', 'dividend_yield'],
    stocks
  };
}
