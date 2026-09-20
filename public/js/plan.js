function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function money(v){return v===null||v===undefined||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('zh-CN');}
function pct(v,d=2){return v===null||v===undefined||!Number.isFinite(Number(v))?'—':`${(Number(v)*100).toFixed(d)}%`;}
function num(v,d=2){return v===null||v===undefined||!Number.isFinite(Number(v))?'—':Number(v).toFixed(d);}

function renderPlan(d){
  const stocks=(d.selected_stocks||[]).map(s=>`<tr>
    <td><a href="/?ticker=${encodeURIComponent(s.ticker)}">${esc(s.name)}</a><br><span class="missing">${esc(s.ticker)}</span></td>
    <td>${esc(s.action||'—')}${s.relative_rank?`<br><span class="missing">今日第 ${esc(s.relative_rank)}/${esc(s.candidate_count??'—')} 名</span>`:''}</td>
    <td>${num(s.score,1)}<br><span class="missing">值得买 ${pct(s.P_worth_buying,1)} · 范蠡 ${num(s.fanli_score,2)}</span></td>
    <td>${pct(s.weight)}</td>
    <td><strong>${money(s.amount)}</strong> 元</td>
    <td>${esc(s.reason||'—')}${s.why_not_absolute?`<br><span class="missing">${esc(s.why_not_absolute)}</span>`:''}${s.risks?.length?`<br><span class="missing">风险：${esc(s.risks.slice(0,3).join('、'))}</span>`:''}</td>
  </tr>`).join('');

  const funds=(d.selected_funds||[]).map(f=>`<tr>
    <td><a href="/fund.html?code=${encodeURIComponent(f.code)}">${esc(f.name)}</a><br><span class="missing">${esc(f.code)}</span></td>
    <td>${esc(f.action||'—')}${f.relative_rank?`<br><span class="missing">今日第 ${esc(f.relative_rank)}/${esc(f.candidate_count??'—')} 名</span>`:''}</td>
    <td>${num(f.score,1)}<br><span class="missing">近一年 ${num(f.one_year_return,1)}% · 最大回撤 ${pct(f.max_drawdown,1)}</span></td>
    <td>${pct(f.weight)}</td>
    <td><strong>${money(f.amount)}</strong> 元</td>
    <td>${esc(f.reason||'—')}</td>
  </tr>`).join('');

  const tranches=((d.buy_plan?.tranches)||[]).map(t=>`<tr>
    <td>第 ${esc(t.step)} 步<br><span class="missing">${esc(t.date)}</span></td>
    <td>${t.ratio?pct(t.ratio,0):'按需'}</td>
    <td><strong>${money(t.amount)}</strong> 元<br><span class="missing">股票 ${money(t.stock_amount)} · 基金 ${money(t.fund_amount)}</span></td>
    <td>${esc(t.note)}</td>
  </tr>`).join('');

  const sellRules=(d.sell_rules||[]).map(r=>`<li>${esc(r.condition)} → <strong>${esc(r.action)}</strong></li>`).join('');
  const schedule=(d.schedule||[]).map(x=>`<tr><td>${esc(x.date)}</td><td>${esc(x.action)}</td><td>${esc(x.note)}</td></tr>`).join('');
  const sim=d.simulation||{};

  return `<div class="summary">
      <p><strong>人话总结：</strong>${esc(d.plain_summary || '')}</p>
      <p><strong>总资金：</strong>${money(d.capital)} 元 · <strong>风格：</strong>${esc(d.risk_profile_label||d.risk_level)} · <strong>期限：</strong>${esc(d.horizon_months)} 个月 · <strong>最大回撤预算：</strong>${pct(d.max_drawdown_limit,0)}</p>
      <p><strong>配置比例：</strong>股票 ${pct(d.allocation?.allocation?.stock_weight)} · 基金 ${pct(d.allocation?.allocation?.fund_weight)} · 现金 ${pct(d.allocation?.allocation?.cash_weight)}（现金 ${money(d.allocation?.cash?.amount)} 元，留作回撤加仓和应急）</p>
    </div>
    <h3>第一步：分批建仓时间表</h3>
    <p>总额 ${money(d.buy_plan?.investable_amount)} 元，分 3 笔投入，第 4 步起按时间表复盘。</p>
    <table><thead><tr><th>日期</th><th>本笔比例</th><th>本笔金额</th><th>说明</th></tr></thead><tbody>${tranches}</tbody></table>
    <h3>第二步：股票部分（按今日相对排名加权）</h3>
    <table><thead><tr><th>股票</th><th>建议</th><th>评分</th><th>权重</th><th>金额</th><th>为什么这样建议</th></tr></thead><tbody>${stocks || '<tr><td colspan="6">暂无可用股票数据</td></tr>'}</tbody></table>
    <h3>第三步：基金部分</h3>
    <table><thead><tr><th>基金</th><th>建议</th><th>评分</th><th>权重</th><th>金额</th><th>为什么这样建议</th></tr></thead><tbody>${funds || '<tr><td colspan="6">暂无可用基金数据</td></tr>'}</tbody></table>
    <h3>第四步：什么情况下卖出或减仓</h3>
    <ul>${sellRules}</ul>
    <h3>第五步：未来金额情景（概率区间，不是预言）</h3>
    <p>中性区间：${money(sim.scenarios?.neutral?.range?.[0])} ~ ${money(sim.scenarios?.neutral?.range?.[1])} 元（概率约 50%）</p>
    <p>悲观区间：${money(sim.scenarios?.pessimistic?.range?.[0])} ~ ${money(sim.scenarios?.pessimistic?.range?.[1])} 元（概率约 20%）</p>
    <p>乐观区间：${money(sim.scenarios?.optimistic?.range?.[0])} ~ ${money(sim.scenarios?.optimistic?.range?.[1])} 元（概率约 20%）</p>
    <p>亏损概率：${pct(sim.risk?.probability_of_loss,1)} · 中位最大回撤：${pct(sim.risk?.median_max_drawdown,1)} · VaR95：${money(sim.risk?.var_95)} 元 · 模拟次数：${esc(sim.simulations ?? '—')}</p>
    <h3>定期复盘时间表</h3>
    <table><thead><tr><th>日期</th><th>动作</th><th>说明</th></tr></thead><tbody>${schedule}</tbody></table>
    <h3>数据来源</h3>
    <p>股票候选池：${esc(d.data_sources?.stock_universe || '—')} · 基金候选池：${esc(d.data_sources?.fund_universe || '—')}</p>
    <p class="missing">${esc(d.data_sources?.stock_universe_note || '')} ${esc(d.data_sources?.fund_universe_note || '')}</p>
    <p class="warn">${esc((d.warnings||[]).join('；'))}</p>
    <p class="warn">${esc(d.disclaimer)}</p>`;
}

function readIntoSettings(){
  const q=new URLSearchParams(location.search);
  if(q.get('capital'))document.getElementById('capital').value=q.get('capital');
  if(q.get('risk'))document.getElementById('risk').value=q.get('risk');
  if(q.get('horizon'))document.getElementById('horizon').value=q.get('horizon');
  if(q.get('maxdd'))document.getElementById('maxdd').value=q.get('maxdd');
}

async function run(){
  const el=document.getElementById('plan');
  el.textContent='正在生成统一规划，请稍候…首次计算约需 30-60 秒。';
  const capital=document.getElementById('capital').value||1000000;
  const risk=document.getElementById('risk').value;
  const horizon=document.getElementById('horizon').value||12;
  const maxdd=document.getElementById('maxdd').value||0.15;
  const url=`/v1/planning/center?capital=${encodeURIComponent(capital)}&risk_level=${encodeURIComponent(risk)}&horizon_months=${encodeURIComponent(horizon)}&max_drawdown=${encodeURIComponent(maxdd)}`;
  try{
    const r=await fetch(url);
    const b=await r.json();
    el.innerHTML=r.ok?renderPlan(b.data):`<span class="missing">${esc(b.message||'生成失败')}</span>`;
    const q=new URLSearchParams({capital:Number(capital),risk,horizon:Number(horizon),maxdd:Number(maxdd)});
    history.replaceState(null,'',`${location.pathname}?${q.toString()}`);
  }catch{el.innerHTML='<span class="missing">无法连接后端，请稍后点“生成规划”重试。</span>';}
}

readIntoSettings();
document.getElementById('run').addEventListener('click',run);
run();
