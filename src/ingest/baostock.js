import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BaseConnector } from './base.js';
import { loadConfig } from '../config.js';
import { QualityGate } from '../quality/engine.js';

// Baostock 官方源：免费、免 token、开源，但官方 SDK 是 Python。生产环境通过
// Python sidecar 运行真实 SDK；本仓库同时支持 CSV 导入与内置 fixture，保证
// 在没有 Python 的环境中也能完整验证「抓取 → 质检 → 标准化 → 落库 → 留痕」契约。
const FIXTURE_ROWS = [
  ['2026-09-14', 'sh.600519', '1370.00', '1385.00', '1360.00', '1375.00', '1368.00', '1680000', '2310000000.00', '3', '0.11', '1', '0.51', '0'],
  ['2026-09-15', 'sh.600519', '1375.00', '1395.00', '1370.00', '1388.00', '1375.00', '1823456', '2534567890.00', '3', '0.12', '1', '0.95', '0'],
  ['2026-09-16', 'sh.600519', '1388.00', '1399.00', '1380.00', '1392.00', '1388.00', '1755123', '2443567890.00', '3', '0.11', '1', '0.29', '0']
];

const BAOSTOCK_FIELDS = [
  'date', 'code', 'open', 'high', 'low', 'close', 'preclose', 'volume',
  'amount', 'adjustflag', 'turn', 'tradestatus', 'pctChg', 'isST'
];

export class BaostockConnector extends BaseConnector {
  constructor({ config, store, spawnImpl, fetchImpl, qualityOptions } = {}) {
    const cfg = config || loadConfig();
    super({ id: 'baostock', meta: {}, store, fetchImpl, config: cfg });
    this.spawnImpl = spawnImpl || null;
    this.userAgent = cfg.edgarUserAgent || 'FanliQuant/3.0';
    this.qualityOptions = qualityOptions || {};
  }

  sourceUrl(ticker) {
    // Baostock 走自有 socket 协议，无 HTTP URL；用协议标识记录来源。
    return `baostock://query_history_k_data_plus?code=${ticker}`;
  }

  async run({ ticker = 'sh.600519', startDate, endDate, mode = 'fixture', csvPath } = {}) {
    const retrievedAt = new Date().toISOString();
    let rawRows;

    if (mode === 'sidecar') {
      rawRows = await this.runSidecar({ ticker, startDate, endDate });
    } else if (mode === 'csv') {
      rawRows = await this.readCsv(csvPath);
    } else {
      rawRows = FIXTURE_ROWS.map((r) => Object.fromEntries(BAOSTOCK_FIELDS.map((f, i) => [f, r[i]])));
    }

    const normalized = rawRows
      .map((r) => this.normalizeRow(r))
      .filter(Boolean)
      .sort((a, b) => a.trade_date.localeCompare(b.trade_date));

    // 落库前质检：错误行拒绝写入，warning 保留但不阻断。
    const gate = new QualityGate({ store: this.store, options: this.qualityOptions });
    const report = gate.check(normalized);
    const validRows = report.results.filter((r) => r.valid).map((r) => r.row);

    const result = {
      source_id: 'baostock',
      source_url: this.sourceUrl(ticker),
      retrieved_at: retrievedAt,
      field: 'baostock_daily_kline',
      confidence: 0.85,
      ticker: ticker.toLowerCase(),
      rows: validRows.length,
      rejected_rows: report.summary.rejected_rows,
      first_row: validRows[0] || null,
      last_row: validRows[validRows.length - 1] || null,
      quality: report.summary,
      raw_sha256: createHash('sha256').update(JSON.stringify(rawRows)).digest('hex')
    };

    if (this.store) {
      this.store.savePriceRows(validRows);
      this.store.saveRun({
        source_id: 'baostock',
        status: report.summary.rejected_rows > 0 ? 'ok_with_rejections' : 'ok',
        retrieved_at: retrievedAt,
        confidence: result.confidence,
        rows: validRows.length,
        error: null,
        retry_count: 0,
        next_run_at: new Date(Date.now() + (this.config.defaultTtlMs || 300000)).toISOString()
      });
      this.store.saveAuditEvent({
        actor: 'baostock-connector',
        action: 'ingest_daily_kline',
        resource: ticker,
        source_url: result.source_url,
        retrieved_at: retrievedAt,
        confidence: result.confidence,
        detail: { rows: validRows.length, rejected: report.summary.rejected_rows, mode, startDate, endDate }
      });
      for (const r of report.results.filter((x) => !x.valid)) {
        this.store.saveAuditEvent({
          actor: 'quality-gate',
          action: 'reject_row',
          resource: `${r.row.exchange}.${r.row.ticker}@${r.row.trade_date}`,
          source_url: result.source_url,
          retrieved_at: retrievedAt,
          confidence: 0.6,
          detail: { errors: r.errors, row: r.row }
        });
      }
    }

    return result;
  }

  normalizeRow(r) {
    const code = String(r.code || '').toLowerCase();
    const m = code.match(/^(sh|sz|bj)\.(\d{6})$/);
    if (!m) return null;
    const exchange = m[1] === 'sh' ? 'SH' : m[1] === 'sz' ? 'SZ' : 'BJ';
    const close = Number(r.close);
    const adjustflag = String(r.adjustflag || '3');
    return {
      ticker: m[2],
      exchange,
      trade_date: r.date,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close,
      preclose: Number(r.preclose),
      // 官方默认不复权(adjustflag=3)。复权因子处理是下一轮增量，V3 先如实保留原始价。
      adj_close: close,
      volume: Number(r.volume),
      amount: Number(r.amount),
      turnover: Number(r.turn),
      pct_chg: Number(r.pctChg),
      tradestatus: String(r.tradestatus),
      is_st: String(r.isST),
      adjustflag
    };
  }

  async readCsv(csvPath) {
    if (!csvPath) throw new Error('mode=csv requires csvPath');
    const text = await readFile(csvPath, 'utf8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    // 支持带头或裸行；这里约定与 Baostock 导出字段一致。
    const start = lines[0].startsWith('date') ? 1 : 0;
    return lines.slice(start).map((line) => {
      const cols = line.split(',');
      return Object.fromEntries(BAOSTOCK_FIELDS.map((f, i) => [f, cols[i]]));
    });
  }

  async runSidecar({ ticker, startDate, endDate }) {
    if (!this.spawnImpl) throw new Error('Python sidecar unavailable: install Python + baostock or use mode=csv/fixture');
    const args = [
      'scripts/baostock_proxy.py',
      '--code', ticker,
      '--start', startDate || '2020-01-01',
      '--end', endDate || new Date().toISOString().slice(0, 10)
    ];
    const out = await this.spawnImpl('python', args);
    const parsed = JSON.parse(out.stdout);
    return parsed.rows || [];
  }
}
