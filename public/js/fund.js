function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function pct(v, d=2) { return v===null||v===undefined||!Number.isFinite(Number(v))?'—':`${(Number(v)*100).toFixed(d)}%`; }
function num(v,d=2){return v===null||v===undefined||!Number.isFinite(Number(v))?'—':Number(v).toFixed(d);}

function renderFundDetail(d) {
  const holdings = (d.holdings||[]).map((h)=>`<tr><td>${esc(h.name)}<br><span class="missing">${esc(h.code)}</span></td><td>${pct(h.weight)}</td><td>${esc(h.action||'—')}</td><td>${num(h.score)}</td><td>${num(h.fanli_score)}</td><td>${pct(h.worth_buying)}</td></tr>`).join('');
  const fanli = Object.entries(d.fanli||{}).map(([k,v])=>`<li>${esc(k)}：${num(v.score)}/10 <span class="missing">${esc(v.note)}</span></li>`).join('');
  return `<div class="summary"><p><strong>${esc(d.name)}（${esc(d.code)}）</strong></p><p>基金评分 ${num(d.fund_score)}/100 · ${esc(d.action)} · 建议仓位 ${pct(d.position_suggestion?.position_pct)} · 金额 ${esc(d.position_suggestion?.amount)} 元</p></div>
    <h3>基金范蠡六维</h3><ul>${fanli}</ul>
    <h3>前十大持仓分析</h3><table><thead><tr><th>持仓</th><th>权重</th><th>股票建议</th><th>智能分</th><th>范蠡分</th><th>值得买概率</th></tr></thead><tbody>${holdings}</tbody></table>
    <h3>理由</h3><p>${esc((d.reasons||[]).join('；'))}</p><h3>风险</h3><p class="warn">${esc((d.warnings||[]).join('；'))}</p><p class="warn">${esc(d.disclaimer)}</p>`;
}

function renderFundRanking(data) {
  if (!data?.results?.length) return '<span class="missing">暂无基金数据</span>';
  const rows = data.results.map((f,i)=>`<tr><td>${i+1}</td><td>${esc(f.name)}<br><span class="missing">${esc(f.code)}</span></td><td>${num(f.fund_score)}</td><td>${esc(f.action)}</td><td>${pct(f.position_suggestion?.position_pct)}</td></tr>`).join('');
  return `<p>${esc(data.date)} · ${data.cached?'缓存':'实时计算'} · ${esc(data.note)}</p><table><thead><tr><th>#</th><th>基金</th><th>评分</th><th>建议</th><th>建议仓位</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function queryFund() {
  const code = document.getElementById('fund-code').value.trim();
  const capital = document.getElementById('fund-capital').value || 1000000;
  const risk = document.getElementById('fund-risk').value;
  const el = document.getElementById('fund-detail');
  el.textContent = '正在分析基金和持仓，请稍候…';
  try {
    const r = await fetch(`/v1/funds/${encodeURIComponent(code)}?capital=${encodeURIComponent(capital)}&risk_level=${encodeURIComponent(risk)}`);
    const b = await r.json();
    el.innerHTML = r.ok ? renderFundDetail(b.data) : `<span class="missing">${esc(b.message)}</span>`;
  } catch { el.innerHTML = '<span class="missing">无法连接后端</span>'; }
}

async function loadRanking() {
  const el = document.getElementById('fund-ranking');
  el.textContent = '每日基金推荐计算中，可能需要一点时间…';
  try {
    const r = await fetch('/v1/funds/daily');
    const b = await r.json();
    el.innerHTML = r.ok ? renderFundRanking(b.data) : `<span class="missing">${esc(b.message)}</span>`;
  } catch { el.innerHTML = '<span class="missing">无法连接后端</span>'; }
}

document.getElementById('fund-query').addEventListener('click', queryFund);
queryFund();
loadRanking();
