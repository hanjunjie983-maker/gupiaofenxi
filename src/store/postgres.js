// PostgreSQL repository. Requires `npm i pg` and DATABASE_URL. Method surface is
// identical to src/store/memory.js so the HTTP layer stays storage-agnostic.
export async function createPostgresStore(databaseUrl) {
  let pg;
  try {
    pg = await import('pg');
  } catch {
    throw new Error('pg is not installed: run `npm i pg` before using DATABASE_URL');
  }
  const pool = new pg.Pool({ connectionString: databaseUrl });

  return {
    async saveRun(run) {
      await pool.query(
        `INSERT INTO ingest_runs (source_id, started_at, finished_at, status, rows, error, retry_count, source_url, retrieved_at, confidence)
         VALUES ($1, now(), now(), $2, $3, $4, $5, $6, $7, $8)`,
        [run.source_id, run.status, run.rows, run.error, run.retry_count || 0, run.source_url, run.retrieved_at, run.confidence]
      );
    },
    async getRun(sourceId) {
      const { rows } = await pool.query(
        `SELECT * FROM ingest_runs WHERE source_id = $1 ORDER BY started_at DESC LIMIT 1`,
        [sourceId]
      );
      return rows[0] || null;
    },
    async listRuns() {
      const { rows } = await pool.query(`SELECT * FROM ingest_runs ORDER BY started_at DESC LIMIT 100`);
      return rows;
    },
    async saveRecord(record) {
      const { rows } = await pool.query(
        `INSERT INTO audit_log (actor, action, resource, source_url, retrieved_at, confidence, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [record.source_id || 'system', record.field || 'record', record.cik || record.ticker || 'n/a', record.source_url, record.retrieved_at, record.confidence, record]
      );
      return rows[0];
    },
    async savePriceRows(rows) {
      if (!rows.length) return { inserted: 0, updated: 0 };
      const values = [];
      const params = [];
      rows.forEach((r, i) => {
        const base = i * 16;
        params.push(
          r.ticker, r.exchange, r.trade_date, r.open, r.high, r.low, r.close,
          r.preclose, r.adj_close, r.volume, r.amount, r.turnover, r.pct_chg,
          r.tradestatus, r.is_st, r.adjustflag
        );
        values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14},$${base + 15},$${base + 16})`);
      });
      await pool.query(
        `INSERT INTO price_daily (ticker, exchange, trade_date, open, high, low, close, preclose, adj_close, volume, amount, turnover, pct_chg, tradestatus, is_st, adjustflag)
         VALUES ${values.join(',')}
         ON CONFLICT (ticker, exchange, trade_date) DO UPDATE SET
           open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low, close=EXCLUDED.close,
           preclose=EXCLUDED.preclose, adj_close=EXCLUDED.adj_close, volume=EXCLUDED.volume,
           amount=EXCLUDED.amount, turnover=EXCLUDED.turnover, pct_chg=EXCLUDED.pct_chg,
           tradestatus=EXCLUDED.tradestatus, is_st=EXCLUDED.is_st, adjustflag=EXCLUDED.adjustflag`,
        params
      );
      return { inserted: rows.length, updated: 0 };
    },
    async listPriceRows(ticker) {
      const { rows } = await pool.query(
        ticker
          ? `SELECT * FROM price_daily WHERE ticker = $1 ORDER BY trade_date DESC LIMIT 500`
          : `SELECT * FROM price_daily ORDER BY trade_date DESC LIMIT 500`,
        ticker ? [ticker] : []
      );
      return rows;
    },
    async saveAuditEvent(event) {
      const { rows } = await pool.query(
        `INSERT INTO audit_log (actor, action, resource, source_url, retrieved_at, confidence, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [event.actor, event.action, event.resource, event.source_url, event.retrieved_at, event.confidence, event.detail || null]
      );
      return rows[0];
    },
    async listAuditEvents() {
      const { rows } = await pool.query(`SELECT * FROM audit_log ORDER BY ts DESC LIMIT 100`);
      return rows;
    },
    async saveCalendarDays(days) {
      if (!days.length) return { inserted: 0, total: 0 };
      const values = [];
      const params = [];
      days.forEach((d, i) => {
        const base = i * 7;
        params.push(d.calendar_date, d.market || 'CN', d.is_open !== false, d.source || 'official_import', d.retrieved_at, d.confidence ?? 0.9, d.is_verified ?? true);
        values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`);
      });
      await pool.query(
        `INSERT INTO trading_calendar (calendar_date, market, is_open, source, retrieved_at, confidence, is_verified)
         VALUES ${values.join(',')}
         ON CONFLICT (calendar_date, market) DO UPDATE SET
           is_open=EXCLUDED.is_open, source=EXCLUDED.source, retrieved_at=EXCLUDED.retrieved_at,
           confidence=EXCLUDED.confidence, is_verified=EXCLUDED.is_verified`,
        params
      );
      return { inserted: days.length, total: days.length };
    },
    async listCalendarDays(start, end) {
      const clauses = [];
      const params = [];
      if (start) { params.push(start); clauses.push(`calendar_date >= $${params.length}`); }
      if (end) { params.push(end); clauses.push(`calendar_date <= $${params.length}`); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM trading_calendar ${where} ORDER BY calendar_date ASC LIMIT 5000`, params);
      return rows;
    },
    async getCalendarStatus() {
      const { rows } = await pool.query(`SELECT count(*)::int AS count, max(retrieved_at) AS retrieved_at, min(source) AS source, bool_and(is_verified) AS is_verified FROM trading_calendar`);
      return rows[0] || { count: 0, source: null, is_verified: false, retrieved_at: null };
    },
    async saveQualityReport(report) {
      const { rows } = await pool.query(
        `INSERT INTO quality_checks (source_id, total_rows, valid_rows, rejected_rows, error_count, warning_count, report)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [report.source_id || null, report.total_rows, report.valid_rows, report.rejected_rows, report.error_count, report.warning_count, report]
      );
      return rows[0];
    },
    async listQualityReports() {
      const { rows } = await pool.query(`SELECT * FROM quality_checks ORDER BY checked_at DESC LIMIT 100`);
      return rows;
    }
  };
}
