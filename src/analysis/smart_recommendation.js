function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// 现代因子 + 范蠡六维 + 概率/回测 的智能买卖研究建议。
// 输出是研究模型建议，不是个性化投资建议，也不保证收益。
export function computeSmartRecommendation({ fanli = {}, fanliSummary = null, worthBuying = null, probability = null, backtest = null, valuation = null, industry = null, risks = [], positionAdvice = null, volatility = null } = {}) {
  const fanliScore = Number.isFinite(fanli.fanli_score) ? fanli.fanli_score : 5;
  const pWorth = Number.isFinite(worthBuying) ? worthBuying : 0.5;
  const pPositive = Number.isFinite(probability?.latest_prediction?.P_positive_return) ? probability.latest_prediction.P_positive_return : 0.5;
  const sharpe = Number.isFinite(backtest?.metrics?.sharpe) ? backtest.metrics.sharpe : 0;
  const dataCompleteness = Number.isFinite(fanli.data_completeness) ? fanli.data_completeness : 0.5;
  const riskPenalty = Math.min(10, risks.length * 2);
  const sharpeScore = clamp((sharpe + 1) / 3, 0, 1) * 10;

  const rawScore = (fanliScore / 10) * 35 + pWorth * 30 + pPositive * 15 + sharpeScore + dataCompleteness * 10 - riskPenalty;
  const score = Number(clamp(rawScore, 0, 100).toFixed(2));

  let action = '观望';
  if (score >= 75 && pWorth >= 0.6 && risks.length <= 1) action = '分批买入';
  else if (score >= 65) action = '可分批建仓 / 重点关注';
  else if (score >= 50) action = '持有 / 观察';
  else if (score >= 35) action = '减仓 / 谨慎';
  else action = '暂不买入 / 观望';

  const momRaw = Number(fanli?.dimensions?.['择人任时']?.score) >= 6;
  const cycleGood = Number(industry?.cycle_score) >= 0.5;
  const valuationGood = Number.isFinite(valuation?.pe) && Number(valuation.pe) < 30;
  const riskLow = risks.length <= 1;

  const buySignals = [
    { key: 'fanli', label: '范蠡六维 >= 6', pass: fanliScore >= 6 },
    { key: 'worth', label: '值得买概率 >= 55%', pass: pWorth >= 0.55 },
    { key: 'prob', label: '历史上涨概率 >= 50%', pass: pPositive >= 0.5 },
    { key: 'momentum', label: '时机维度 >= 6', pass: momRaw },
    { key: 'cycle', label: '行业景气 >= 0.5', pass: cycleGood },
    { key: 'valuation', label: 'PE < 30', pass: valuationGood },
    { key: 'risk', label: '风险项 <= 1', pass: riskLow }
  ];

  const sellSignals = [
    { key: 'fanli', label: '范蠡六维 < 4.5', pass: fanliScore < 4.5 },
    { key: 'worth', label: '值得买概率 < 40%', pass: pWorth < 0.4 },
    { key: 'prob', label: '历史上涨概率 < 40%', pass: pPositive < 0.4 },
    { key: 'sharpe', label: '历史夏普 < -0.5', pass: sharpe < -0.5 },
    { key: 'risk', label: '风险项 >= 3', pass: risks.length >= 3 }
  ];

  const price = Number(valuation?.price);
  const annualVol = Number.isFinite(volatility) && volatility > 0 ? volatility : 0.30;
  const entryPlan = [];
  if (Number.isFinite(price) && price > 0) {
    const dailyVol = annualVol / Math.sqrt(252);
    const atr = price * dailyVol * 2;
    entryPlan.push({ name: '首次建仓区', low: Number((price - atr).toFixed(2)), high: Number(price.toFixed(2)), note: `先建一半计划仓位；波动率参考 ${(annualVol * 100).toFixed(1)}%。` });
    entryPlan.push({ name: '回撤加仓区', low: Number((price - atr * 3).toFixed(2)), high: Number((price - atr * 2).toFixed(2)), note: '若回撤且基本面/景气未恶化，再投入 30%。' });
    entryPlan.push({ name: '风险参考线', low: Number((price - atr * 4).toFixed(2)), high: Number((price - atr * 3).toFixed(2)), note: '跌破风险参考线时，重新评估逻辑，不盲目补仓。' });
  }

  return {
    action,
    score,
    confidence: dataCompleteness >= 0.8 ? '较高' : dataCompleteness >= 0.5 ? '中等' : '偏低',
    fanli_label: fanliSummary?.label || null,
    position_suggestion: positionAdvice ? { position_pct: positionAdvice.suggested_position_pct, amount: positionAdvice.suggested_amount, risk_budget_amount: positionAdvice.risk_budget_amount } : null,
    buy_signals: buySignals,
    sell_signals: sellSignals,
    entry_plan: entryPlan,
    reasons: [
      `范蠡六维 ${fanliScore.toFixed(2)}/10`,
      `值得买概率 ${(pWorth * 100).toFixed(1)}%`,
      `历史上涨概率 ${(pPositive * 100).toFixed(1)}%`,
      `历史夏普 ${sharpe.toFixed(2)}`,
      risks.length ? `风险项 ${risks.length} 个` : '未发现突出风险项'
    ],
    warnings: [
      risks.length ? `当前风险：${risks.join('、')}` : '暂无突出风险项',
      fanli.estimated_dimensions?.length ? `估算维度：${fanli.estimated_dimensions.join('、')}` : '六维全部为真实计算值',
      '智能建议只基于公开数据和历史统计，不构成投资建议。'
    ],
    disclaimer: '本智能买卖建议为研究模型输出，不构成投资建议，不承诺收益，不替代持牌投资顾问。'
  };
}



