import { SOURCES } from '../ingest/registry.js';

function scoreFor(status, rows) {
  switch (status) {
    case 'ok': return 100;
    case 'ok_with_rejections': return 75;
    case 'error': return 0;
    case 'configured': return rows > 0 ? 60 : 50;
    case 'not_configured': return 10;
    default: return 0;
  }
}

export function aggregateHealth(store) {
  const items = SOURCES.map((s) => {
    const run = store.getRun(s.id);
    const status = run?.status || s.status;
    const rows = run?.rows || 0;
    const score = scoreFor(status, rows);
    return {
      id: s.id,
      name: s.name,
      market: s.market,
      status,
      score,
      last_run: run?.retrieved_at || null,
      last_error: run?.error || null,
      retry_count: run?.retry_count || 0,
      rows,
      source_url: s.url,
      confidence: run?.confidence ?? s.confidence ?? null
    };
  });
  const overall = items.length ? items.reduce((s, i) => s + i.score, 0) / items.length : 0;
  return { overall_score: Number(overall.toFixed(1)), items, retrieved_at: new Date().toISOString() };
}
