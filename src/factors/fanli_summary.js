// 范蠡六维综合总评：只做研究辅助判断，不构成投资建议。
export function computeFanliSummary({ fanli = null, worthBuying = null, risks = [] } = {}) {
  const score = fanli?.fanli_score;
  const coverage = fanli?.coverage ?? 0;
  const p = Number.isFinite(worthBuying) ? worthBuying : null;

  if (!Number.isFinite(score) || coverage < 0.6) {
    return {
      score: Number.isFinite(score) ? score : null,
      coverage,
      label: '数据不足',
      recommendation: '暂不判断',
      reason: '范蠡六维有效覆盖不足 60%，需要补齐估值、财务或行业数据。',
      tone: 'neutral',
      disclaimer: '仅为研究辅助判断，不构成投资建议。'
    };
  }

  if (score >= 7.5 && p !== null && p >= 0.6 && risks.length <= 1) {
    return {
      score, coverage, label: '优秀', recommendation: '可重点研究',
      reason: '六维综合分高，值得买概率较高，风险项较少。',
      tone: 'positive', disclaimer: '仅为研究辅助判断，不构成投资建议。'
    };
  }
  if (score >= 6 && p !== null && p >= 0.5) {
    return {
      score, coverage, label: '较好', recommendation: '可作为观察候选',
      reason: '六维综合分较好，值得买概率处于中性偏上。',
      tone: 'positive', disclaimer: '仅为研究辅助判断，不构成投资建议。'
    };
  }
  if (score >= 4.5) {
    return {
      score, coverage, label: '一般', recommendation: '建议继续观察',
      reason: '六维综合分处于中性区，优势和风险都不突出。',
      tone: 'neutral', disclaimer: '仅为研究辅助判断，不构成投资建议。'
    };
  }
  return {
    score, coverage, label: '偏弱', recommendation: '暂不推荐',
    reason: '六维综合分偏低，或风险项较多，安全边际不足。',
    tone: 'negative', disclaimer: '仅为研究辅助判断，不构成投资建议。'
  };
}
