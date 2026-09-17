// XBRL 公司事实 tag 映射（草稿）。同义 tag 按优先级选择，避免旧 tag 命中导致周期失真。
export const CANDIDATE_TAGS = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'Revenues', 'SalesRevenueNet'],
  net_income: ['NetIncomeLoss', 'ProfitLoss'],
  equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  assets: ['Assets'],
  liabilities: ['Liabilities'],
  gross_profit: ['GrossProfit'],
  cost_of_revenue: ['CostOfRevenue', 'CostOfGoodsAndServicesSold'],
  operating_cash_flow: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment']
};

function compareEndDesc(a, b) {
  if (a.end < b.end) return 1;
  if (a.end > b.end) return -1;
  return 0;
}

// 从候选 tag 中取最新 10-K 美元值；返回 {tag, value, filed, end, fy, fp}。
export function pickLatest(raw, candidates) {
  let best = null;
  for (const tag of candidates) {
    const fact = raw?.facts?.['us-gaap']?.[tag];
    if (!fact) continue;
    const usd = fact.units?.USD;
    if (!Array.isArray(usd)) continue;
    const annual = usd.filter((r) => r.form === '10-K' && Number.isFinite(r.val));
    if (!annual.length) continue;
    annual.sort(compareEndDesc);
    const latest = annual[0];
    if (!best || latest.end > best.end) best = { tag, ...latest };
  }
  return best;
}
