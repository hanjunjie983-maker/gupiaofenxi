import { weekdayOf } from '../calendar/calendar.js';

// 财报/事件 point-in-time 拼接：数据只在「披露日 + 1 个交易日」之后可用于因子/模型，
// 禁止把公告日当天甚至之前的行情与公告内容对齐（未来函数防护）。

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isWeekday(date) {
  const dow = weekdayOf(date);
  return dow >= 1 && dow <= 5;
}

export function nextTradingDay(date, calendarDays = []) {
  if (calendarDays.length) {
    const open = new Set(calendarDays.filter((d) => d.is_open !== false).map((d) => d.calendar_date));
    for (let i = 1; i <= 30; i++) {
      const cand = addDays(date, i);
      if (open.has(cand)) return cand;
    }
    return null;
  }
  // 无官方日历时：工作日推算（未验证，仅开发用）
  for (let i = 1; i <= 30; i++) {
    const cand = addDays(date, i);
    if (isWeekday(cand)) return cand;
  }
  return null;
}

// 公告披露后第 1 个交易日为生效日。
export function pitEffectiveDate(publishDate, calendarDays = []) {
  return nextTradingDay(publishDate, calendarDays);
}

// 把公告字段按 point-in-time 拼到行情行：只有 effective_date <= trade_date 才拼接，
// 否则字段为 null 并记录 pending。
export function joinPit(priceRows, announcements, calendarDays = []) {
  // 按 (ticker, exchange) 组织公告
  const annByKey = new Map();
  for (const a of announcements) {
    const key = `${a.exchange || '?'}:${a.ticker}`;
    if (!annByKey.has(key)) annByKey.set(key, []);
    const effective = pitEffectiveDate(a.publish_date, calendarDays);
    annByKey.get(key).push({ ...a, effective_date: effective });
  }

  return priceRows.map((row) => {
    const key = `${row.exchange || '?'}:${row.ticker}`;
    const anns = annByKey.get(key) || [];
    const joined = {};
    let pendingCount = 0;
    for (const a of anns) {
      const value = a.effective_date && a.effective_date <= row.trade_date ? a.value : null;
      joined[a.field] = value;
      if (a.effective_date && a.effective_date > row.trade_date) pendingCount += 1;
    }
    return { ...row, ...joined, _pit_pending_count: pendingCount };
  });
}
