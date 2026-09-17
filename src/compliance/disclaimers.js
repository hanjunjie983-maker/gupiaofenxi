// 合规文案版本化。默认文案为模板，真实上线需法务审核后发布新版本。
export const DEFAULT_DISCLAIMERS = [
  {
    type: 'disclaimer',
    version: '1.0.0',
    title: '免责声明',
    content: '本平台仅提供基于公开数据的研究与概率化统计，不构成投资建议、不承诺收益、不替代持牌投资顾问。'
  },
  {
    type: 'risk_warning',
    version: '1.0.0',
    title: '风险提示',
    content: '股票投资存在本金损失风险；历史回测不代表未来表现；概率输出可能因模型、样本与市场状态变化而失效。'
  },
  {
    type: 'data_sources',
    version: '1.0.0',
    title: '数据来源',
    content: '优先使用交易所、监管机构与官方披露平台数据；非官方数据仅作交叉校验并记录来源与可信度。'
  },
  {
    type: 'user_agreement',
    version: '1.0.0',
    title: '用户协议',
    content: '用户须自行判断并承担决策后果；不得将本平台输出作为唯一决策依据。'
  }
];

export function initDefaultDocs(store) {
  const saved = [];
  for (const doc of DEFAULT_DISCLAIMERS) {
    if (!store.getComplianceDoc(doc.type, doc.version)) {
      saved.push(store.saveComplianceDoc(doc));
    }
  }
  return saved;
}

export function getDoc(store, type, version) {
  return store.getComplianceDoc(type, version);
}

export function listDocs(store, type) {
  return store.listComplianceDocs(type);
}

export function publishDoc(store, { type, version, title, content }) {
  if (!type || !version || !title || !content) {
    throw new Error('type/version/title/content are required');
  }
  return store.saveComplianceDoc({ type, version, title, content });
}
