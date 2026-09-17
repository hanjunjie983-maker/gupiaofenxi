import { isTradingDay } from '../calendar/calendar.js';

export const RULE_DEFINITIONS = [
  { id: 'required_fields', label: '必需字段', severity: 'error' },
  { id: 'numeric_sanity', label: '数值范围', severity: 'error' },
  { id: 'ohlc_relation', label: 'OHLC 关系', severity: 'error' },
  { id: 'trading_day', label: '交易日校验', severity: 'error' },
  { id: 'price_jump', label: '价格跳变', severity: 'warning' },
  { id: 'pct_chg_band', label: '涨跌幅带', severity: 'warning' },
  { id: 'duplicate', label: '重复行', severity: 'error' }
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 返回 { valid, errors, warnings, row }
export function checkRow(row, options = {}) {
  const errors = [];
  const warnings = [];
  const maxPctAbs = options.maxPctAbs ?? 50;       // 超过视为异常（warn，不直接杀）
  const maxJumpRatio = options.maxJumpRatio ?? 0.5; // |close/preclose - 1| 超过则 warn

  const o = num(row.open);
  const h = num(row.high);
  const l = num(row.low);
  const c = num(row.close);
  const pre = num(row.preclose);
  const vol = num(row.volume);
  const pct = num(row.pct_chg);

  if (!row.trade_date || !row.ticker || !row.exchange) {
    errors.push({ rule: 'required_fields', message: '缺少 trade_date/ticker/exchange' });
  }
  if ([o, h, l, c].some((v) => v === null || v < 0)) {
    errors.push({ rule: 'numeric_sanity', message: 'OHLC 缺失或为负' });
  } else {
    if (!(h >= Math.max(o, c) && l <= Math.min(o, c) && h >= l)) {
      errors.push({ rule: 'ohlc_relation', message: 'OHLC 关系不成立' });
    }
    if (pre !== null && pre > 0 && Math.abs(c / pre - 1) > maxJumpRatio) {
      warnings.push({ rule: 'price_jump', message: `价格跳变超过 ${Math.round(maxJumpRatio * 100)}%` });
    }
  }
  if (vol !== null && vol < 0) {
    errors.push({ rule: 'numeric_sanity', message: '成交量为负' });
  }
  if (pct !== null && Math.abs(pct) > maxPctAbs) {
    warnings.push({ rule: 'pct_chg_band', message: `涨跌幅 ${pct}% 超过预警带` });
  }

  const calendarDays = options.calendarDays || [];
  if (calendarDays.length) {
    const open = isTradingDay(row.trade_date, calendarDays);
    if (open === false) errors.push({ rule: 'trading_day', message: '非交易日' });
    else if (open === null) warnings.push({ rule: 'trading_day', message: '日历中无该日期' });
  } else {
    warnings.push({ rule: 'trading_day', message: '无交易日历，仅做工作日外校验' });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    row
  };
}

export function checkRows(rows, options = {}) {
  const seen = new Set();
  const results = rows.map((row) => {
    const key = `${row.exchange}|${row.ticker}|${row.trade_date}`;
    const base = checkRow(row, options);
    if (seen.has(key)) {
      base.errors.push({ rule: 'duplicate', message: '重复行情行' });
      base.valid = false;
    }
    seen.add(key);
    return base;
  });

  const summary = {
    total_rows: results.length,
    valid_rows: results.filter((r) => r.valid).length,
    rejected_rows: results.filter((r) => !r.valid).length,
    error_count: results.reduce((n, r) => n + r.errors.length, 0),
    warning_count: results.reduce((n, r) => n + r.warnings.length, 0)
  };

  return {
    summary,
    results,
    checked_at: new Date().toISOString()
  };
}
