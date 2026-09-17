function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function pct(v,d=1){return v===null||v===undefined||!Number.isFinite(Number(v))?'—':`${(Number(v)*100).toFixed(d)}%`;}
function money(v){return v===null||v===undefined||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('zh-CN');}

function renderStocks(data){
  const rows=(data?.results||[]).map((r,i)=>`<tr><td>${i+1}</td><td><a href="/?ticker=${encodeURIComponent(r.ticker)}">${esc(r.name)}</a><br><span class="missing">${esc(r.ticker)}</span></td><td>${pct(r.P_worth_buying)}</td><td>${esc(r.suggestion||'—')}</td><td>${esc(r.smart_action||'—')}</td></tr>`).join('');
  return `<p>${esc(data?.note||'')}</p><table><thead><tr><th>#</th><th>股票</th><th>值得买概率</th><th>仓位建议</th><th>智能买卖</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function renderFunds(data){
  const rows=(data?.results||[]).map((r,i)=>`<tr><td>${i+1}</td><td><a href="/fund.html?code=${encodeURIComponent(r.code)}">${esc(r.name)}</a><br><span class="missing">${esc(r.code)}</span></td><td>${esc(r.fund_score??'—')}</td><td>${esc(r.action||'—')}</td><td>${pct(r.position_suggestion?.position_pct)}</td></tr>`).join('');
  return `<p>${esc(data?.note||'')}</p><table><thead><tr><th>#</th><th>基金</th><th>评分</th><th>建议</th><th>仓位</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function renderPlan(data){
  const sim=data?.simulation||{};
  return `<p><strong>资金：</strong>${money(data?.capital)} 元 · <strong>风险：</strong>${esc(data?.risk_level)} · <strong>期限：</strong>${esc(data?.horizon_months)} 个月</p><p>股票 ${pct(data?.allocation?.allocation?.stock_weight)} · 基金 ${pct(data?.allocation?.allocation?.fund_weight)} · 现金 ${pct(data?.allocation?.allocation?.cash_weight)}</p><p>中性区间：${money(sim.scenarios?.neutral?.range?.[0])} ~ ${money(sim.scenarios?.neutral?.range?.[1])} 元</p><p>亏损概率：${pct(sim.risk?.probability_of_loss)} · 中位最大回撤：${pct(sim.risk?.median_max_drawdown)}</p><p><a href="/plan.html">打开完整投资规划 →</a></p><p class="warn">${esc(data?.disclaimer||'')}</p>`;
}
async function j(url){const r=await fetch(url);const b=await r.json();return r.ok?b.data:null;}
async function loadAll(){
  const cap=document.getElementById('center-capital').value||1000000;
  const risk=document.getElementById('center-risk').value;
  const [stocks,funds,plan]=await Promise.all([j('/v1/recommendations/daily'),j('/v1/funds/daily'),j(`/v1/planning/center?capital=${encodeURIComponent(cap)}&risk_level=${encodeURIComponent(risk)}&horizon_months=12&max_drawdown=0.15`)]);
  document.getElementById('center-stocks').innerHTML=stocks?renderStocks(stocks):'<span class="missing">股票数据加载失败</span>';
  document.getElementById('center-funds').innerHTML=funds?renderFunds(funds):'<span class="missing">基金数据加载失败</span>';
  document.getElementById('center-plan').innerHTML=plan?renderPlan(plan):'<span class="missing">规划数据加载失败</span>';
}
document.getElementById('center-run').addEventListener('click',loadAll);
document.querySelectorAll('.tab').forEach((btn)=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach((b)=>b.classList.toggle('active',b===btn));
  document.querySelectorAll('.tab-panel').forEach((p)=>p.classList.add('hidden'));
  document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
}));
loadAll();

