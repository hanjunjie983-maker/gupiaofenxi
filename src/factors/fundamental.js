// 基本面质量因子：从财报指标计算并归一化为因子对象。
export function fundamentalFactors(ratios = {}) {
  return {
    roe: ratios.roe ?? null,
    roa: ratios.roa ?? null,
    gross_margin: ratios.gross_margin ?? null,
    debt_ratio: ratios.debt_ratio ?? null,
    fcf: ratios.fcf ?? null,
    fcf_margin: ratios.fcf_margin ?? null
  };
}

export function mergeFactorSets(priceFactors = {}, fundamentals = {}) {
  const merged = {};
  for (const [k, v] of Object.entries(priceFactors)) merged[k] = v;
  for (const [k, v] of Object.entries(fundamentals)) merged[k] = { raw: v, winsorized: null, zscore: null };
  return merged;
}
