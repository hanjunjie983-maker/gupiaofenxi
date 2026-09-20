function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function pct(v,d=1){return v===null||v===undefined||!Number.isFinite(Number(v))?'—':`${(Number(v)*100).toFixed(d)}%`;}
function money(v){return v===null||v===undefined||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('zh-CN');}
function num(v,d=1){return v===null||v===undefined||!Number.isFinite(Number(v))?'—':Number(v).toFixed(d);}

function renderStocks(data){
  if(!data?.results?.length) return '<span class="missing">暂无股票数据，请稍后点“刷新统一中心”。</span>';
  const rows=data.results.map((r,i)=>`<tr>
    <td>${i+1}<br><span class="missing">相对第 ${esc(r.relative_rank??i+1)} 名</span></td>
    <td><a href="/?ticker=${encodeURIComponent(r.ticker)}">${esc(r.name)}</a><br><span class="missing">${esc(r.ticker)}</span></td>
    <td>${pct(r.P_worth_buying)}</td>
    <td>${esc(r.suggestion||'—')}<br><span class="missing">建议仓位 ${pct(r.suggested_position_pct)}</span></td>
    <td><strong>${esc(r.smart_action||'—')}</strong><br><span class="missing">综合 ${num(r.final_score)} · 绝对 ${num(r.smart_score)}</span></td>
    <td>${esc(r.recommendation_reason||'—')}</td>
  </tr>`).join('');
  return `<p>${esc(data.note||'')}</p><p class="missing">${esc(data.universe_note||'')}</p>
    <table><thead><tr><th>#</th><th>股票</th><th>值得买概率</th><th>仓位建议</th><th>智能买卖</th><th>为什么这样建议</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderFunds(data){
  if(!data?.results?.length) return '<span class="missing">暂无基金数据，请稍后点“刷新统一中心”。</span>';
  const rows=data.results.map((r,i)=>`<tr>
    <td>${i+1}<br><span class="missing">相对第 ${esc(r.relative_rank??i+1)} 名</span></td>
    <td><a href="/fund.html?code=${encodeURIComponent(r.code)}">${esc(r.name)}</a><br><span class="missing">${esc(r.code)}</span></td>
    <td>${num(r.final_score)}<br><span class="missing">绝对 ${num(r.fund_score)}</span></td>
    <td><strong>${esc(r.action||'—')}</strong></td>
    <td>${pct(r.position_suggestion?.position_pct)}<br><span class="missing">${money(r.position_suggestion?.amount)} 元</span></td>
    <td>${esc(r.recommendation_reason||'—')}</td>
  </tr>`).join('');
  return `<p>${esc(data.note||'')}</p><p class="missing">${esc(data.universe_note||'')}</p>
    <table><thead><tr><th>#</th><th>基金</th><th>评分</th><th>建议</th><th>仓位</th><th>为什么这样建议</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderPlan(data){
  if(!data) return '<span class="missing">规划数据加载失败，请稍后重试。</span>';
  const sim=data.simulation||{};
  const tranches=(data.buy_plan?.tranches||[]).slice(0,3).map(t=>`<li>${esc(t.date)}：${money(t.amount)} 元（股票 ${money(t.stock_amount)} / 基金 ${money(t.fund_amount)}）</li>`).join('');
  const stocks=(data.selected_stocks||[]).slice(0,4).map(s=>`<li>${esc(s.name)}（${esc(s.ticker)}）· ${esc(s.action||'—')} · ${money(s.position?.amount ?? s.amount)} 元${s.relative_rank?` · 今日第 ${esc(s.relative_rank)} 名`:''}</li>`).join('');
  const funds=(data.selected_funds||[]).slice(0,3).map(f=>`<li>${esc(f.name)}（${esc(f.code)}）· ${esc(f.action||'—')} · ${money(f.position?.amount ?? f.amount)} 元${f.relative_rank?` · 今日第 ${esc(f.relative_rank)} 名`:''}</li>`).join('');
  return `<p><strong>人话总结：</strong>${esc(data.plain_summary||'')}</p>
    <p><strong>资金：</strong>${money(data.capital)} 元 · <strong>风格：</strong>${esc(data.risk_profile_label||data.risk_level)} · <strong>期限：</strong>${esc(data.horizon_months)} 个月</p>
    <p>股票 ${pct(data.allocation?.allocation?.stock_weight)} · 基金 ${pct(data.allocation?.allocation?.fund_weight)} · 现金 ${pct(data.allocation?.allocation?.cash_weight)}（${money(data.allocation?.cash?.amount)} 元）</p>
    <h3>分批建仓</h3><ul>${tranches}</ul>
    <h3>股票名单</h3><ul>${stocks}</ul>
    <h3>基金名单</h3><ul>${funds}</ul>
    <p>中性区间：${money(sim.scenarios?.neutral?.range?.[0])} ~ ${money(sim.scenarios?.neutral?.range?.[1])} 元</p>
    <p>亏损概率：${pct(sim.risk?.probability_of_loss)} · 中位最大回撤：${pct(sim.risk?.median_max_drawdown)}</p>
    <p><a href="/plan.html">打开完整投资规划（含卖出规则与时间表）→</a></p>
    <p class="warn">${esc(data.disclaimer||'')}</p>`;
}

async function j(url){const r=await fetch(url);const b=await r.json();return r.ok?b.data:null;}

async function loadAll(){
  const cap=document.getElementById('center-capital').value||1000000;
  const risk=document.getElementById('center-risk').value;
  document.getElementById('center-stocks').textContent='加载中…首次计算约需 30-60 秒。';
  document.getElementById('center-funds').textContent='加载中…';
  document.getElementById('center-plan').textContent='加载中…';
  const [stocks,funds,plan]=await Promise.all([
    j('/v1/recommendations/daily'),
    j('/v1/funds/daily'),
    j(`/v1/planning/center?capital=${encodeURIComponent(cap)}&risk_level=${encodeURIComponent(risk)}&horizon_months=12&max_drawdown=0.15`)
  ]);
  document.getElementById('center-stocks').innerHTML=stocks?renderStocks(stocks):'<span class="missing">股票数据加载失败，请稍后重试。</span>';
  document.getElementById('center-funds').innerHTML=funds?renderFunds(funds):'<span class="missing">基金数据加载失败，请稍后重试。</span>';
  document.getElementById('center-plan').innerHTML=plan?renderPlan(plan):'<span class="missing">规划数据加载失败，请稍后重试。</span>';
}

document.getElementById('center-run').addEventListener('click',loadAll);
document.querySelectorAll('.tab').forEach((btn)=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach((b)=>b.classList.toggle('active',b===btn));
  document.querySelectorAll('.tab-panel').forEach((p)=>p.classList.add('hidden'));
  document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
}));
loadAll();
