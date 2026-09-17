function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function pct(v) { return Number.isFinite(Number(v)) ? (Number(v) * 100).toFixed(2) + '%' : '—'; }
async function run() {
  const ticker = document.getElementById('ticker').value.trim();
  const el = document.getElementById('result');
  el.textContent = '加载中…';
  try {
    const res = await fetch('/v1/backtests/real', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticker, lookback: 20, horizon: 20 }) });
    const body = await res.json();
    if (!res.ok) { el.innerHTML = `<span class="missing">${esc(body.message)}</span>`; return; }
    const m = body.data.backtest.metrics;
    el.innerHTML = `<dl class="kv">
      <dt>累计收益</dt><dd>${pct(m.cumulative_return)}</dd>
      <dt>年化收益</dt><dd>${pct(m.annualized_return)}</dd>
      <dt>年化波动</dt><dd>${pct(m.annualized_vol)}</dd>
      <dt>夏普</dt><dd>${esc(m.sharpe)}</dd>
      <dt>最大回撤</dt><dd>${pct(m.max_drawdown)}</dd>
      <dt>胜率</dt><dd>${pct(m.win_rate)}</dd>
      <dt>换手</dt><dd>${esc(m.turnover)}</dd>
    </dl>`;
  } catch { el.innerHTML = '<span class="missing">无法连接后端</span>'; }
}
document.getElementById('run').addEventListener('click', run);
run();
