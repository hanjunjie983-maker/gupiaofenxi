import { analyzeTicker } from '../analysis/analyzer.js';

export const DEFAULT_WORTH_BUYING_TICKERS = ['600519', '000858', '601318', '600036', '000333', '300750', '002594', '601888', '600900', '000001'];
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function getWorthBuyingRanking({ tickers = DEFAULT_WORTH_BUYING_TICKERS, store, config, fetchImpl } = {}) {
  const list = [...new Set(tickers.map((t) => String(t).trim()).filter(Boolean))].slice(0, 12);
  const key = list.join(',');
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return { ...cached.value, cached: true };

  const rows = await mapLimit(list, 2, async (ticker) => {
    try {
      const report = await analyzeTicker({ ticker, store, config, fetchImpl });
      return {
        ticker: report.ticker,
        name: report.name,
        price: report.price,
        P_worth_buying: report.worth_buying_probability?.P_worth_buying ?? null,
        P_worth_buying_heuristic: report.worth_buying_probability?.P_worth_buying_heuristic ?? null,
        calibrated: report.worth_buying_probability?.calibrated ?? false,
        calibration: report.worth_buying_probability?.calibration || null,
        confidence_interval: report.worth_buying_probability?.confidence_interval || null,
        fanli_score: report.fanli?.fanli_score ?? null,
        P_positive_return: report.probability?.latest_prediction?.P_positive_return ?? null,
        backtest_sharpe: report.backtest?.metrics?.sharpe ?? null,
        pe: report.valuation?.pe ?? null,
        roe: report.fundamentals?.metrics?.roe ?? null,
        roic: report.fundamentals?.metrics?.roic ?? null,
        gross_margin: report.fundamentals?.metrics?.gross_margin ?? null,
        pb: report.valuation?.pb ?? null,
        risks: report.risks || [],
        suggestion: report.position_advice?.suggestion || null,
        fanli_summary: report.fanli_summary || null,
        stock_type: report.position_advice?.stock_type || null,
        suggested_position_pct: report.position_advice?.suggested_position_pct ?? null,
        suggested_amount: report.position_advice?.suggested_amount ?? null,
        fund_holdings: report.fund_holdings ? { status: 'ok', report_date: report.fund_holdings.report_date, funds: report.fund_holdings.funds?.map((f) => ({ fund_name: f.fund_name, fund_company: f.fund_company, shares_ratio: f.shares_ratio })) || [] } : { status: 'data_missing' },
        as_of: report.as_of
      };
    } catch (err) {
      return { ticker, error: err.message };
    }
  });

  const results = rows.filter((r) => !r.error).sort((a, b) => (b.P_worth_buying ?? -1) - (a.P_worth_buying ?? -1));
  const value = { as_of: new Date().toISOString().slice(0, 10), requested: list, count: results.length, results, errors: rows.filter((r) => r.error), note: '值得买概率为研究用合成指标，不构成投资建议。' };
  cache.set(key, { at: Date.now(), value });
  return { ...value, cached: false };
}

export async function getDailyRecommendations(args = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `daily:${today}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < 24 * 60 * 60 * 1000) return { ...cached.value, cached: true };
  const ranking = await getWorthBuyingRanking({ ...args, tickers: DEFAULT_WORTH_BUYING_TICKERS });
  const value = { ...ranking, date: today, title: '每日值得看十支（研究用排名）', note: '排名基于校准后的研究用值得买概率，不构成投资建议。基金持仓需授权数据源。' };
  cache.set(key, { at: Date.now(), value });
  return { ...value, cached: false };
}




