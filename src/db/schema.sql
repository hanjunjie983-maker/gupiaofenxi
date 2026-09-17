-- FanliQuant schema (PostgreSQL). TimescaleDB hypertable is optional and
-- enabled only when the extension is present.
BEGIN;

CREATE TABLE IF NOT EXISTS securities (
  ticker        TEXT NOT NULL,
  exchange      TEXT NOT NULL,
  name          TEXT,
  isin          TEXT,
  cik           TEXT,
  industry_gics TEXT,
  list_date     DATE,
  delist_date   DATE,
  status        TEXT NOT NULL DEFAULT 'listed',
  currency      TEXT NOT NULL DEFAULT 'USD',
  PRIMARY KEY (ticker, exchange)
);

-- Point-in-time universe: a row exists only while the security is tradable.
-- Delisted names are never deleted, which is the core survivorship-bias guard.
CREATE TABLE IF NOT EXISTS price_daily (
  ticker       TEXT NOT NULL,
  exchange     TEXT NOT NULL,
  trade_date   DATE NOT NULL,
  open         NUMERIC,
  high         NUMERIC,
  low          NUMERIC,
  close        NUMERIC,
  preclose     NUMERIC,
  adj_close    NUMERIC,
  volume       BIGINT,
  amount       NUMERIC,
  turnover     NUMERIC,
  pct_chg      NUMERIC,
  tradestatus  TEXT,
  is_st        TEXT,
  adjustflag   TEXT,
  PRIMARY KEY (ticker, exchange, trade_date)
);

-- 交易日历：真实交易日来自官方源（上/深/北交所或 Tushare trade_cal）。
-- is_verified=false 表示仅工作日推算，禁止用于生产回测。
CREATE TABLE IF NOT EXISTS trading_calendar (
  calendar_date DATE NOT NULL,
  market        TEXT NOT NULL,
  is_open       BOOLEAN NOT NULL DEFAULT TRUE,
  source        TEXT,
  retrieved_at  TIMESTAMPTZ,
  confidence    NUMERIC,
  is_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (calendar_date, market)
);

CREATE TABLE IF NOT EXISTS ingest_runs (
  id            BIGSERIAL PRIMARY KEY,
  source_id     TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  status        TEXT NOT NULL,
  rows          INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  source_url    TEXT,
  retrieved_at  TIMESTAMPTZ,
  confidence    NUMERIC
);

CREATE TABLE IF NOT EXISTS quality_checks (
  id             BIGSERIAL PRIMARY KEY,
  checked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_id      TEXT,
  total_rows     INTEGER NOT NULL DEFAULT 0,
  valid_rows     INTEGER NOT NULL DEFAULT 0,
  rejected_rows  INTEGER NOT NULL DEFAULT 0,
  error_count    INTEGER NOT NULL DEFAULT 0,
  warning_count  INTEGER NOT NULL DEFAULT 0,
  report         JSONB
);

CREATE TABLE IF NOT EXISTS audit_log (
  id           BIGSERIAL PRIMARY KEY,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor        TEXT NOT NULL,
  action       TEXT NOT NULL,
  resource     TEXT NOT NULL,
  source_url   TEXT,
  retrieved_at TIMESTAMPTZ,
  confidence   NUMERIC,
  detail       JSONB,
  ip           TEXT
);

CREATE INDEX IF NOT EXISTS idx_price_daily_date ON price_daily (trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_runs_source ON ingest_runs (source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS idx_quality_checks_ts ON quality_checks (checked_at DESC);

-- Optional: convert price_daily to a hypertable when TimescaleDB is available.
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
--     PERFORM create_hypertable('price_daily', 'trade_date', if_not_exists => TRUE);
--   END IF;
-- END $$;

COMMIT;
