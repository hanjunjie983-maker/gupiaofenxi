// 数据源切换/路由：official_first 优先官方/持牌源，其次公开源；public_only 仅公开源。
export const SOURCE_TIERS = {
  official: ['tushare', 'baostock', 'cninfo', 'hkexnews', 'sec-edgar', 'sec-edgar-facts', 'fred'],
  public: ['eastmoney'],
  licensed: ['tushare']
};

export function getRoutingPlan(config = {}) {
  const mode = config.sourceMode || 'official_first';
  const order = mode === 'public_only' ? [...SOURCE_TIERS.public, ...SOURCE_TIERS.official]
    : mode === 'licensed_only' ? [...SOURCE_TIERS.licensed]
    : [...SOURCE_TIERS.official, ...SOURCE_TIERS.public];
  const kinds = {
    cn_equity_daily: ['baostock', 'eastmoney'],
    us_filings: ['sec-edgar', 'sec-edgar-facts'],
    valuation: ['eastmoney'],
    industry_cycle: ['eastmoney'],
    macro: ['fred']
  };
  const routes = {};
  for (const [kind, candidates] of Object.entries(kinds)) {
    const ordered = order.filter((s) => candidates.includes(s));
    routes[kind] = { preferred: ordered[0] || null, candidates: ordered.length ? ordered : candidates, mode };
  }
  return { mode, order, routes };
}

export function chooseSource(kind, config = {}) {
  return getRoutingPlan(config).routes[kind]?.preferred || null;
}
