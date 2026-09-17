import { aggregateHealth } from '../admin/health.js';

// 全链路监控快照：健康度、错误、数据量、质量报告与告警阈值。
export function computeMonitor(store, { healthThreshold = 60 } = {}) {
  const health = aggregateHealth(store);
  const runs = store.listRuns();
  const quality = store.listQualityReports();
  const audit = store.listAuditEvents();
  const errorRuns = runs.filter((r) => r.status === 'error');
  const rejected = quality.reduce((s, q) => s + (q.rejected_rows || 0), 0);
  const alerts = [];

  if (health.overall_score < healthThreshold) alerts.push({ level: health.overall_score < 30 ? 'high' : 'medium', code: 'SOURCE_HEALTH_LOW', message: `数据源健康度 ${health.overall_score}` });
  if (errorRuns.length) alerts.push({ level: 'high', code: 'SOURCE_ERROR', message: `${errorRuns.length} 个数据源最近运行失败` });
  if (rejected > 0) alerts.push({ level: 'medium', code: 'QUALITY_REJECTED', message: `质检拒绝 ${rejected} 行` });
  if (!runs.length) alerts.push({ level: 'info', code: 'NO_DATA', message: '尚无数据源运行记录' });
  else if (!alerts.length) alerts.push({ level: 'info', code: 'OK', message: '未发现异常' });

  return {
    status: !runs.length ? 'unknown' : alerts.some((a) => a.level === 'high') ? 'critical' : alerts.some((a) => a.level === 'medium') ? 'degraded' : 'ok',
    overall_health_score: health.overall_score,
    metrics: { runs: runs.length, error_runs: errorRuns.length, quality_reports: quality.length, rejected_rows: rejected, audit_events: audit.length },
    alerts,
    sources: health.items,
    retrieved_at: new Date().toISOString()
  };
}

