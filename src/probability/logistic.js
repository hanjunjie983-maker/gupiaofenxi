import { sigmoid, matVecMul, matMul, transpose, solveLinear, dot } from './math.js';

// 贝叶斯逻辑回归（L2 高斯先验的 MAP 估计，等价 ridge 惩罚）。
// 用 Newton-Raphson（IRLS）求解，适合小特征维度。
export function fitLogistic(X, y, { lambda = 1, maxIter = 100, tol = 1e-6 } = {}) {
  const n = X.length;
  const d = X[0].length;
  let w = new Array(d).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    const p = X.map((row) => sigmoid(dot(row, w)));
    const grad = new Array(d).fill(0);
    for (let j = 0; j < d; j++) {
      let g = 0;
      for (let i = 0; i < n; i++) g += X[i][j] * (y[i] - p[i]);
      grad[j] = g - lambda * w[j];
    }

    // Hessian = X^T W X + lambda I，其中 W=diag(p(1-p))
    const H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let a = 0; a < d; a++) {
      for (let b = 0; b < d; b++) {
        let s = 0;
        for (let i = 0; i < n; i++) s += X[i][a] * X[i][b] * p[i] * (1 - p[i]);
        H[a][b] = s + (a === b ? lambda : 0);
      }
    }

    const delta = solveLinear(H, grad);
    w = w.map((wi, j) => wi + delta[j]);
    const norm = Math.sqrt(delta.reduce((s, x) => s + x * x, 0));
    if (norm < tol) break;
  }

  return {
    weights: w,
    predictLinear(X) {
      return X.map((row) => dot(row, w));
    },
    predictProba(X) {
      return X.map((row) => sigmoid(dot(row, w)));
    },
    coefficients: w.slice()
  };
}
