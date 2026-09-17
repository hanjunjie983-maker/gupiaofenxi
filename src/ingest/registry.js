// Source registry: official sources first, non-official sources are
// cross-check only. `status` reflects whether a runnable connector exists yet.
export const SOURCES = [
  {
    id: 'sec-edgar',
    name: 'SEC EDGAR',
    market: 'US',
    type: 'official',
    url: 'https://data.sec.gov/submissions/',
    confidence: 0.9,
    status: 'configured'
  },
  {
    id: 'baostock',
    name: 'Baostock',
    market: 'CN',
    type: 'open_source',
    url: 'http://www.baostock.com/',
    confidence: 0.85,
    status: 'configured'
  },
  {
    id: 'eastmoney',
    name: '东方财富公开接口',
    market: 'CN',
    type: 'public_web_api_unofficial',
    url: 'https://push2his.eastmoney.com/',
    confidence: 0.7,
    status: 'configured'
  },
  {
    id: 'tushare',
    name: 'Tushare Pro',
    market: 'CN',
    type: 'licensed',
    url: 'http://api.tushare.pro',
    confidence: null,
    status: 'not_configured'
  },
  {
    id: 'cninfo',
    name: '巨潮资讯',
    market: 'CN',
    type: 'official',
    url: 'http://www.cninfo.com.cn/',
    confidence: null,
    status: 'not_configured'
  },
  {
    id: 'hkexnews',
    name: 'HKEXnews 披露易',
    market: 'HK',
    type: 'official',
    url: 'https://www1.hkexnews.hk/',
    confidence: null,
    status: 'not_configured'
  },
  {
    id: 'fred',
    name: 'FRED',
    market: 'GLOBAL',
    type: 'official',
    url: 'https://fred.stlouisfed.org/',
    confidence: null,
    status: 'not_configured'
  }
];

export function findSource(id) {
  return SOURCES.find((s) => s.id === id) || null;
}

