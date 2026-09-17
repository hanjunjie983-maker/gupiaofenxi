import { createHash } from 'node:crypto';
import { BaseConnector } from './base.js';
import { loadConfig } from '../config.js';

// SEC EDGAR is the optimal first connector for M0: official, no API key,
// well documented, and returns structured JSON. It demonstrates the full
// source_url / retrieved_at / field / confidence provenance contract.
export class SecEdgarConnector extends BaseConnector {
  constructor({ config, store, fetchImpl } = {}) {
    const cfg = config || loadConfig();
    super({ id: 'sec-edgar', meta: {}, store, fetchImpl, config: cfg });
    this.userAgent = cfg.edgarUserAgent;
  }

  cikUrl(cik) {
    const normalized = String(cik).padStart(10, '0');
    return `https://data.sec.gov/submissions/CIK${normalized}.json`;
  }

  async run(cik) {
    const url = this.cikUrl(cik);
    const raw = await this.request(url, {
      'User-Agent': this.userAgent,
      'Accept-Encoding': 'gzip, deflate'
    });
    const record = this.normalize(raw, cik, url);
    if (this.store) this.store.saveRecord(record);
    return record;
  }

  normalize(raw, cik, url) {
    const recent = raw?.filings?.recent || {};
    const forms = (recent.form || []).slice(0, 10).map((form, i) => ({
      form,
      filing_date: recent.filingDate?.[i] || null,
      report_date: recent.reportDate?.[i] || null,
      accession_number: recent.accessionNumber?.[i] || null
    })).filter((f) => f.form);

    return {
      source_id: 'sec-edgar',
      source_url: url,
      retrieved_at: new Date().toISOString(),
      field: 'edgar_submissions',
      confidence: 0.9,
      cik: String(cik).padStart(10, '0'),
      name: raw?.name || null,
      tickers: Array.isArray(raw?.tickers) ? raw.tickers : [],
      latest_forms: forms,
      raw_sha256: createHash('sha256').update(JSON.stringify(raw)).digest('hex')
    };
  }
}
