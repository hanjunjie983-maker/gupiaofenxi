import { createHash } from 'node:crypto';
import { BaseConnector } from './base.js';
import { loadConfig } from '../config.js';

// 东方财富 F10 主要财务指标（公开 HTTP，非官方，置信度 0.75）。
// 用于补齐范蠡六维中的「完物质量」「无息币周转」「待乏需求」。
export class EastmoneyFundamentalsConnector extends BaseConnector {
  constructor({ config, store, fetchImpl } = {}) {
    const cfg = config || loadConfig();
    super({ id: 'eastmoney-fundamentals', meta: {}, store, fetchImpl, config: cfg });
  }

  secucode(ticker, market = 'SH') {
    const t = String(ticker).replace(/^(sh|sz|bj)\./i, '');
    const suffix = String(market).toUpperCase() === 'SH' ? 'SH' : String(market).toUpperCase() === 'BJ' ? 'BJ' : 'SZ';
    return `${t}.${suffix}`;
  }

  url(secucode) {
    return `https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=ALL&filter=(SECUCODE=%22${secucode}%22)&pageNumber=1&pageSize=8&sortColumns=REPORT_DATE&sortTypes=-1`;
  }

  async run({ ticker, market = 'SH' } = {}) {
    const secucode = this.secucode(ticker, market);
    const url = this.url(secucode);
    const raw = await this.request(url, { 'User-Agent': this.config.edgarUserAgent, 'Referer': 'https://emweb.securities.eastmoney.com/' });
    const row = raw?.result?.data?.[0];
    if (!row) throw new Error(`no fundamentals for ${secucode}`);
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    const revenue = num(row.TOTALOPERATEREVE);
    const fcff = num(row.FCFF_FORWARD) ?? num(row.FCFF_BACK);
    const result = {
      source_id: 'eastmoney-fundamentals',
      source_url: url,
      retrieved_at: new Date().toISOString(),
      field: 'eastmoney_financial_main',
      confidence: 0.75,
      source_type: 'public_web_api_unofficial',
      ticker: String(ticker).replace(/^(sh|sz|bj)\./i, ''),
      name: row.SECURITY_NAME_ABBR || null,
      report_date: String(row.REPORT_DATE || '').slice(0, 10),
      notice_date: String(row.NOTICE_DATE || '').slice(0, 10),
      metrics: {
        roe: num(row.ROEJQ),
        roic: num(row.ROIC),
        gross_margin: num(row.XSMLL),
        debt_ratio: num(row.ZCFZL),
        cash_ratio: num(row.CASH_RATIO),
        operating_cashflow_to_revenue: num(row.JYXJLYYSR),
        total_asset_turnover: num(row.TOAZZL),
        operate_cycle: num(row.OPERATE_CYCLE),
        revenue_growth: num(row.TOTALOPERATEREVETZ),
        profit_growth: num(row.PARENTNETPROFITTZ),
        fcff,
        fcf_margin: revenue && fcff !== null ? fcff / revenue : null
      },
      raw_sha256: createHash('sha256').update(JSON.stringify(raw)).digest('hex')
    };
    if (this.store) this.store.saveAuditEvent({ actor: 'eastmoney-fundamentals', action: 'ingest_financial_main', resource: secucode, source_url: url, retrieved_at: result.retrieved_at, confidence: result.confidence, detail: { report_date: result.report_date } });
    return result;
  }
}
