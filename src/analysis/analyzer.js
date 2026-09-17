import { EastmoneyConnector } from '../ingest/eastmoney.js';
import { FundHoldingsConnector } from '../ingest/fund_holdings.js';
import { EastmoneyFundamentalsConnector } from '../ingest/eastmoney_fundamentals.js';
import { computeFactors } from '../factors/engine.js';
import { computeFanliV2 } from '../factors/fanli_v2.js';
import { valuationScore, industryCycleScore } from '../factors/valuation_cycle.js';
import { walkForwardRealProbability } from '../probability/real_training.js';
import { runRealBacktest } from '../backtest/real_backtest.js';
import { computeWorthBuyingProbability } from './worth_buying.js';
import { computePositionAdvice } from './position_advice.js';
import { computeFanliSummary } from '../factors/fanli_summary.js';

function inferMarket(ticker) {
  const t = String(ticker).replace(/^(sh|sz|bj)\./i, '');
  if (/^(6|9|5)/.test(t)) return 'SH';
  if (/^(0|3)/.test(t)) return 'SZ';
  return 'BJ';
}

function daysAgo(days) { return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); }

async function settle(promise) {
  try { return { ok: true, value: await promise }; }
  catch (err) { return { ok: false, error: err.message }; }
}

async function tryKline(eastmoney, symbol, preferredMarket) {
  const markets = [...new Set([preferredMarket, 'SH', 'SZ', 'BJ'])];
  const errors = [];
  for (const market of markets) {
    const r = await settle(eastmoney.run({ ticker: symbol, market, startDate: daysAgo(730), endDate: new Date().toISOString().slice(0, 10), adjust: 'qfq' }));
    if (r.ok && r.value.rows > 0) return { ok: true, market, value: r.value };
    errors.push(`${market}:${r.ok ? 'empty' : r.error}`);
  }
  return { ok: false, error: errors.join('; ') };
}

export async function analyzeTicker({ ticker, market, industrySecid = '90.BK0477', store, config, fetchImpl, capital = 1000000, riskLevel = 'balanced' } = {}) {
  const symbol = String(ticker).replace(/^(sh|sz|bj)\./i, '').trim();
  if (!/^\d{6}$/.test(symbol)) throw new Error('目前支持 A股 6 位代码，例如 600519 / 000001 / 300750');
  const preferredMarket = market || inferMarket(symbol);
  const eastmoney = new EastmoneyConnector({ config, store, fetchImpl });

  const klineTry = await tryKline(eastmoney, symbol, preferredMarket);
  const usedMarket = klineTry.ok ? klineTry.market : preferredMarket;

  const [valuationR, industryR, holdingsR, fundamentalsR] = await Promise.all([
    settle(eastmoney.runValuation({ ticker: symbol, market: usedMarket })),
    settle(eastmoney.runIndustry({ secid: industrySecid, startDate: daysAgo(730), endDate: new Date().toISOString().slice(0, 10) })),
    settle(new FundHoldingsConnector({ config, store, fetchImpl }).run({ ticker: symbol, market: usedMarket, limit: 5 })),
    settle(new EastmoneyFundamentalsConnector({ config, store, fetchImpl }).run({ ticker: symbol, market: usedMarket }))
  ]);

  const valuation = valuationR.ok ? valuationR.value : null;
  const industry = industryR.ok ? industryR.value : null;
  const fundHoldings = holdingsR.ok ? holdingsR.value : { status: 'data_missing', funds: [] };
  const fundamentalsRecord = fundamentalsR.ok ? fundamentalsR.value : null;
  const fundamentals = fundamentalsRecord?.metrics || {};

  const rows = store.listPriceRows(symbol);
  const factorResult = rows.length ? computeFactors(rows, { asOf: new Date().toISOString().slice(0, 10) }) : { stocks: [] };
  const priceFactors = factorResult.stocks.find((s) => s.ticker === symbol)?.factors || {};

  const fanli = computeFanliV2({
    price: priceFactors,
    fundamentals,
    valuation: valuation ? valuationScore(valuation) : null,
    cycle: industry ? industryCycleScore(industry) : null
  });

  let probability = { status: 'insufficient_data', rows: rows.length, message: '至少需要约 120 个交易日' };
  if (rows.length >= 120) {
    probability = walkForwardRealProbability(rows, { lookback: 20, horizon: 20, trainWindow: Math.max(80, Math.floor(rows.length * 0.6)), testWindow: 60, nBoot: 60, seed: 42 });
  }

  const backtest = rows.length >= 40 ? runRealBacktest(rows, { lookback: 20 }) : null;

  const drivers = [];
  const risks = [];
  const mom = priceFactors.mom_20d?.raw;
  const vol = priceFactors.vol_20d?.raw;
  const dd = priceFactors.max_drawdown_60d?.raw;
  if (Number.isFinite(mom) && mom > 0) drivers.push('20日动量为正');
  if (Number.isFinite(mom) && mom < 0) risks.push('20日动量为负');
  if (Number.isFinite(valuation?.pe) && valuation.pe < 25) drivers.push(`PE ${valuation.pe} 不高`);
  if (Number.isFinite(valuation?.pb) && valuation.pb > 6) risks.push(`PB ${valuation.pb} 偏高`);
  if (Number.isFinite(industry?.cycle_score) && industry.cycle_score > 0.5) drivers.push('行业景气中等偏上');
  if (Number.isFinite(vol) && vol > 0.3) risks.push('波动率偏高');
  if (Number.isFinite(dd) && dd < -0.15) risks.push('近60日回撤较大');
  if (probability.latest_prediction?.P_positive_return >= 0.5) drivers.push(`历史上涨概率 ${(probability.latest_prediction.P_positive_return * 100).toFixed(1)}%`);
  if (probability.latest_prediction?.P_positive_return < 0.5) risks.push(`历史上涨概率偏低 ${(probability.latest_prediction.P_positive_return * 100).toFixed(1)}%`);

  const worthBuying = computeWorthBuyingProbability({ probability, valuation: valuation || {}, industry: industry || {}, fanli, backtest, risks });
  const fanliSummary = computeFanliSummary({ fanli, worthBuying: worthBuying.P_worth_buying, risks });
  const positionAdvice = computePositionAdvice({
    worth_buying: worthBuying.P_worth_buying,
    fanli,
    risks,
    backtest,
    valuation: valuation || {},
    industry: industry || {},
    capital,
    riskLevel
  });

  const sources = [klineTry.ok ? klineTry.value : null, valuation, industry, fundHoldings].filter(Boolean).map((x) => ({
    source_url: x.source_url,
    retrieved_at: x.retrieved_at,
    confidence: x.confidence,
    source_type: x.source_type || 'official'
  }));

  const dataStatus = {
    price: klineTry.ok ? 'ok' : 'missing',
    valuation: valuationR.ok ? 'ok' : 'missing',
    industry: industryR.ok ? 'ok' : 'missing',
    fund_holdings: holdingsR.ok ? 'ok' : 'missing',
    fundamentals: fundamentalsR.ok ? 'ok' : 'missing'
  };
  const warnings = [];
  if (!klineTry.ok) warnings.push(`行情获取失败：${klineTry.error}`);
  if (!valuationR.ok) warnings.push(`估值获取失败：${valuationR.error}`);
  if (!industryR.ok) warnings.push(`行业景气获取失败：${industryR.error}`);
  if (!holdingsR.ok) warnings.push(`基金持仓获取失败：${holdingsR.error}`);

  return {
    ticker: symbol,
    market: usedMarket,
    name: valuation?.name || symbol,
    as_of: new Date().toISOString().slice(0, 10),
    price: valuation?.price ?? null,
    data_status: dataStatus,
    warnings,
    fanli,
    factors: priceFactors,
    valuation: valuation || { status: 'data_missing' },
    industry_cycle: industry || { status: 'data_missing' },
    fund_holdings: fundHoldings,
    fundamentals: fundamentalsRecord || { status: 'data_missing' },
    probability,
    backtest,
    worth_buying_probability: worthBuying,
    fanli_summary: fanliSummary,
    position_advice: positionAdvice,
    drivers,
    risks,
    sources,
    disclaimer: '本报告仅基于公开数据与历史统计，不构成投资建议；概率非保证。'
  };
}


