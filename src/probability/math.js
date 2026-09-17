// 概率引擎数学工具箱：确定性 PRNG、sigmoid、矩阵求解、分位数等。
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

export function logit(p) {
  const eps = 1e-6;
  const x = Math.min(Math.max(p, eps), 1 - eps);
  return Math.log(x / (1 - x));
}

export function mean(values) {
  const f = values.filter((v) => Number.isFinite(v));
  if (!f.length) return null;
  return f.reduce((a, b) => a + b, 0) / f.length;
}

export function std(values) {
  const m = mean(values);
  if (m === null) return null;
  const f = values.filter((v) => Number.isFinite(v));
  if (!f.length) return null;
  const v = f.reduce((a, b) => a + (b - m) ** 2, 0) / f.length;
  return Math.sqrt(v);
}

export function dot(a, b) {
  return a.reduce((s, x, i) => s + x * b[i], 0);
}

export function matVecMul(A, v) {
  return A.map((row) => dot(row, v));
}

export function transpose(A) {
  const rows = A.length;
  const cols = A[0].length;
  const T = Array.from({ length: cols }, () => new Array(rows));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) T[j][i] = A[i][j];
  }
  return T;
}

export function matMul(A, B) {
  const BT = transpose(B);
  return A.map((row) => BT.map((col) => dot(row, col)));
}

// 解线性方程组 Ax = b（高斯消元，带部分主元）。d 很小，用于牛顿法求权重。
export function solveLinear(A, b) {
  const n = A.length;
  const M = A.map((row, i) => row.slice().concat(b[i]));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) continue;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const d = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map((row) => row[n]);
}

export function quantile(values, q) {
  const f = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!f.length) return null;
  const pos = (f.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return f[lo];
  return f[lo] + (f[hi] - f[lo]) * (pos - lo);
}
