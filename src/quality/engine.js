import { checkRows, RULE_DEFINITIONS } from './rules.js';

// QualityGate 在行情落库前执行。calendar 来自 store 中已导入的交易日历；
// 无日历时不拒绝，只产生 warning，避免把日历缺失误当成数据错误。
export class QualityGate {
  constructor({ store, options = {} } = {}) {
    this.store = store;
    this.options = options;
  }

  calendarDays() {
    if (!this.store) return [];
    return this.store.listCalendarDays();
  }

  check(rows, options = {}) {
    const calendarDays = options.calendarDays || this.calendarDays();
    const report = checkRows(rows, { ...this.options, ...options, calendarDays });
    if (this.store) this.store.saveQualityReport(report.summary);
    return report;
  }

  static rules() {
    return RULE_DEFINITIONS;
  }
}
