import { fitLogistic } from './logistic.js';
import { mean } from './math.js';

export function brierScore(preds, labels) {
  return mean(preds.map((p, i) => (p - labels[i]) ** 2));
}

// Platt scaling：在模型线性分数 s 上拟合一元逻辑回归，输出校准概率。
export function plattCalibrate(scores, labels) {
  const X = scores.map((s) => [1, s]);
  const model = fitLogistic(X, labels, { lambda: 1, maxIter: 200, tol: 1e-8 });
  return {
    type: 'platt',
    predict(score) {
      const z = model.weights[0] + model.weights[1] * score;
      return 1 / (1 + Math.exp(-z));
    }
  };
}

// Isotonic regression（PAV）。返回单调非降的阶梯函数。
export function isotonicCalibrate(scores, labels) {
  const idx = scores.map((_, i) => i).sort((a, b) => scores[a] - scores[b]);
  const sortedScores = idx.map((i) => scores[i]);
  const sortedLabels = idx.map((i) => labels[i]);

  let blocks = sortedScores.map((s, i) => ({ x: s, w: 1, y: sortedLabels[i] }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < blocks.length - 1; i++) {
      if (blocks[i].y > blocks[i + 1].y) {
        const w = blocks[i].w + blocks[i + 1].w;
        const y = (blocks[i].y * blocks[i].w + blocks[i + 1].y * blocks[i + 1].w) / w;
        const x = (blocks[i].x * blocks[i].w + blocks[i + 1].x * blocks[i + 1].w) / w;
        blocks.splice(i, 2, { x, w, y });
        changed = true;
        break;
      }
    }
  }

  const thresholds = blocks.map((b) => b.x);
  const values = blocks.map((b) => b.y);
  return {
    type: 'isotonic',
    predict(score) {
      if (score <= thresholds[0]) return values[0];
      for (let i = 0; i < thresholds.length - 1; i++) {
        if (score <= thresholds[i + 1]) return values[i + 1];
      }
      return values[values.length - 1];
    }
  };
}

export function calibrate(scores, labels, method = 'platt') {
  return method === 'isotonic' ? isotonicCalibrate(scores, labels) : plattCalibrate(scores, labels);
}

// 可靠性表：把预测概率分 10 桶，返回每桶平均预测与真实频率。
export function reliabilityTable(preds, labels, bins = 10) {
  const buckets = Array.from({ length: bins }, () => ({ preds: [], labels: [] }));
  preds.forEach((p, i) => {
    const b = Math.min(bins - 1, Math.max(0, Math.floor(p * bins)));
    buckets[b].preds.push(p);
    buckets[b].labels.push(labels[i]);
  });
  return buckets
    .map((b) => ({
      mean_pred: b.preds.length ? mean(b.preds) : null,
      actual_freq: b.labels.length ? mean(b.labels) : null,
      count: b.labels.length
    }))
    .filter((b) => b.count > 0);
}
