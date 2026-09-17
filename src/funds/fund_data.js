import { createHash } from 'node:crypto';
import { withRetry } from '../util/retry.js';

function extractVar(text, name) {
  const re = new RegExp(`var\\s+${name}\\s*=\\s*([^;]+);`);
  const m = text.match(re);
  return m ? m[1] : null;
}

function parseJsonVar(text, name) {
  const raw = extractVar(text, name);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

export function parsePingzhong(text) {
  const name = stripTags(extractVar(text, 'fS_name') || '').replace(/^"|"$/g, '');
  const netWorthTrend = parseJsonVar(text, 'Data_netWorthTrend') || [];
  const assetAllocation = parseJsonVar(text, 'Data_assetAllocation') || [];
  const manager = parseJsonVar(text, 'Data_currentFundManager') || [];
  const num = (name) => {
    const raw = extractVar(text, name);
    const v = raw ? Number(String(raw).replace(/"/g, '')) : NaN;
    return Number.isFinite(v) ? v : null;
  };
  return {
    name,
    returns: { oneMonth: num('syl_1y'), threeMonth: num('syl_3y'), sixMonth: num('syl_6y'), oneYear: num('syl_1n') },
    netWorthTrend,
    assetAllocation,
    manager,
    performanceEvaluation: name ? null : null
  };
}

export function parseHoldings(text) {
  const reportMatch = text.match(/截止至：<font[^>]*>([^<]+)<\/font>/);
  const reportDate = reportMatch ? reportMatch[1].trim() : null;
  const rows = text.match(/<tr>[\s\S]*?<\/tr>/g) || [];
  const holdings = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
    if (cells.length < 5) continue;
    const seq = Number(cells[0]);
    if (!Number.isFinite(seq)) continue;
    const code = cells[1];
    const name = cells[2];
    const weight = Number(String(cells[4]).replace('%', ''));
    if (!/^\d{6}$/.test(code) || !Number.isFinite(weight)) continue;
    holdings.push({ code, name, weight: weight / 100 });
  }
  return { reportDate, holdings };
}

export class FundDataConnector {
  constructor({ fetchImpl = globalThis.fetch, userAgent = 'FanliQuant/1.0 (research)' } = {}) {
    this.fetchImpl = fetchImpl;
    this.userAgent = userAgent;
  }

  async fetchText(url) {
    return withRetry(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await this.fetchImpl(url, { headers: { 'User-Agent': this.userAgent, 'Referer': 'https://fund.eastmoney.com/' }, signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return await res.text();
      } finally { clearTimeout(timer); }
    }, { maxAttempts: 3, baseDelayMs: 500, jitter: 0.25 });
  }

  async run({ code }) {
    const fundCode = String(code).replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(fundCode)) throw new Error('fund code must be 6 digits');
    const infoUrl = `https://fund.eastmoney.com/pingzhongdata/${fundCode}.js`;
    const info = await this.fetchText(infoUrl);
    const parsed = parsePingzhong(info);

    let holdings = { reportDate: null, holdings: [] };
    const years = [new Date().getFullYear(), new Date().getFullYear() - 1];
    for (const year of years) {
      const url = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${fundCode}&topline=10&year=${year}`;
      const text = await this.fetchText(url);
      const parsedHoldings = parseHoldings(text);
      if (parsedHoldings.holdings.length) { holdings = parsedHoldings; break; }
    }

    return {
      source_id: 'eastmoney-fund',
      source_url: infoUrl,
      holdings_source_url: `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${fundCode}&topline=10`,
      retrieved_at: new Date().toISOString(),
      field: 'eastmoney_fund_data',
      confidence: 0.75,
      source_type: 'public_web_api_unofficial',
      code: fundCode,
      name: parsed.name || fundCode,
      returns: parsed.returns,
      net_worth_trend: parsed.netWorthTrend,
      asset_allocation: parsed.assetAllocation,
      manager: parsed.manager,
      holdings: holdings.holdings,
      holdings_report_date: holdings.reportDate,
      raw_sha256: createHash('sha256').update(info + JSON.stringify(holdings)).digest('hex')
    };
  }
}
