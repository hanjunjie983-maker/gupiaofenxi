function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function j(url) { const r = await fetch(url); const b = await r.json(); return r.ok ? b.data : null; }
(async () => {
  const [routing, health, monitor, keys] = await Promise.all([j('/v1/sources/routing'), j('/v1/sources/health'), j('/v1/monitor/overview'), j('/v1/admin/keys')]);
  document.getElementById('routing').innerHTML = routing ? `<p>模式：${esc(routing.mode)}</p><pre>${esc(JSON.stringify(routing.routes, null, 2))}</pre>` : '<span class="missing">数据缺失</span>';
  document.getElementById('health').innerHTML = health ? `<p>总体：${esc(health.overall_score)}</p><ul>${health.items.map((s) => `<li>${esc(s.name)} · ${esc(s.status)} · ${esc(s.score)}</li>`).join('')}</ul>` : '<span class="missing">数据缺失</span>';
  document.getElementById('monitor').innerHTML = monitor ? `<p>状态：${esc(monitor.status)}</p><ul>${monitor.alerts.map((a) => `<li>${esc(a.level)} · ${esc(a.message)}</li>`).join('')}</ul>` : '<span class="missing">数据缺失</span>';
  document.getElementById('keys').innerHTML = keys ? `<ul>${keys.map((k) => `<li>${esc(k.name)} · ${esc(k.masked)} · revoked=${esc(k.revoked)}</li>`).join('') || '<li>无密钥</li>'}</ul>` : '<span class="missing">数据缺失</span>';
})();
