// 估值分位草稿评分：PE/PB 越低越高分。真实分位需要历史估值序列，这里先用绝对带启发式。
export function valuationScore({ pe, pb } = {}) {
  const peScore = Number.isFinite(pe) ? Math.min(1, Math.max(0, (40 - pe) / 35)) : null;
  const pbScore = Number.isFinite(pb) ? Math.min(1, Math.max(0, (8 - pb) / 7)) : null;
  const vals = [peScore, pbScore].filter((v) => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function industryCycleScore(record = {}) {
  return Number.isFinite(record.cycle_score) ? record.cycle_score : null;
}
