import { createHash } from 'node:crypto';
import { BaseConnector } from './base.js';
import { loadConfig } from '../config.js';
import { std } from '../probability/math.js';

// 东方财富公开 HTTP JSON 接口（研究/验证用途，非官方、非实时交易接口）。
// 官方 Baostock sidecar 仍是首选；本连接器用于无 Python 环境下接入真实 A股行情。
export class EastmoneyConnector extends BaseConnector {
  constructor({ config, store, fetchImpl } = {}) {
    const cfg = config || loadConfig();
    super({ id: 'eastmoney', meta: {}, store, fetchImpl, config: cfg });
  }

  secid(ticker, market = 'SH') {
    const m = String(ticker).replace(/^(sh|sz|bj)\./i, '');
    const prefix = String(market).toUpperCase() === 'SH' ? '1' : '0';
    return `${prefix}.${m}`;
  }

  klineUrl(secid, startDate, endDate, fqt = 1) {
    return `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=${fqt}&beg=${startDate.replace(/-/g, '')}&end=${endDate.replace(/-/g, '')}`;
  }

  valuationUrl(secid) {
    return `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f57,f58,f116,f117,f162,f167,f168,f169,f170`;
  }

  async run({ ticker, market = 'SH', startDate = '2024-01-01', endDate = new Date().toISOString().slice(0, 10), adjust = 'qfq' } = {}) {
    const secid = this.secid(ticker, market);
    const fqt = adjust === 'hfq' ? 2 : adjust === 'none' ? 0 : 1;
    const url = this.klineUrl(secid, startDate, endDate, fqt);
    const raw = await this.request(url, { 'User-Agent': this.config.edgarUserAgent });
    const rows = this.normalizeKlines(raw, ticker, market, fqt);
    const result = {
      source_id: 'eastmoney',
      source_url: url,
      retrieved_at: new Date().toISOString(),
      field: 'eastmoney_daily_kline',
      confidence: 0.7,
      source_type: 'public_web_api_unofficial',
      ticker: String(ticker).replace(/^(sh|sz|bj)\./i, ''),
      market: String(market).toUpperCase(),
      rows: rows.length,
      first_row: rows[0] || null,
      last_row: rows[rows.length - 1] || null,
      raw_sha256: createHash('sha256').update(JSON.stringify(raw)).digest('hex')
    };
    if (this.store) {
      this.store.savePriceRows(rows);
      this.store.saveRun({ source_id: 'eastmoney', status: 'ok', retrieved_at: result.retrieved_at, confidence: result.confidence, rows: rows.length, error: null, retry_count: 0, next_run_at: new Date(Date.now() + 300000).toISOString() });
      this.store.saveAuditEvent({ actor: 'eastmoney-connector', action: 'ingest_daily_kline', resource: secid, source_url: url, retrieved_at: result.retrieved_at, confidence: result.confidence, detail: { rows: rows.length } });
    }
    return result;
  }

  normalizeKlines(raw, ticker, market, fqt = 1) {
    const lines = raw?.data?.klines || [];
    const symbol = String(ticker).replace(/^(sh|sz|bj)\./i, '');
    const exchange = String(market).toUpperCase() === 'SH' ? 'SH' : String(market).toUpperCase() === 'BJ' ? 'BJ' : 'SZ';
    return lines.map((line) => {
      const [date, open, close, high, low, volume, amount, amplitude, pctChg, change, turnover] = line.split(',');
      return {
        ticker: symbol, exchange, trade_date: date,
        open: Number(open), high: Number(high), low: Number(low), close: Number(close),
        preclose: Number((Number(close) - Number(change)).toFixed(4)),
        adj_close: Number(close), volume: Number(volume), amount: Number(amount),
        turnover: Number(turnover), pct_chg: Number(pctChg),
        tradestatus: '1', is_st: '0', adjustflag: String(adjustFlagFromFqt(fqt))
      };
    }).filter((r) => Number.isFinite(r.close) && r.close > 0);
  }

  async runValuation({ ticker, market = 'SH' } = {}) {
    const secid = this.secid(ticker, market);
    const url = this.valuationUrl(secid);
    const raw = await this.request(url, { 'User-Agent': this.config.edgarUserAgent });
    const d = raw?.data || {};
    const result = {
      source_id: 'eastmoney-valuation',
      source_url: url,
      retrieved_at: new Date().toISOString(),
      field: 'eastmoney_valuation_snapshot',
      confidence: 0.7,
      source_type: 'public_web_api_unofficial',
      ticker: String(ticker).replace(/^(sh|sz|bj)\./i, ''),
      name: d.f58 || null,
      price: d.f43 !== undefined ? d.f43 / 100 : null,
      pe: d.f162 !== undefined ? d.f162 / 100 : null,
      pb: d.f167 !== undefined ? d.f167 / 100 : null,
      market_cap: d.f116 ?? null,
      raw_sha256: createHash('sha256').update(JSON.stringify(raw)).digest('hex')
    };
    if (this.store) this.store.saveAuditEvent({ actor: 'eastmoney-connector', action: 'ingest_valuation', resource: secid, source_url: url, retrieved_at: result.retrieved_at, confidence: result.confidence, detail: { pe: result.pe, pb: result.pb } });
    return result;
  }

  async runIndustry({ secid = '90.BK0477', startDate = '2024-01-01', endDate = new Date().toISOString().slice(0, 10) } = {}) {
    const url = this.klineUrl(secid, startDate, endDate, 1);
    const raw = await this.request(url, { 'User-Agent': this.config.edgarUserAgent });
    const lines = raw?.data?.klines || [];
    const closes = lines.map((l) => Number(l.split(',')[2])).filter(Number.isFinite);
    const rets = closes.slice(1).map((c, i) => c / closes[i] - 1);
    const mom20 = closes.length >= 21 ? closes[closes.length - 1] / closes[closes.length - 21] - 1 : null;
    const mom60 = closes.length >= 61 ? closes[closes.length - 1] / closes[closes.length - 61] - 1 : null;
    const vol20 = rets.length >= 10 ? (std(rets.slice(-20)) ?? 0) * Math.sqrt(252) : null;
    const rawScore = (mom20 ?? 0) * 4 + (mom60 ?? 0) * 2 - (vol20 ?? 0) * 0.5;
    const cycleScore = Math.max(0, Math.min(1, 0.5 + rawScore));
    return {
      source_id: 'eastmoney-industry',
      source_url: url,
      retrieved_at: new Date().toISOString(),
      field: 'eastmoney_industry_cycle',
      confidence: 0.65,
      source_type: 'public_web_api_unofficial',
      secid,
      name: raw?.data?.name || null,
      momentum_20d: mom20,
      momentum_60d: mom60,
      volatility_20d: vol20,
      cycle_score: cycleScore,
      raw_sha256: createHash('sha256').update(JSON.stringify(raw)).digest('hex')
    };
  }
}

function adjustFlagFromFqt(fqt) {
  return fqt === 2 ? '1' : fqt === 0 ? '3' : '2';
}

