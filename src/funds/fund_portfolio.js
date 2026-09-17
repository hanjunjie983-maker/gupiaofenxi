import { getDailyFundRanking } from './fund_ranking.js';

const PROFILES = {
  conservative: { label: '保守型', count: 3, maxWeight: 0.40, cashWeight: 0.20, note: '以稳健和低波动为主，基金数量少一些。' },
  balanced: { label: '稳健型', count: 4, maxWeight: 0.35, cashWeight: 0.10, note: '兼顾稳健和增长，选前几名基金分散配置。' },
  aggressive: { label: '进取型', count: 5, maxWeight: 0.30, cashWeight: 0.05, note: '更看重增长和动量，允许更高波动。' }
};

function capWeights(items, maxWeight) {
  const out = items.map((x) => ({ ...x }));
  let changed = true;
  while (changed) {
    changed = false;
    const over = out.filter((x) => x.weight > maxWeight);
    if (!over.length) break;
    let excess = 0;
    for (const x of over) { excess += x.weight - maxWeight; x.weight = maxWeight; }
    const under = out.filter((x) => x.weight < maxWeight);
    const sum = under.reduce((s, x) => s + x.weight, 0) || 1;
    for (const x of under) x.weight += excess * (x.weight / sum);
    changed = true;
  }
  return out;
}

export function suggestFundPortfolio({ funds = [], capital = 1000000, riskLevel = 'balanced' }) {
  const profile = PROFILES[riskLevel] || PROFILES.balanced;
  const selected = funds.slice(0, profile.count);
  const scoreSum = selected.reduce((s, f) => s + (f.fund_score || 0), 0) || 1;
  const riskyBudget = capital * (1 - profile.cashWeight);
  let items = selected.map((f) => ({ code: f.code, name: f.name, score: f.fund_score, action: f.action, weight: ((f.fund_score || 0) / scoreSum) * (1 - profile.cashWeight), amount: 0 }));
  items = capWeights(items, profile.maxWeight);
  for (const x of items) x.amount = Math.round(capital * x.weight);
  const riskyAmount = items.reduce((s, x) => s + x.amount, 0);
  const cashAmount = capital - riskyAmount;
  return {
    capital,
    risk_level: riskLevel,
    profile: profile.label,
    note: profile.note,
    funds: items,
    cash: { weight: Number((cashAmount / capital).toFixed(4)), amount: cashAmount },
    plain_summary: `按 ${profile.label} 来配，建议买 ${items.length} 只基金，合计约 ${((riskyAmount / capital) * 100).toFixed(0)}%，现金留 ${((cashAmount / capital) * 100).toFixed(0)}%。这只是研究建议，不保证收益。`,
    disclaimer: '基金构成建议为研究模型输出，不构成投资建议，不承诺收益。'
  };
}

export async function getFundPortfolio({ store, config, fetchImpl, capital = 1000000, riskLevel = 'balanced' } = {}) {
  const ranking = await getDailyFundRanking({ store, config, fetchImpl, capital, riskLevel });
  return suggestFundPortfolio({ funds: ranking.results, capital, riskLevel });
}
