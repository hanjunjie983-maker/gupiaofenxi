function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function money(v){return v===null||v===undefined||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('zh-CN');}
function pct(v,d=2){return v===null||v===undefined||!Number.isFinite(Number(v))?'—':`${(Number(v)*100).toFixed(d)}%`;}

function renderPlan(d){
  const stocks=(d.selected_stocks||[]).map(s=>`<tr><td><a href="/?ticker=${encodeURIComponent(s.ticker)}">${esc(s.name)}</a><br><span class="missing">${esc(s.ticker)}</span></td><td>${esc(s.action||'—')}</td><td>${esc(s.score??'—')}</td><td>${pct(s.position?.weight)}</td><td>${money(s.position?.amount)}</td></tr>`).join('');
  const funds=(d.selected_funds||[]).map(f=>`<tr><td><a href="/fund.html?code=${encodeURIComponent(f.code)}">${esc(f.name)}</a><br><span class="missing">${esc(f.code)}</span></td><td>${esc(f.action||'—')}</td><td>${esc(f.score??'—')}</td><td>${pct(f.position?.weight)}</td><td>${money(f.position?.amount)}</td></tr>`).join('');
  const sim=d.simulation||{};
  const schedule=(d.schedule||[]).map(x=>`<tr><td>${esc(x.date)}</td><td>${esc(x.action)}</td><td>${esc(x.note)}</td></tr>`).join('');
  return `<div class="summary"><p><strong>人话总结：</strong>${esc(d.plain_summary || '')}</p><p><strong>总资金：</strong>${money(d.capital)} 元 · <strong>风险：</strong>${esc(d.risk_level)} · <strong>期限：</strong>${esc(d.horizon_months)} 个月</p><p><strong>配置：</strong>股票 ${pct(d.allocation?.allocation?.stock_weight)} · 基金 ${pct(d.allocation?.allocation?.fund_weight)} · 现金 ${pct(d.allocation?.allocation?.cash_weight)}</p></div>
    <h3>股票配置</h3><table><thead><tr><th>标的</th><th>建议</th><th>评分</th><th>权重</th><th>金额</th></tr></thead><tbody>${stocks}</tbody></table>
    <h3>基金配置</h3><table><thead><tr><th>基金</th><th>建议</th><th>评分</th><th>权重</th><th>金额</th></tr></thead><tbody>${funds}</tbody></table>
    <h3>未来情景（概率区间，不是预言）</h3><p>中性区间：${money(sim.scenarios?.neutral?.range?.[0])} ~ ${money(sim.scenarios?.neutral?.range?.[1])} 元（概率约50%）</p><p>悲观区间：${money(sim.scenarios?.pessimistic?.range?.[0])} ~ ${money(sim.scenarios?.pessimistic?.range?.[1])} 元（概率约20%）</p><p>乐观区间：${money(sim.scenarios?.optimistic?.range?.[0])} ~ ${money(sim.scenarios?.optimistic?.range?.[1])} 元（概率约20%）</p><p>亏损概率：${pct(sim.risk?.probability_of_loss)} · 中位最大回撤：${pct(sim.risk?.median_max_drawdown)} · VaR95：${money(sim.risk?.var_95)} 元</p>
    <h3>时间表</h3><table><thead><tr><th>日期</th><th>动作</th><th>说明</th></tr></thead><tbody>${schedule}</tbody></table>
    <p class="warn">${esc((d.warnings||[]).join('；'))}</p><p class="warn">${esc(d.disclaimer)}</p>`;
}

async function run(){
  const el=document.getElementById('plan'); el.textContent='正在生成统一规划，请稍候…';
  const capital=document.getElementById('capital').value||1000000;
  const risk=document.getElementById('risk').value;
  const horizon=document.getElementById('horizon').value||12;
  const maxdd=document.getElementById('maxdd').value||0.15;
  try{const r=await fetch(`/v1/planning/center?capital=${encodeURIComponent(capital)}&risk_level=${encodeURIComponent(risk)}&horizon_months=${encodeURIComponent(horizon)}&max_drawdown=${encodeURIComponent(maxdd)}`);const b=await r.json();el.innerHTML=r.ok?renderPlan(b.data):`<span class="missing">${esc(b.message)}</span>`;}catch{el.innerHTML='<span class="missing">无法连接后端</span>';}
}
document.getElementById('run').addEventListener('click',run);
run();



