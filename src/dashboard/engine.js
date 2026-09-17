import { computeFactors } from '../factors/engine.js';
import { computeFanli } from '../factors/fanli.js';
import { aggregateHealth } from '../admin/health.js';
import { getDoc } from '../compliance/disclaimers.js';
import { mean } from '../probability/math.js';

function quadrantFor(momZ, volZ) {
  if (momZ === null || volZ === null || !Number.isFinite(momZ) || !Number.isFinite(volZ)) return '数据不足';
  if (momZ >= 0 && volZ <= 0) return '景气上行（高动量·低波动）';
  if (momZ >= 0 && volZ > 0) return '过热（高动量·高波动）';
  if (momZ < 0 && volZ <= 0) return '蓄势（低动量·低波动）';
  return '退潮（低动量·高波动）';
}

function aggregateZ(factors, field) {
  const vals = factors.stocks.map((s) => s.factors[field]?.zscore ?? null).filter((v) => Number.isFinite(v));
  return vals.length ? mean(vals) : null;
}

export function computeDashboard({ store, probability = null, portfolio = null } = {}) {
  const sourceHealth = aggregateHealth(store);

  // 市场温度 & 范蠡周期罗盘：依赖 price_daily 因子
  let marketTemperature = { status: 'data_missing', required: ['price_daily'] };
  let fanliCompass = { status: 'data_missing', required: ['price_daily'] };
  const priceRows = store.listPriceRows ? store.listPriceRows() : [];
  if (priceRows.length > 0) {
    const factors = computeFactors(priceRows, { asOf: new Date().toISOString().slice(0, 10) });
    const momZ = aggregateZ(factors, 'mom_20d');
    const volZ = aggregateZ(factors, 'vol_20d');
    const ddZ = aggregateZ(factors, 'max_drawdown_60d');
    const fanliScores = factors.stocks
      .map((s) => computeFanli(s.factors).fanli_score)
      .filter((v) => Number.isFinite(v));
    const avgFanli = fanliScores.length ? mean(fanliScores) : null;

    marketTemperature = {
      status: momZ !== null || volZ !== null ? 'computed' : 'data_insufficient',
      momentum_z: momZ,
      volatility_z: volZ,
      drawdown_z: ddZ,
      temperature: momZ !== null && volZ !== null ? Number((50 + momZ * 25 - volZ * 25).toFixed(1)) : null
    };

    fanliCompass = {
      status: avgFanli !== null ? 'computed' : 'data_insufficient',
      quadrant: quadrantFor(momZ, volZ),
      momentum_z: momZ,
      volatility_z: volZ,
      avg_fanli_score: avgFanli
    };
  }

  // 概率快照：优先用最近一次概率计算结果
  let probabilitySnapshot = { status: 'data_missing', required: ['probability/compute'] };
  if (probability && Array.isArray(probability.predictions) && probability.predictions.length) {
    const preds = probability.predictions;
    const avg = (field) => mean(preds.map((p) => p[field]).filter((v) => Number.isFinite(v)));
    probabilitySnapshot = {
      status: 'computed',
      count: preds.length,
      avg_P_positive_return: avg('P_positive_return'),
      avg_P_outperform_benchmark: avg('P_outperform_benchmark'),
      avg_P_max_drawdown_gt_10: avg('P_max_drawdown_gt_10')
    };
  }

  // 风险预警：来源健康度 + 组合 CVaR
  let riskLevel = 'low';
  if (sourceHealth.overall_score < 30) riskLevel = 'high';
  else if (sourceHealth.overall_score < 60) riskLevel = 'medium';
  if (portfolio && Number.isFinite(portfolio.cvar) && Number.isFinite(portfolio.cvar_cap) && portfolio.cvar > portfolio.cvar_cap) {
    riskLevel = 'high';
  }
  const riskWarning = {
    status: 'computed',
    level: riskLevel,
    source_health_score: sourceHealth.overall_score,
    portfolio_cvar: portfolio?.cvar ?? null,
    portfolio_cvar_cap: portfolio?.cvar_cap ?? null,
    triggers: [
      ...(sourceHealth.overall_score < 60 ? ['数据源健康度偏低'] : []),
      ...(portfolio && portfolio.cvar > portfolio.cvar_cap ? ['组合 CVaR 超预算'] : [])
    ]
  };

  const complianceReminder = getDoc(store, 'disclaimer') || { status: 'missing' };

  return {
    retrieved_at: new Date().toISOString(),
    source_health: sourceHealth,
    market_temperature: marketTemperature,
    fanli_compass: fanliCompass,
    probability_snapshot: probabilitySnapshot,
    risk_warning: riskWarning,
    compliance_reminder: complianceReminder
  };
}
