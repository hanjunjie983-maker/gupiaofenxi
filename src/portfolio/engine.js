import {
  generateSyntheticInputs, riskParityWeights, kellyPortfolio, capWeights,
  applyCvarCap, riskContributions, historicalCvar
} from './risk.js';

export function optimizePortfolio(input = {}) {
  const data = input.data || generateSyntheticInputs({
    tickers: input.tickers || 8,
    periods: input.periods || 252,
    seed: input.seed || 42
  });
  const { tickers, returns_history: returnsHistory, vols, covariance } = data;
  const n = tickers.length;

  const probs = input.probabilities || tickers.map(() => 0.55);
  const odds = input.odds || tickers.map(() => 1);
  const fraction = input.kelly_fraction ?? 0.25;
  const maxWeight = input.max_weight ?? 0.2;
  const blend = input.blend ?? 0.7; // 风险平价权重占比

  const wRiskParity = riskParityWeights(vols);
  const wKelly = kellyPortfolio(probs, odds, { fraction });

  const wBlend = tickers.map((_, i) => blend * wRiskParity[i] + (1 - blend) * wKelly[i]);
  const wCapped = capWeights(wBlend, maxWeight);

  const cvarResult = applyCvarCap(wCapped, returnsHistory, {
    alpha: input.alpha ?? 0.95,
    maxCvar: input.max_cvar ?? 0.04
  });

  const finalWeights = cvarResult.weights;
  const cash = cvarResult.cash;
  const allTickers = cash > 1e-9 ? [...tickers, 'CASH'] : tickers;
  const allWeights = cash > 1e-9 ? [...finalWeights, cash] : finalWeights;

  // 风险贡献只针对风险资产；CASH 风险为 0。
  const riskyContrib = riskContributions(finalWeights, vols);

  const current = input.current_weights || {};
  const plan = allTickers.map((t, i) => {
    const target = allWeights[i];
    const cur = t === 'CASH' ? (current.CASH ?? 0) : (current[t] ?? 0);
    const delta = target - cur;
    return { ticker: t, current_weight: cur, target_weight: target, delta };
  }).filter((p) => Math.abs(p.delta) > (input.threshold ?? 0.001));

  const portfolioReturns = returnsHistory.map((row) => row.reduce((s, r, i) => s + r * finalWeights[i], 0));

  return {
    tickers: allTickers,
    weights: allWeights,
    risk_parity_weights: wRiskParity,
    kelly_weights: wKelly,
    blend,
    max_weight: maxWeight,
    kelly_fraction: fraction,
    cvar: cvarResult.cvar,
    cvar_cap: input.max_cvar ?? 0.04,
    cash_weight: cash,
    risk_contributions: riskyContrib,
    portfolio_vol: Math.sqrt(finalWeights.reduce((s, w, i) => s + w * w * vols[i] * vols[i], 0)),
    rebalance_plan: plan,
    method: 'inverse_volatility_risk_parity + fractional_kelly + cvar_cap',
    synthetic: !input.data
  };
}
