function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function missing(text) {
  return `<span class="missing">${esc(text || '数据缺失')}</span>`;
}

function pct(v) {
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : `${(Number(v) * 100).toFixed(2)}%`;
}

function renderFanliV2(fanli) {
  if (!fanli) return missing('范蠡六维 V2 数据缺失');
  const dims = Object.entries(fanli.dimensions || {}).map(([name, d]) => {
    const score = d.score === null || d.score === undefined ? '—' : Number(d.score).toFixed(2);
    const badge = d.status === 'computed' ? '<span class="badge ok">已计算</span>' : '<span class="badge">数据缺失</span>';
    return `<li>${esc(name)}：${esc(score)} ${badge}</li>`;
  }).join('');
  return `<p>范蠡总分：<strong>${fanli.fanli_score === null ? '—' : Number(fanli.fanli_score).toFixed(2)}</strong>
    覆盖 ${esc(fanli.coverage)} · ${esc(fanli.status)} · ${esc(fanli.method || '')}</p><ul>${dims}</ul>`;
}

function renderFundamentals(rec) {
  if (!rec) return missing('基本面数据未接入（请先运行财报抓取）');
  const r = rec.ratios || {};
  return `<dl class="kv">
    <dt>公司</dt><dd>${esc(rec.entity_name || '—')}</dd>
    <dt>报告期</dt><dd>${esc(rec.period_end || '—')}</dd>
    <dt>申报日</dt><dd>${esc(rec.filed_date || '—')}</dd>
    <dt>生效日</dt><dd>${esc(rec.effective_date || '—')}</dd>
    <dt>ROE</dt><dd>${pct(r.roe)}</dd>
    <dt>ROA</dt><dd>${pct(r.roa)}</dd>
    <dt>毛利率</dt><dd>${pct(r.gross_margin)}</dd>
    <dt>负债率</dt><dd>${pct(r.debt_ratio)}</dd>
    <dt>FCF Margin</dt><dd>${pct(r.fcf_margin)}</dd>
  </dl>
  <p class="missing">来源：${esc(rec.source_url || '')}</p>`;
}

function renderFactorTable(data) {
  if (!data || !data.factors) return missing('全因子表缺失');
  const rows = Object.entries(data.factors).map(([name, v]) => {
    const raw = v && typeof v === 'object' ? v.raw : v;
    return `<tr><td>${esc(name)}</td><td>${raw === null || raw === undefined ? '—' : esc(raw)}</td></tr>`;
  }).join('');
  return `<p>as_of：${esc(data.as_of)} · filed：${esc(data.point_in_time?.filed_date || '—')} · effective：${esc(data.point_in_time?.effective_date || '—')}</p>
    <table><thead><tr><th>因子</th><th>raw</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderValuation(v) {
  if (!v) return missing('估值数据未接入');
  return `<dl class="kv">
    <dt>名称</dt><dd>${esc(v.name || '—')}</dd>
    <dt>价格</dt><dd>${esc(v.price ?? '—')}</dd>
    <dt>PE</dt><dd>${esc(v.pe ?? '—')}</dd>
    <dt>PB</dt><dd>${esc(v.pb ?? '—')}</dd>
    <dt>置信度</dt><dd>${esc(v.confidence ?? '—')}</dd>
  </dl><p class="missing">${esc(v.source_url || '')}</p>`;
}

function renderIndustry(v) {
  if (!v) return missing('行业景气数据未接入');
  return `<dl class="kv">
    <dt>指数/行业</dt><dd>${esc(v.name || v.secid || '—')}</dd>
    <dt>20日动量</dt><dd>${pct(v.momentum_20d)}</dd>
    <dt>60日动量</dt><dd>${pct(v.momentum_60d)}</dd>
    <dt>20日波动</dt><dd>${pct(v.volatility_20d)}</dd>
    <dt>景气分</dt><dd>${esc(v.cycle_score ?? '—')}</dd>
  </dl>`;
}

function renderProbabilityV2(p) {
  if (!p) return missing('概率 V2 未训练（请先运行 from-factors）');
  const ci = (arr) => Array.isArray(arr) ? `[${Number(arr[0]).toFixed(3)}, ${Number(arr[1]).toFixed(3)}]` : '—';
  return `<dl class="kv">
    <dt>上涨概率</dt><dd>${esc(p.P_positive_return)} ${ci(p.positive_return_ci)}</dd>
    <dt>跑赢基准</dt><dd>${esc(p.P_outperform_benchmark)} ${ci(p.outperform_benchmark_ci)}</dd>
    <dt>回撤>10%</dt><dd>${esc(p.P_max_drawdown_gt_10)} ${ci(p.max_drawdown_gt_10_ci)}</dd>
    <dt>样本量</dt><dd>${esc(p.sample_size)}</dd>
    <dt>模型</dt><dd>${esc(p.model)}</dd>
    <dt>标签来源</dt><dd>${esc(p.labels_source || '—')}</dd>
  </dl>
  ${p.disclaimer ? `<p class="warn">${esc(p.disclaimer)}</p>` : ''}`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { __error: true, status: res.status, message: body.message || `HTTP ${res.status}` };
  return body.data;
}

async function query() {
  const ticker = document.getElementById('ticker').value.trim().toUpperCase();
  const ids = ['fanli', 'fundamentals', 'valuation', 'industry', 'factor-table', 'probability'];
  ids.forEach((id) => { document.getElementById(id).innerHTML = '加载中…'; });
  try {
    const [fanli, fundamentals, valuation, industry, factorTable, probability] = await Promise.all([
      fetchJson(`/v1/stocks/${encodeURIComponent(ticker)}/fanli-v3`),
      fetchJson(`/v1/stocks/${encodeURIComponent(ticker)}/fundamentals`),
      fetchJson(`/v1/stocks/${encodeURIComponent(ticker)}/valuation`),
      fetchJson(`/v1/stocks/${encodeURIComponent(ticker)}/industry-cycle`),
      fetchJson(`/v1/stocks/${encodeURIComponent(ticker)}/factor-table`),
      fetchJson(`/v1/stocks/${encodeURIComponent(ticker)}/probability-v2`)
    ]);
    document.getElementById('fanli').innerHTML = fanli.__error ? missing(fanli.message) : renderFanliV2(fanli.fanli);
    document.getElementById('fundamentals').innerHTML = fundamentals.__error ? missing(fundamentals.message) : renderFundamentals(fundamentals);
    document.getElementById('valuation').innerHTML = valuation.__error ? missing(valuation.message) : renderValuation(valuation);
    document.getElementById('industry').innerHTML = industry.__error ? missing(industry.message) : renderIndustry(industry);
    document.getElementById('factor-table').innerHTML = factorTable.__error ? missing(factorTable.message) : renderFactorTable(factorTable);
    document.getElementById('probability').innerHTML = probability.__error ? missing(probability.message) : renderProbabilityV2(probability);
  } catch (err) {
    ids.forEach((id) => { document.getElementById(id).innerHTML = missing('无法连接后端'); });
  }
}

document.getElementById('query').addEventListener('click', query);
query();

