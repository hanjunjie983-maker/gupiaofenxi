function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function run() {
  const tickers = Number(document.getElementById('tickers').value || 8);
  const el = document.getElementById('result');
  el.textContent = '优化中…';
  try {
    const res = await fetch('/v1/portfolio/optimize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tickers, periods: 252, seed: 42 }) });
    const body = await res.json();
    const rows = body.data.tickers.map((t, i) => `<tr><td>${esc(t)}</td><td>${Number(body.data.weights[i]).toFixed(4)}</td><td>${body.data.risk_contributions[i] === undefined ? '—' : Number(body.data.risk_contributions[i]).toFixed(4)}</td></tr>`).join('');
    el.innerHTML = `<p>CVaR：${esc(body.data.cvar)} / 上限 ${esc(body.data.cvar_cap)} · 现金 ${Number(body.data.cash_weight).toFixed(4)}</p><table><thead><tr><th>标的</th><th>权重</th><th>风险贡献</th></tr></thead><tbody>${rows}</tbody></table>`;
  } catch { el.innerHTML = '<span class="missing">无法连接后端</span>'; }
}
document.getElementById('run').addEventListener('click', run);
run();
