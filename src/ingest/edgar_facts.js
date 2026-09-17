import { createHash } from 'node:crypto';
import { BaseConnector } from './base.js';
import { loadConfig } from '../config.js';
import { CANDIDATE_TAGS, pickLatest } from '../factors/xbrl_map.js';
import { pitEffectiveDate } from '../factors/point_in_time.js';

// SEC EDGAR Company Facts（XBRL 公司事实）官方接口。无 key、结构化 JSON。
// 只取 us-gaap 年度值（10-K），用于计算基本面质量因子。
export class SecCompanyFactsConnector extends BaseConnector {
  constructor({ config, store, fetchImpl } = {}) {
    const cfg = config || loadConfig();
    super({ id: 'sec-edgar-facts', meta: {}, store, fetchImpl, config: cfg });
    this.userAgent = cfg.edgarUserAgent;
  }

  factsUrl(cik) {
    return `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`;
  }

  async run(cik) {
    const url = this.factsUrl(cik);
    const raw = await this.request(url, { 'User-Agent': this.userAgent, 'Accept-Encoding': 'gzip, deflate' });
    const record = this.normalize(raw, cik, url);
    if (this.store) this.store.saveRecord(record);
    return record;
  }

  // 取某 tag 的年度美元值（最新优先）。
  latestAnnual(raw, tag) {
    const fact = raw?.facts?.['us-gaap']?.[tag];
    if (!fact) return null;
    const usd = fact.units?.USD;
    if (!Array.isArray(usd)) return null;
    const annual = usd
      .filter((r) => r.form === '10-K' && Number.isFinite(r.val))
      .sort((a, b) => (a.end < b.end ? 1 : -1));
    return annual.length ? annual[0] : null;
  }

  val(annual) {
    return annual ? annual.val : null;
  }

  normalize(raw, cik, url) {
    const pick = (key) => pickLatest(raw, CANDIDATE_TAGS[key]);

    const rev = pick('revenue');
    const ni = pick('net_income');
    const eq = pick('equity');
    const ast = pick('assets');
    const lia = pick('liabilities');
    const gp = pick('gross_profit');
    const cor = pick('cost_of_revenue');
    const ocf = pick('operating_cash_flow');
    const cap = pick('capex');

    const revenue = rev?.val ?? null;
    const netIncome = ni?.val ?? null;
    const equity = eq?.val ?? null;
    const assets = ast?.val ?? null;
    const liabilities = lia?.val ?? null;
    const grossProfit = gp?.val ?? null;
    const costOfRevenue = cor?.val ?? null;
    const operatingCashFlow = ocf?.val ?? null;
    const capex = cap?.val ?? null;

    const roe = equity ? netIncome / equity : null;
    const roa = assets ? netIncome / assets : null;
    const grossMargin = revenue ? (grossProfit ?? (revenue - (costOfRevenue || 0))) / revenue : null;
    const debtRatio = assets ? liabilities / assets : null;
    const fcf = operatingCashFlow !== null && capex !== null ? operatingCashFlow - capex : null;
    const fcfMargin = revenue ? fcf / revenue : null;

    const filed = rev?.filed || null;
    return {
      source_id: 'sec-edgar-facts',
      source_url: url,
      retrieved_at: new Date().toISOString(),
      field: 'edgar_company_facts',
      confidence: 0.9,
      cik: String(cik).padStart(10, '0'),
      entity_name: raw?.entityName || null,
      period_end: rev?.end || null,
      filed_date: filed,
      effective_date: filed ? pitEffectiveDate(filed, []) : null,
      tag_used: { revenue: rev?.tag || null, net_income: ni?.tag || null, equity: eq?.tag || null, assets: ast?.tag || null, liabilities: lia?.tag || null, gross_profit: gp?.tag || null, cost_of_revenue: cor?.tag || null, operating_cash_flow: ocf?.tag || null, capex: cap?.tag || null },
      metrics: { revenue, net_income: netIncome, equity, assets, liabilities, gross_profit: grossProfit, cost_of_revenue: costOfRevenue, operating_cash_flow: operatingCashFlow, capex },
      ratios: { roe, roa, gross_margin: grossMargin, debt_ratio: debtRatio, fcf, fcf_margin: fcfMargin },
      raw_sha256: createHash('sha256').update(JSON.stringify(raw)).digest('hex')
    };
  }
}

