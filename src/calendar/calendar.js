// A股交易日历。真实交易日必须来自官方源（上/深/北交所或 Tushare trade_cal）。
// 本模块提供两种来源：
//   1) official import：显式导入官方日历 JSON（is_verified=true）
//   2) weekday_fallback：仅工作日，不含节假日，显式 is_verified=false，禁止用于生产回测
export function weekdayOf(date) {
  // 用 UTC 解析日期串，避免本地时区造成日期偏移；周末判定对 ISO 日期是确定的。
  return new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=Sun ... 6=Sat
}

export function buildWeekdayFallback(start, end) {
  const days = [];
  let cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(last.getTime())) {
    throw new Error('invalid date range');
  }
  while (cur <= last) {
    const dow = cur.getUTCDay();
    if (dow >= 1 && dow <= 5) {
      const iso = cur.toISOString().slice(0, 10);
      days.push({
        calendar_date: iso,
        market: 'CN',
        is_open: true,
        source: 'weekday_fallback',
        retrieved_at: new Date().toISOString(),
        confidence: 0.4,
        is_verified: false
      });
    }
    cur = new Date(cur.getTime() + 86400000);
  }
  return days;
}

export function isTradingDay(date, days) {
  const map = new Map(days.map((d) => [d.calendar_date, d]));
  const day = map.get(date);
  return day ? day.is_open : null; // null=未知
}

export function normalizeImportedDays(rows, meta = {}) {
  const now = new Date().toISOString();
  return rows
    .map((r) => ({
      calendar_date: r.calendar_date || r.date,
      market: r.market || 'CN',
      is_open: r.is_open !== false,
      source: meta.source || r.source || 'official_import',
      retrieved_at: meta.retrieved_at || r.retrieved_at || now,
      confidence: meta.confidence ?? r.confidence ?? 0.9,
      is_verified: meta.is_verified ?? r.is_verified ?? true
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.calendar_date));
}
