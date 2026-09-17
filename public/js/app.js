function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function missing(t) { return `<span class="missing">${esc(t || '数据缺失')}</span>`; }
function pct(v, digits = 1) { return v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : `${(Number(v) * 100).toFixed(digits)}%`; }
function num(v, digits = 2) { return v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(digits); }

const DIM_PLAIN = {
  待乏需求: '行业供需和景气位置',
  贵贱估值: '现在贵不贵',
  完物质量: '公司质量好不好',
  无息币周转: '资金使用效率',
  择人任时: '买入时机好不好',
  修备风控: '风险准备够不够'
};

const COMP_PLAIN = {
  base_probability: '历史相似情况下上涨概率',
  valuation_score: '估值便宜程度',
  industry_cycle_score: '行业景气程度',
  fanli_score: '范蠡综合分',
  sharpe: '历史回测性价比',
  risk_penalty: '风险扣分'
};

function levelText(p) {
  if (p === null || p === undefined) return '数据不足';
  if (p >= 0.65) return '偏高';
  if (p >= 0.5) return '中等偏上';
  if (p >= 0.35) return '中等偏低';
  return '偏低';
}

function renderFanliTable(f) {
  const weights = f.weights || {};
  const dims = Object.entries(f.dimensions || {});
  const computed = dims.filter(([, x]) => x.score !== null && x.score !== undefined);
  const totalContrib = computed.reduce((s, [name, x]) => s + Number(x.score) * (weights[name] || 0), 0);
  const rows = dims.map(([name, x]) => {
    const weight = weights[name] || 0;
    const score = x.score === null || x.score === undefined ? null : Number(x.score);
    const contribution = score === null ? null : score * weight;
    const share = contribution === null || !totalContrib ? null : contribution / totalContrib;
    return `<tr>
      <td>${esc(name)}<br><span class="missing">${esc(DIM_PLAIN[name] || '')}</span></td>
      <td>${pct(weight, 0)}</td>
      <td>${score === null ? '—' : score.toFixed(1)} / 10</td>
      <td>${share === null ? '—' : pct(share, 1)}</td>
      <td>${x.status === 'computed' ? '有数据' : '缺数据'}</td>
    </tr>`;
  }).join('');
  return `<p>范蠡综合分：<strong>${f.fanli_score === null || f.fanli_score === undefined ? '—' : Number(f.fanli_score).toFixed(1)} / 10</strong>（覆盖 ${pct(f.coverage, 0)}）</p>
    <table><thead><tr><th>看什么</th><th>权重</th><th>得分</th><th>占总分比例</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderWorthBuying(w) {
  if (!w) return missing('数据不足');
  const comps = Object.entries(w.components || {}).map(([name, c]) => {
    const value = typeof c === 'object' ? c.value : c;
    const contribution = typeof c === 'object' ? c.contribution : null;
    const share = contribution === null || !w.P_worth_buying ? null : contribution / w.P_worth_buying;
    return `<tr><td>${esc(COMP_PLAIN[name] || name)}</td><td>${num(value)}</td><td>${contribution === null ? '—' : pct(contribution)}</td><td>${share === null ? '—' : pct(share)}</td></tr>`;
  }).join('');
  return `<p><strong>值得买概率：${pct(w.P_worth_buying)}</strong>（${levelText(w.P_worth_buying)}） · 不确定性区间 ${pct(w.confidence_interval?.[0])} ~ ${pct(w.confidence_interval?.[1])} · 样本 ${esc(w.sample_size)}</p>
    <p class="missing">通俗理解：概率越高，历史上类似情况下表现较好的比例越高；但不代表一定上涨。</p>
    <details><summary>展开：这个概率怎么组成</summary><table><thead><tr><th>组成</th><th>数值</th><th>对概率贡献</th><th>占比</th></tr></thead><tbody>${comps}</tbody></table><p>${esc(w.note)}</p></details>`;
}

function renderProbability(p) {
  if (!p || p.status === 'insufficient_data') return missing('历史样本不足，暂时不给概率');
  const latest = p.latest_prediction;
  return `<p>历史上类似情况下，未来上涨概率约 <strong>${pct(latest?.P_positive_return)}</strong>，不确定范围 ${pct(latest?.confidence_interval?.[0])} ~ ${pct(latest?.confidence_interval?.[1])}。</p>
    <details><summary>展开：概率模型细节</summary><p>样本 ${esc(p.sample_size)} 个，回测折数 ${esc(p.folds?.length)}，Brier ${num(p.aggregate?.brier, 3)}，历史上涨基础比例 ${pct(p.aggregate?.base_rate)}。标签来源：真实历史未来收益。</p></details>`;
}

function renderBacktest(b) {
  if (!b) return missing('历史数据不足');
  const m = b.metrics;
  return `<p>如果过去一直按这个规则操作：累计收益 ${pct(m.cumulative_return)}，最大回撤 ${pct(m.max_drawdown)}，夏普 ${num(m.sharpe)}，胜率 ${pct(m.win_rate)}。</p>
    <details><summary>展开：回测完整指标</summary><table><tbody>
      <tr><td>年化收益</td><td>${pct(m.annualized_return)}</td><td>年化波动</td><td>${pct(m.annualized_vol)}</td></tr>
      <tr><td>换手次数</td><td>${num(m.turnover, 0)}</td><td>成本占比</td><td>${pct(m.total_cost)}</td></tr>
    </tbody></table></details>`;
}

function renderFundamentals(rec) {
  if (!rec || !rec.metrics) return missing('财务数据未获取');
  const m = rec.metrics;
  return `<p>报告期 ${esc(rec.report_date)} · 公告日 ${esc(rec.notice_date)} · 来源置信度 ${esc(rec.confidence)}</p>
    <table><tbody>
      <tr><td>ROE</td><td>${num(m.roe, 2)}%</td><td>ROIC</td><td>${num(m.roic, 2)}%</td></tr>
      <tr><td>毛利率</td><td>${num(m.gross_margin, 2)}%</td><td>负债率</td><td>${num(m.debt_ratio, 2)}%</td></tr>
      <tr><td>现金比率</td><td>${num(m.cash_ratio, 2)}</td><td>总资产周转率</td><td>${num(m.total_asset_turnover, 2)}</td></tr>
      <tr><td>经营现金流/营收</td><td>${num(m.operating_cashflow_to_revenue, 2)}</td><td>FCF率</td><td>${pct(m.fcf_margin)}</td></tr>
      <tr><td>营收增速</td><td>${num(m.revenue_growth, 2)}%</td><td>净利增速</td><td>${num(m.profit_growth, 2)}%</td></tr>
      <tr><td>营业周期</td><td>${num(m.operate_cycle, 0)} 天</td><td>报告类型</td><td>${esc(rec.field)}</td></tr>
    </tbody></table>`;
}

function renderFundHoldings(f) {
  if (!f || !f.funds?.length) return missing('暂无公开基金持仓数据');
  const rows = f.funds.slice(0, 5).map((x) => `<tr><td><a href="/fund.html?code=${encodeURIComponent(x.fund_code || '')}">${esc(x.fund_name)}</a></td><td>${esc(x.fund_company)}</td><td>${pct(x.shares_ratio, 3)}</td></tr>`).join('');
  return `<p>报告期 ${esc(f.report_date)} · 共 ${esc(f.count)} 只基金持有（展示前 5）</p>
    <table><thead><tr><th>基金名称</th><th>基金公司</th><th>持股比例</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderPositionAdvice(a) {
  if (!a) return missing('仓位建议数据不足');
  const tranches = (a.tranches || []).map((t) => `<li>${esc(t.name)}：${esc(t.amount)} 元（${pct(t.pct, 1)}）— ${esc(t.note)}</li>`).join('');
  return `<div class="summary">
    <p><strong>观察等级：</strong>${esc(a.suggestion)} · <strong>股票类型：</strong>${esc(a.stock_type)} · <strong>风险偏好：</strong>${esc(a.risk_profile)}</p>
    <p><strong>建议仓位：</strong>${pct(a.suggested_position_pct)} · <strong>建议金额：</strong>${esc(a.suggested_amount)} 元（总资金 ${esc(a.capital)} 元）</p>
    <p><strong>单笔风险预算：</strong>${esc(a.risk_budget_amount)} 元（${pct(a.risk_budget_pct)}）· <strong>参考最大亏损：</strong>${esc(a.max_reference_loss)} 元</p>
    <p><strong>理由：</strong>${esc(a.reason)}</p>
    <details><summary>展开：分批建仓模板</summary><ul>${tranches}</ul><p class="warn">${esc(a.disclaimer)}</p></details>
  </div>`;
}

function renderSmartRecommendation(s) {
  if (!s) return missing('智能建议数据不足');
  const signalList = (arr, okText, badText) => (arr || []).map((x) => `<li>${x.pass ? '✅' : '—'} ${esc(x.label)} <span class="missing">${esc(x.pass ? okText : badText)}</span></li>`).join('');
  const entries = (s.entry_plan || []).map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.low)} ~ ${esc(x.high)}</td><td>${esc(x.note)}</td></tr>`).join('');
  return `<div class="summary">
    <p><strong>智能建议：</strong>${esc(s.action)} · 综合评分 ${esc(s.score)}/100 · 置信度 ${esc(s.confidence)}</p>
    ${s.position_suggestion ? `<p><strong>仓位参考：</strong>${pct(s.position_suggestion.position_pct)} · 金额 ${esc(s.position_suggestion.amount)} 元 · 风险预算 ${esc(s.position_suggestion.risk_budget_amount)} 元</p>` : ''}
    <p><strong>理由：</strong>${esc((s.reasons || []).join(' · '))}</p>
    <details><summary>展开：买入/卖出信号</summary>
      <p><strong>买入条件：</strong></p><ul>${signalList(s.buy_signals, '满足', '未满足')}</ul>
      <p><strong>卖出/减仓条件：</strong></p><ul>${signalList(s.sell_signals, '触发', '未触发')}</ul>
    </details>
    <details><summary>展开：价格区间与风险计划</summary><table><thead><tr><th>区域</th><th>价格区间</th><th>说明</th></tr></thead><tbody>${entries}</tbody></table></details>
    <p class="warn">${esc((s.warnings || []).join('；'))}</p>
    <p class="warn">${esc(s.disclaimer)}</p>
  </div>`;
}

function renderAnalysis(d) {
  const w = d.worth_buying_probability;
  const p = d.probability?.latest_prediction;
  const topFund = d.fund_holdings?.funds?.[0]?.fund_name;
  return `<div class="summary">
    <p><strong>人话总结：</strong>${esc(d.plain_summary || '')}</p>
    <p><strong>一句话总结：</strong>${esc(d.name)}（${esc(d.ticker)}）当前价格 ${esc(d.price ?? '—')}，值得买概率 ${pct(w?.P_worth_buying)}（${levelText(w?.P_worth_buying)}）。</p>
    <p><strong>历史上涨概率：</strong>${p ? pct(p.P_positive_return) : '—'}；<strong>范蠡综合分：</strong>${d.fanli?.fanli_score === null || d.fanli?.fanli_score === undefined ? '—' : Number(d.fanli.fanli_score).toFixed(1)} / 10；<strong>持有基金示例：</strong>${esc(topFund || '暂无')}。</p>
    <p><strong>范蠡六维总评：</strong>${esc(d.fanli_summary?.label || '—')} · ${esc(d.fanli_summary?.recommendation || '—')} — ${esc(d.fanli_summary?.reason || '')}</p>
    <p class="warn">这不是保证涨，只是基于公开数据和历史统计的倾向判断。</p>
  </div>
  <h3>1. 值得买概率</h3>${renderWorthBuying(w)}
  <h3>2. 买入金额与建仓建议（研究用）</h3>${renderPositionAdvice(d.position_advice)}
  <h3>2.1 智能买卖建议（现代因子 + 范蠡六维 + 概率/回测）</h3>${renderSmartRecommendation(d.smart_recommendation)}
  <h3>3. 范蠡六维评分</h3>${renderFanliTable(d.fanli || {})}
  <div class="summary"><p><strong>范蠡六维总评：</strong>${esc(d.fanli_summary?.label || '—')} · <strong>${esc(d.fanli_summary?.recommendation || '—')}</strong></p><p>${esc(d.fanli_summary?.reason || '')}</p><p class="warn">${esc(d.fanli_summary?.disclaimer || '仅为研究辅助判断，不构成投资建议。')}</p></div>
  <details><summary>展开：财务数据（用于完物质量/无息币周转）</summary>${renderFundamentals(d.fundamentals)}</details>
  <h3>4. 历史上涨概率</h3>${renderProbability(d.probability)}
  <h3>5. 历史回测</h3>${renderBacktest(d.backtest)}
  <h3>6. 估值 / 行业</h3><p>PE ${num(d.valuation?.pe)} · PB ${num(d.valuation?.pb)} · 行业 ${esc(d.industry_cycle?.name || '—')} · 景气分 ${num(d.industry_cycle?.cycle_score)}（${levelText(d.industry_cycle?.cycle_score)}）</p>
  <h3>7. 哪些基金持有它</h3>${renderFundHoldings(d.fund_holdings)}
  <h3>8. 主要理由</h3><p>${d.drivers?.length ? esc(d.drivers.join('、')) : '暂无明确正面因素'}</p>
  <h3>9. 主要风险</h3><p class="warn">${d.risks?.length ? esc(d.risks.join('、')) : '暂无突出风险提示'}</p>
  <details><summary>展开：数据来源与免责声明</summary><ul>${(d.sources || []).map((s) => `<li>${esc(s.source_url)} · 置信度 ${esc(s.confidence)} · ${esc(s.retrieved_at)}</li>`).join('')}</ul><p class="warn">${esc(d.disclaimer)}</p></details>`;
}

function getWatchlist() { try { return JSON.parse(localStorage.getItem('fanli_watchlist') || '[]'); } catch { return []; } }
function setWatchlist(list) { localStorage.setItem('fanli_watchlist', JSON.stringify([...new Set(list)])); }

async function analyze() {
  const ticker = new URLSearchParams(location.search).get('ticker') || document.getElementById('ticker').value.trim();
  document.getElementById('ticker').value = ticker;
  const el = document.getElementById('report');
  el.textContent = '正在分析，请稍候…';
  try {
    const capital = document.getElementById('capital')?.value || 1000000;
    const riskLevel = document.getElementById('risk-level')?.value || 'balanced';
    const res = await fetch(`/v1/analyze?ticker=${encodeURIComponent(ticker)}&capital=${encodeURIComponent(capital)}&risk_level=${encodeURIComponent(riskLevel)}`);
    const body = await res.json();
    if (!res.ok) { el.innerHTML = missing(body.message || '分析失败'); return; }
    el.innerHTML = renderAnalysis(body.data);
    document.getElementById('collect').dataset.ticker = body.data.ticker;
  } catch (err) { el.innerHTML = missing('无法连接后端：' + err.message); }
}

function rankingReason(r) {
  const reasons = [];
  if (Number.isFinite(r.pe)) reasons.push(`PE ${num(r.pe, 1)}`);
  if (Number.isFinite(r.P_positive_return)) reasons.push(`历史上涨 ${pct(r.P_positive_return)}`);
  if (Number.isFinite(r.backtest_sharpe)) reasons.push(`夏普 ${num(r.backtest_sharpe)}`);
  if (r.risks?.length) reasons.push(`${r.risks.length} 个风险`);
  return reasons.join(' · ') || '综合指标';
}

function renderRanking(data) {
  if (!data || !data.results?.length) return missing('暂无排行数据');
  const rows = data.results.map((r, i) => `<tr>
    <td>${i + 1}</td>
    <td><a href="/?ticker=${encodeURIComponent(r.ticker)}">${esc(r.name)}</a><br><span class="missing">${esc(r.ticker)}</span></td>
    <td><strong>${pct(r.P_worth_buying)}</strong><br><span class="missing">${r.calibrated ? '已校准' : '启发式'}</span></td>
    <td>${esc(r.suggestion || '—')}<br><span class="missing">${esc(r.stock_type || '')}</span></td>
    <td>${esc(r.smart_action || '—')}<br><span class="missing">评分 ${esc(r.smart_score ?? '—')}</span></td>
    <td>${esc(r.fanli_summary?.label || '—')}<br><span class="missing">${esc(r.fanli_summary?.recommendation || '')}</span></td>
    <td>${esc(rankingReason(r))}</td>
    <td>${r.fund_holdings?.status === 'ok' ? esc((r.fund_holdings.funds || []).slice(0, 2).map((f) => f.fund_name).join('、') || '—') : '未接入'}</td>
  </tr>`).join('');
  return `<p>截至 ${esc(data.as_of)} · ${data.cached ? '缓存结果' : '实时计算'} · 概率越高只表示历史统计倾向越强，不是必涨。</p>
    <table><thead><tr><th>排名</th><th>股票</th><th>值得买概率</th><th>建议</th><th>智能买卖</th><th>范蠡总评</th><th>简单理由</th><th>持有基金（示例）</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function loadRanking(tickers) {
  const el = document.getElementById('ranking');
  el.textContent = '排行榜计算中，请稍候…';
  try {
    const q = tickers?.length ? `?tickers=${encodeURIComponent(tickers.join(','))}` : '';
    const url = tickers?.length ? `/v1/rankings/worth-buying${q}` : '/v1/recommendations/daily';
    const res = await fetch(url);
    const body = await res.json();
    el.innerHTML = res.ok ? renderRanking(body.data) : missing(body.message);
  } catch { el.innerHTML = missing('无法连接后端'); }
}

async function loadWatchlist() {
  const el = document.getElementById('watchlist');
  const list = getWatchlist();
  if (!list.length) { el.innerHTML = '<span class="missing">暂无收藏。分析股票后点击「收藏当前」。</span>'; return; }
  el.textContent = '收藏榜计算中…';
  try {
    const res = await fetch(`/v1/rankings/worth-buying?tickers=${encodeURIComponent(list.join(','))}`);
    const body = await res.json();
    el.innerHTML = res.ok ? renderRanking(body.data) : missing(body.message);
  } catch { el.innerHTML = missing('无法连接后端'); }
}

function renderDashboard(d) {
  document.querySelector('[data-bind="market_temperature"]').innerHTML = d.market_temperature?.status === 'computed' ? `<p>温度 ${esc(d.market_temperature.temperature)} · 动量 ${esc(d.market_temperature.momentum_z)} · 波动 ${esc(d.market_temperature.volatility_z)}</p>` : missing('需要更多行情数据');
  document.querySelector('[data-bind="fanli_compass"]').innerHTML = d.fanli_compass?.status === 'computed' ? `<p>${esc(d.fanli_compass.quadrant)} · 范蠡均分 ${esc(d.fanli_compass.avg_fanli_score)}</p>` : missing('需要更多行情数据');
  document.querySelector('[data-bind="probability_snapshot"]').innerHTML = d.probability_snapshot?.status === 'computed' ? `<p>上涨均值 ${esc(d.probability_snapshot.avg_P_positive_return)}</p>` : missing('未训练概率快照');
  document.querySelector('[data-bind="risk_warning"]').innerHTML = `<p>${esc(d.risk_warning?.level)} · ${esc((d.risk_warning?.triggers || []).join('、') || '暂无')}</p>`;
  document.querySelector('[data-bind="source_health"]').innerHTML = `<p>总体 ${esc(d.source_health?.overall_score)}</p><ul>${(d.source_health?.items || []).map((s) => `<li>${esc(s.name)} · ${esc(s.status)}</li>`).join('')}</ul>`;
  document.querySelector('[data-bind="compliance_reminder"]').innerHTML = `<p>${esc(d.compliance_reminder?.title)} v${esc(d.compliance_reminder?.version)}</p><p>${esc(d.compliance_reminder?.content)}</p>`;
}

async function loadDashboard() {
  try { const res = await fetch('/v1/dashboard/overview'); const body = await res.json(); if (body.data) renderDashboard(body.data); } catch {}
}

document.getElementById('analyze').addEventListener('click', analyze);
document.getElementById('ticker').addEventListener('keydown', (e) => { if (e.key === 'Enter') analyze(); });
document.getElementById('collect').addEventListener('click', () => {
  const t = document.getElementById('collect').dataset.ticker || document.getElementById('ticker').value.trim();
  if (!t) return;
  setWatchlist([...getWatchlist(), t]);
  loadWatchlist();
});
document.getElementById('refresh-ranking').addEventListener('click', () => loadRanking());
analyze();
loadDashboard();
loadRanking();
loadWatchlist();










