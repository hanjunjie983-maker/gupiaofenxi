// 统计工具箱：MAD 去极值、Z-score、分位数、行业中性化。
// 所有函数都返回「与原数组同长」的结果，不改变样本顺序。

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function finite(values) {
  return values.filter((v) => Number.isFinite(v));
}

// Median Absolute Deviation，k 默认为 3（3*MAD）。
export function winsorize(values, k = 3) {
  const med = median(finite(values));
  if (med === null) return values.slice();
  const absDev = values.map((v) => (Number.isFinite(v) ? Math.abs(v - med) : null));
  const mad = median(finite(absDev));
  if (mad === null || mad === 0) return values.slice();
  const upper = med + k * mad;
  const lower = med - k * mad;
  return values.map((v) => {
    if (!Number.isFinite(v)) return null;
    if (v > upper) return upper;
    if (v < lower) return lower;
    return v;
  });
}

export function mean(values) {
  const f = finite(values);
  if (!f.length) return null;
  return f.reduce((a, b) => a + b, 0) / f.length;
}

export function std(values) {
  const f = finite(values);
  if (!f.length) return null;
  const m = mean(f);
  const variance = f.reduce((a, b) => a + (b - m) ** 2, 0) / f.length;
  return Math.sqrt(variance);
}

// Z-score = (x - mean) / std；std=0 时返回 0，避免除零。
export function zscore(values) {
  const m = mean(values);
  const s = std(values);
  if (m === null || s === null) return values.map(() => null);
  return values.map((v) => (Number.isFinite(v) ? (s === 0 ? 0 : (v - m) / s) : null));
}

// 行业中性化：行业内去均值（简化版）。生产可扩展为行业哑变量回归残差。
export function sectorNeutralize(values, sectors) {
  const groups = new Map();
  values.forEach((v, i) => {
    const sec = sectors[i] || 'UNKNOWN';
    if (!groups.has(sec)) groups.set(sec, []);
    groups.get(sec).push(i);
  });
  const groupMeans = new Map();
  for (const [sec, idxs] of groups) {
    const vals = idxs.map((i) => values[i]).filter((v) => Number.isFinite(v));
    groupMeans.set(sec, mean(vals) ?? 0);
  }
  return values.map((v, i) => {
    if (!Number.isFinite(v)) return null;
    const sec = sectors[i] || 'UNKNOWN';
    return v - groupMeans.get(sec);
  });
}
