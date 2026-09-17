import { createHash } from 'node:crypto';
import { BaseConnector } from './base.js';
import { loadConfig } from '../config.js';

// 东方财富机构持股公开接口（基金持仓明细）。非官方、非实时，置信度 0.75。
// 返回按持仓市值排序的基金列表，标注基金名称与基金公司。
export class FundHoldingsConnector extends BaseConnector {
  constructor({ config, store, fetchImpl } = {}) {
    const cfg = config || loadConfig();
    super({ id: 'fund-holdings', meta: {}, store, fetchImpl, config: cfg });
  }

  detailUrl(code, date, page = 1, pageSize = 20, market = 'SH') {
    const mkt = String(market).toUpperCase() === 'SH' ? 1 : 0;
    return `http://datapc.eastmoney.com/emdatacenter/jgcc/holddetaillist?code=${code}&date=${date}&mkt=${mkt}&st=TOTAL_SHARES&sr=-1&p=${page}&ps=${pageSize}`;
  }

  recentQuarterEnds() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const dates = [];
    for (let y = year; y >= year - 2; y--) {
      for (const md of ['12-31', '09-30', '06-30', '03-31']) {
        const d = `${y}-${md}`;
        if (d <= now.toISOString().slice(0, 10)) dates.push(d);
      }
    }
    return dates;
  }

  async run({ ticker, market = 'SH', date, limit = 5 } = {}) {
    const code = String(ticker).replace(/^(sh|sz|bj)\./i, '');
    const candidates = date ? [date] : this.recentQuarterEnds();
    let raw = null;
    let url = null;
    for (const d of candidates) {
      url = this.detailUrl(code, d, 1, Math.max(limit, 20), market);
      raw = await this.request(url, { 'User-Agent': this.config.edgarUserAgent });
      if (raw?.result?.data?.length) break;
      raw = null;
    }
    const rows = raw?.result?.data || [];
    const funds = rows
      .filter((r) => r.ORG_TYPE === '基金' && r.HOLDER_NAME)
      .slice(0, limit)
      .map((r) => ({
        fund_code: r.HOLDER_CODE,
        fund_name: r.HOLDER_NAME,
        fund_company: r.PARENT_ORG_NAME,
        shares: r.TOTAL_SHARES,
        market_cap: r.HOLD_MARKET_CAP,
        shares_ratio: r.TOTAL_SHARES_RATIO,
        report_date: String(r.REPORT_DATE || '').slice(0, 10)
      }));

    const result = {
      source_id: 'fund-holdings',
      source_url: url,
      retrieved_at: new Date().toISOString(),
      field: 'fund_holdings',
      confidence: 0.75,
      source_type: 'public_web_api_unofficial',
      ticker: code,
      report_date: funds[0]?.report_date || null,
      count: funds.length,
      funds,
      raw_sha256: createHash('sha256').update(JSON.stringify(raw)).digest('hex')
    };
    if (this.store) this.store.saveAuditEvent({ actor: 'fund-holdings-connector', action: 'ingest_fund_holdings', resource: code, source_url: url, retrieved_at: result.retrieved_at, confidence: result.confidence, detail: { funds: funds.map((f) => f.fund_name) } });
    return result;
  }
}


