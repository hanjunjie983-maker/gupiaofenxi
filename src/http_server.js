import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { loadConfig } from './config.js';
import { createMemoryStore } from './store/memory.js';
import { SOURCES, findSource } from './ingest/registry.js';
import { SecEdgarConnector } from './ingest/edgar.js';
import { SecCompanyFactsConnector } from './ingest/edgar_facts.js';
import { EastmoneyConnector } from './ingest/eastmoney.js';
import { valuationScore, industryCycleScore } from './factors/valuation_cycle.js';
import { BaostockConnector } from './ingest/baostock.js';
import { buildWeekdayFallback, normalizeImportedDays } from './calendar/calendar.js';
import { QualityGate } from './quality/engine.js';
import { computeFactors } from './factors/engine.js';
import { fundamentalFactors, mergeFactorSets } from './factors/fundamental.js';
import { computeFanli } from './factors/fanli.js';
import { computeFanliV2 } from './factors/fanli_v2.js';
import { computeProbability, riskFlagsAndDrivers } from './probability/engine.js';
import { trainFactorProbability } from './probability/factor_probability.js';
import { walkForwardRealProbability } from './probability/real_training.js';
import { runBacktestJob, evaluateCalibration } from './backtest/engine.js';
import { runRealBacktest, buildFutureLabels } from './backtest/real_backtest.js';
import { optimizePortfolio } from './portfolio/engine.js';
import { initDefaultDocs, publishDoc, getDoc, listDocs } from './compliance/disclaimers.js';
import { aggregateHealth } from './admin/health.js';
import { createApiKey, listKeys, revokeKey } from './admin/keys.js';
import { computeDashboard } from './dashboard/engine.js';
import { logger } from './observability/logger.js';
import { getRequestId } from './observability/request_id.js';
import { checkRateLimit } from './observability/rate_limit.js';
import { listTools } from './agent/tools.js';
import { getRoutingPlan } from './sources/router.js';
import { computeMonitor } from './observability/monitor.js';
import { analyzeTicker } from './analysis/analyzer.js';
import { getDailyFundRanking, getFundDetail } from './funds/fund_ranking.js';
import { generateUnifiedPlan } from './planning/planner.js';
import { getWorthBuyingRanking, getDailyRecommendations, DEFAULT_WORTH_BUYING_TICKERS } from './rankings/worth_buying_ranking.js';
import { researchTicker } from './agent/orchestrator.js';

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

async function serveStatic(pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.join(PUBLIC_DIR, rel);
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    return { data, type: MIME[ext] || 'application/octet-stream' };
  } catch {
    return null;
  }
}

export function createServer(options = {}) {
  const config = options.config || loadConfig();
  const store = options.store || createMemoryStore();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const edgar = new SecEdgarConnector({ config, store, fetchImpl });
  const baostock = new BaostockConnector({ config, store });
  const qualityGate = new QualityGate({ store });
  const probabilityCache = new Map();
  const factorProbabilityCache = new Map();
  const backtestStore = new Map();
  let backtestSeq = 0;
  const portfolioStore = new Map();
  let portfolioSeq = 0;
  const dashboardState = { probability: null, portfolio: null };
  const edgarFacts = new SecCompanyFactsConnector({ config, store, fetchImpl });
  const eastmoney = new EastmoneyConnector({ config, store, fetchImpl });
  const valuationCache = new Map();
  const industryCycleCache = new Map();
  const fundamentalCache = new Map();
  initDefaultDocs(store);

  const statusFor = (source) => {
    const run = store.getRun(source.id);
    return {
      id: source.id,
      name: source.name,
      market: source.market,
      type: source.type,
      status: run ? run.status : source.status,
      source_url: source.url,
      retrieved_at: run ? run.retrieved_at : null,
      confidence: run ? run.confidence : source.confidence,
      rows: run ? run.rows : 0,
      last_error: run ? run.error : null,
      retry_count: run ? run.retry_count : 0,
      next_run_at: run ? run.next_run_at : null
    };
  };

  const server = http.createServer(async (req, res) => {
    const method = req.method || 'GET';
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    try {
      const requestId = getRequestId(req);
      const started = Date.now();
      res.setHeader('x-request-id', requestId);
      res.on('finish', () => {
        logger.info('http_request', { request_id: requestId, method, path: url.pathname, status: res.statusCode, duration_ms: Date.now() - started });
      });

      if (!url.pathname.startsWith('/health')) {
        const rl = checkRateLimit(req.socket?.remoteAddress || 'unknown', { capacity: config.rateLimitPerMinute, refillPerSecond: config.rateLimitPerMinute / 60 });
        if (!rl.allowed) {
          logger.warn('rate_limited', { request_id: requestId, path: url.pathname });
          res.setHeader('retry-after', String(rl.retryAfterSeconds));
          return sendJson(res, 429, { code: 42900, message: 'rate limit exceeded', request_id: requestId });
        }
      }

      if (method === 'GET') {
        const staticAsset = await serveStatic(url.pathname);
        if (staticAsset) {
          res.writeHead(200, { 'content-type': staticAsset.type, 'content-length': staticAsset.data.length });
          return res.end(staticAsset.data);
        }
      }

      if (method === 'GET' && url.pathname === '/health') {
        return sendJson(res, 200, {
          status: 'ok',
          version: config.appVersion,
          time: new Date().toISOString()
        });
      }

      if (method === 'GET' && url.pathname === '/health/live') {
        return sendJson(res, 200, { status: 'alive', version: config.appVersion, time: new Date().toISOString() });
      }

      if (method === 'GET' && url.pathname === '/health/ready') {
        const ready = !!store && typeof store.listPriceRows === 'function';
        return sendJson(res, ready ? 200 : 503, { status: ready ? 'ready' : 'not_ready', version: config.appVersion, checks: { store: ready } });
      }

      if (method === 'GET' && url.pathname === '/v1/sources') {
        return sendJson(res, 200, {
          code: 0,
          data: SOURCES.map(statusFor),
          meta: { retrieved_at: new Date().toISOString() }
        });
      }

      const statusMatch = url.pathname.match(/^\/v1\/sources\/([^/]+)\/status$/);
      if (method === 'GET' && statusMatch) {
        const source = findSource(decodeURIComponent(statusMatch[1]));
        if (!source) return sendJson(res, 404, { code: 40404, message: 'source not found' });
        return sendJson(res, 200, {
          code: 0,
          data: statusFor(source),
          meta: { retrieved_at: new Date().toISOString() }
        });
      }

      const runMatch = url.pathname.match(/^\/v1\/sources\/([^/]+)\/run$/);
      if (method === 'POST' && runMatch) {
        const id = decodeURIComponent(runMatch[1]);
        const body = await readJson(req);
        if (id === 'eastmoney') {
          const result = await eastmoney.run({ ticker: body.ticker || '600519', market: body.market || 'SH', startDate: body.start_date, endDate: body.end_date, adjust: body.adjust || 'qfq' });
          return sendJson(res, 200, { code: 0, data: result, meta: { retrieved_at: result.retrieved_at } });
        }
        if (id === 'sec-edgar-facts') {
          const cik = body.cik || config.defaultCik;
          const ticker = body.ticker || 'AAPL';
          try {
            const record = await edgarFacts.run(cik);
            fundamentalCache.set(ticker.toUpperCase(), record);
            return sendJson(res, 200, { code: 0, data: record, meta: { retrieved_at: record.retrieved_at } });
          } catch (err) {
            return sendJson(res, 502, { code: 50200, message: 'upstream fetch failed', error: err.message });
          }
        }
        if (id === 'sec-edgar') {
          const cik = body.cik || config.defaultCik;
          try {
            const record = await edgar.run(cik);
            store.saveRun({
              source_id: 'sec-edgar',
              status: 'ok',
              retrieved_at: record.retrieved_at,
              confidence: record.confidence,
              rows: 1,
              error: null,
              retry_count: 0,
              next_run_at: new Date(Date.now() + config.defaultTtlMs).toISOString()
            });
            return sendJson(res, 200, { code: 0, data: record, meta: { retrieved_at: record.retrieved_at } });
          } catch (err) {
            store.saveRun({
              source_id: 'sec-edgar',
              status: 'error',
              retrieved_at: new Date().toISOString(),
              confidence: null,
              rows: 0,
              error: err.message,
              retry_count: config.retryMaxAttempts,
              next_run_at: new Date(Date.now() + config.defaultTtlMs).toISOString()
            });
            return sendJson(res, 502, { code: 50200, message: 'upstream fetch failed', error: err.message });
          }
        }
        if (id === 'baostock') {
          try {
            const result = await baostock.run({
              ticker: body.ticker || 'sh.600519',
              startDate: body.start_date,
              endDate: body.end_date,
              mode: body.mode || 'fixture',
              csvPath: body.csv_path
            });
            return sendJson(res, 200, { code: 0, data: result, meta: { retrieved_at: result.retrieved_at } });
          } catch (err) {
            store.saveRun({
              source_id: 'baostock',
              status: 'error',
              retrieved_at: new Date().toISOString(),
              confidence: null,
              rows: 0,
              error: err.message,
              retry_count: config.retryMaxAttempts,
              next_run_at: new Date(Date.now() + config.defaultTtlMs).toISOString()
            });
            return sendJson(res, 502, { code: 50200, message: 'upstream fetch failed', error: err.message });
          }
        }
        return sendJson(res, 400, { code: 40002, message: 'source not runnable yet' });
      }

      if (method === 'GET' && url.pathname === '/v1/price_daily') {
        const ticker = url.searchParams.get('ticker');
        return sendJson(res, 200, {
          code: 0,
          data: store.listPriceRows(ticker || undefined),
          meta: { retrieved_at: new Date().toISOString() }
        });
      }

      if (method === 'GET' && url.pathname === '/v1/audit/events') {
        const actor = url.searchParams.get('actor');
        const action = url.searchParams.get('action');
        const resource = url.searchParams.get('resource');
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        const limit = Number(url.searchParams.get('limit') || 100);
        const events = store.listAuditEvents().filter((e) => {
          if (actor && e.actor !== actor) return false;
          if (action && e.action !== action) return false;
          if (resource && !String(e.resource).includes(resource)) return false;
          if (from && e.ts < from) return false;
          if (to && e.ts > to) return false;
          return true;
        }).slice(0, limit);
        return sendJson(res, 200, {
          code: 0,
          data: events,
          meta: { retrieved_at: new Date().toISOString(), total: events.length }
        });
      }

      if (method === 'GET' && url.pathname === '/v1/calendar') {
        const start = url.searchParams.get('start');
        const end = url.searchParams.get('end');
        const stored = store.listCalendarDays(start || undefined, end || undefined);
        const data = stored.length ? stored : buildWeekdayFallback(start || '2026-01-01', end || '2026-12-31');
        return sendJson(res, 200, {
          code: 0,
          data,
          meta: { retrieved_at: new Date().toISOString(), source: data[0]?.source || 'weekday_fallback', is_verified: data[0]?.is_verified || false }
        });
      }

      if (method === 'POST' && url.pathname === '/v1/calendar/import') {
        const body = await readJson(req);
        const days = normalizeImportedDays(body.days || [], {
          source: body.source || 'official_import',
          retrieved_at: body.retrieved_at || new Date().toISOString(),
          confidence: body.confidence ?? 0.9,
          is_verified: body.is_verified ?? true
        });
        const saved = store.saveCalendarDays(days);
        return sendJson(res, 200, { code: 0, data: { saved }, meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'GET' && url.pathname === '/v1/quality/rules') {
        return sendJson(res, 200, { code: 0, data: QualityGate.rules(), meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'POST' && url.pathname === '/v1/quality/check') {
        const body = await readJson(req);
        const report = qualityGate.check(body.rows || [], body.options || {});
        return sendJson(res, 200, { code: 0, data: report, meta: { retrieved_at: report.checked_at } });
      }

      if (method === 'POST' && url.pathname === '/v1/factors/compute') {
        const body = await readJson(req);
        const rows = Array.isArray(body.rows) ? body.rows : store.listPriceRows();
        const result = computeFactors(rows, {
          asOf: body.as_of || new Date().toISOString().slice(0, 10),
          sectors: body.sectors || null,
          madK: body.mad_k || 3
        });
        return sendJson(res, 200, { code: 0, data: result, meta: { retrieved_at: new Date().toISOString() } });
      }

      const stockMatch = url.pathname.match(/^\/v1\/stocks\/([^/]+)\/(factors|fanli)$/);
      if (method === 'GET' && stockMatch) {
        const ticker = decodeURIComponent(stockMatch[1]);
        const all = computeFactors(store.listPriceRows(), { asOf: new Date().toISOString().slice(0, 10) });
        const stock = all.stocks.find((s) => s.ticker === ticker);
        if (!stock) return sendJson(res, 404, { code: 40404, message: 'ticker not found in price_daily' });
        if (stockMatch[2] === 'factors') {
          return sendJson(res, 200, { code: 0, data: stock, meta: { retrieved_at: new Date().toISOString(), universe_size: all.universe_size } });
        }
        const fanli = computeFanli(stock.factors);
        return sendJson(res, 200, { code: 0, data: { ...stock, fanli }, meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'POST' && url.pathname === '/v1/probability/compute') {
        const body = await readJson(req);
        if (!Array.isArray(body.samples) || !Array.isArray(body.predict)) {
          return sendJson(res, 400, { code: 40010, message: 'samples and predict arrays are required' });
        }
        const result = computeProbability({
          samples: body.samples,
          predict: body.predict,
          ticker: body.ticker || 'SYN',
          as_of: body.as_of,
          horizon: body.horizon || '20D',
          options: body.options || {}
        });
        dashboardState.probability = result;
        const predictions = result.predictions.map((p) => {
          const { drivers, riskFlags } = riskFlagsAndDrivers(p.features || {});
          const enriched = {
            ...p,
            drivers,
            risk_flags: riskFlags,
            sources: [{ url: null, retrieved_at: new Date().toISOString(), confidence: 'synthetic_sample' }],
            disclaimer: '概率非保证，不构成投资建议。'
          };
          probabilityCache.set(p.ticker, enriched);
          return enriched;
        });
        return sendJson(res, 200, { code: 0, data: { ...result, predictions }, meta: { retrieved_at: new Date().toISOString() } });
      }

      const probMatch = url.pathname.match(/^\/v1\/stocks\/([^/]+)\/probability$/);
      if (method === 'GET' && probMatch) {
        const ticker = decodeURIComponent(probMatch[1]);
        const cached = probabilityCache.get(ticker);
        if (!cached) {
          return sendJson(res, 409, { code: 40901, message: 'probability model not trained for this ticker; POST /v1/probability/compute first', data: { status: 'not_trained' } });
        }
        return sendJson(res, 200, { code: 0, data: cached, meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'POST' && url.pathname === '/v1/backtests/run') {
        const body = await readJson(req);
        const job = runBacktestJob(body);
        const calibration = Array.isArray(body.samples)
          ? ['positive_return', 'outperform_benchmark', 'max_drawdown_gt_10'].map((target) => evaluateCalibration(body.samples, { target, trainSize: body.train_size || 0.6, step: body.step || 20, calibration: body.calibration || 'platt' }))
          : null;
        const id = `bt_${++backtestSeq}`;
        const record = { id, created_at: new Date().toISOString(), synthetic: !body.data, job, calibration };
        backtestStore.set(id, record);
        return sendJson(res, 200, { code: 0, data: record, meta: { retrieved_at: new Date().toISOString() } });
      }

      const btMatch = url.pathname.match(/^\/v1\/backtests\/([^/]+)$/);
      if (method === 'GET' && btMatch) {
        const id = decodeURIComponent(btMatch[1]);
        const record = backtestStore.get(id);
        if (!record) return sendJson(res, 404, { code: 40404, message: 'backtest not found' });
        return sendJson(res, 200, { code: 0, data: record, meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'POST' && url.pathname === '/v1/portfolio/optimize') {
        const body = await readJson(req);
        const result = optimizePortfolio(body);
        dashboardState.portfolio = result;
        const id = `pf_${++portfolioSeq}`;
        const record = { id, created_at: new Date().toISOString(), ...result };
        portfolioStore.set(id, record);
        return sendJson(res, 200, { code: 0, data: record, meta: { retrieved_at: new Date().toISOString() } });
      }

      const pfMatch = url.pathname.match(/^\/v1\/portfolio\/([^/]+)$/);
      if (method === 'GET' && pfMatch) {
        const id = decodeURIComponent(pfMatch[1]);
        const record = portfolioStore.get(id);
        if (!record) return sendJson(res, 404, { code: 40404, message: 'portfolio not found' });
        return sendJson(res, 200, { code: 0, data: record, meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'GET' && url.pathname === '/v1/sources/health') {
        return sendJson(res, 200, { code: 0, data: aggregateHealth(store), meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'GET' && url.pathname === '/v1/compliance/disclaimers') {
        const type = url.searchParams.get('type');
        const version = url.searchParams.get('version');
        const data = version ? getDoc(store, type, version) : (type ? getDoc(store, type) : listDocs(store));
        return sendJson(res, 200, { code: 0, data, meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'POST' && url.pathname === '/v1/compliance/disclaimers') {
        const body = await readJson(req);
        try {
          const doc = publishDoc(store, body);
          return sendJson(res, 200, { code: 0, data: doc, meta: { retrieved_at: new Date().toISOString() } });
        } catch (err) {
          return sendJson(res, 400, { code: 40020, message: err.message });
        }
      }

      if (method === 'GET' && url.pathname === '/v1/admin/keys') {
        return sendJson(res, 200, { code: 0, data: listKeys(store), meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'POST' && url.pathname === '/v1/admin/keys') {
        const body = await readJson(req);
        const created = createApiKey(store, { name: body.name || 'default', scopes: body.scopes || ['read'], expiresInDays: body.expires_in_days || 365 });
        return sendJson(res, 201, { code: 0, data: created, meta: { retrieved_at: new Date().toISOString(), note: 'key is shown only once' } });
      }

      const keyRevokeMatch = url.pathname.match(/^\/v1\/admin\/keys\/([^/]+)\/revoke$/);
      if (method === 'POST' && keyRevokeMatch) {
        const id = decodeURIComponent(keyRevokeMatch[1]);
        const revoked = revokeKey(store, id);
        if (!revoked) return sendJson(res, 404, { code: 40404, message: 'key not found' });
        return sendJson(res, 200, { code: 0, data: revoked, meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'GET' && url.pathname === '/v1/dashboard/overview') {
        const data = computeDashboard({ store, probability: dashboardState.probability, portfolio: dashboardState.portfolio });
        return sendJson(res, 200, { code: 0, data, meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'POST' && url.pathname === '/v1/sources/sec-edgar-facts/run') {
        const body = await readJson(req);
        const cik = body.cik || config.defaultCik;
        const ticker = body.ticker || 'AAPL';
        try {
          const record = await edgarFacts.run(cik);
          fundamentalCache.set(ticker.toUpperCase(), record);
          return sendJson(res, 200, { code: 0, data: record, meta: { retrieved_at: record.retrieved_at } });
        } catch (err) {
          return sendJson(res, 502, { code: 50200, message: 'upstream fetch failed', error: err.message });
        }
      }

      const fundamentalsMatch = url.pathname.match(/^\/v1\/stocks\/([^/]+)\/fundamentals$/);
      if (method === 'GET' && fundamentalsMatch) {
        const ticker = decodeURIComponent(fundamentalsMatch[1]).toUpperCase();
        const record = fundamentalCache.get(ticker);
        if (!record) return sendJson(res, 409, { code: 40901, message: 'fundamentals not ingested; POST /v1/sources/sec-edgar-facts/run first', data: { status: 'not_ingested' } });
        const priceRows = store.listPriceRows(ticker.toLowerCase());
        const priceFactors = priceRows.length ? computeFactors(priceRows, { asOf: new Date().toISOString().slice(0, 10) }).stocks[0]?.factors || {} : {};
        return sendJson(res, 200, { code: 0, data: { ...record, merged_factors: mergeFactorSets(priceFactors, fundamentalFactors(record.ratios)) }, meta: { retrieved_at: new Date().toISOString() } });
      }

      const factorTableMatch = url.pathname.match(/^\/v1\/stocks\/([^/]+)\/factor-table$/);
      if (method === 'GET' && factorTableMatch) {
        const ticker = decodeURIComponent(factorTableMatch[1]).toUpperCase();
        const record = fundamentalCache.get(ticker);
        if (!record) return sendJson(res, 409, { code: 40901, message: 'fundamentals not ingested first', data: { status: 'not_ingested' } });
        const priceRows = store.listPriceRows(ticker.toLowerCase());
        const priceFactors = priceRows.length ? computeFactors(priceRows, { asOf: new Date().toISOString().slice(0, 10) }).stocks[0]?.factors || {} : {};
        return sendJson(res, 200, { code: 0, data: { ticker, as_of: new Date().toISOString().slice(0, 10), point_in_time: { filed_date: record.filed_date, effective_date: record.effective_date }, factors: mergeFactorSets(priceFactors, fundamentalFactors(record.ratios)) }, meta: { retrieved_at: new Date().toISOString() } });
      }

      const fanliV2Match = url.pathname.match(/^\/v1\/stocks\/([^/]+)\/fanli-v2$/);
      if (method === 'GET' && fanliV2Match) {
        const ticker = decodeURIComponent(fanliV2Match[1]).toUpperCase();
        const record = fundamentalCache.get(ticker);
        const priceRows = store.listPriceRows(ticker.toLowerCase());
        const priceFactors = priceRows.length ? computeFactors(priceRows, { asOf: new Date().toISOString().slice(0, 10) }).stocks[0]?.factors || {} : {};
        const fundamentals = record ? fundamentalFactors(record.ratios) : {};
        const fanli = computeFanliV2({ price: priceFactors, fundamentals });
        return sendJson(res, 200, { code: 0, data: { ticker, as_of: new Date().toISOString().slice(0, 10), fanli, sources: record ? [record.source_url] : [] }, meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'POST' && url.pathname === '/v1/probability/from-factors') {
        const body = await readJson(req);
        if (!Array.isArray(body.assets) || body.assets.length < 20) {
          return sendJson(res, 400, { code: 40011, message: 'assets array with at least 20 rows is required' });
        }
        try {
          const result = trainFactorProbability({ assets: body.assets, predict: body.predict || [], seed: body.seed || 42, horizon: body.horizon || '20D', as_of: body.as_of });
          for (const p of result.predictions) {
            factorProbabilityCache.set(p.ticker.toUpperCase(), { ...p, disclaimer: '概率非保证，不构成投资建议。' });
          }
          return sendJson(res, 200, { code: 0, data: result, meta: { retrieved_at: new Date().toISOString() } });
        } catch (err) {
          return sendJson(res, 400, { code: 40011, message: err.message });
        }
      }

      const probV2Match = url.pathname.match(/^\/v1\/stocks\/([^/]+)\/probability-v2$/);
      if (method === 'GET' && probV2Match) {
        const ticker = decodeURIComponent(probV2Match[1]).toUpperCase();
        const cached = factorProbabilityCache.get(ticker);
        if (!cached) return sendJson(res, 409, { code: 40901, message: 'probability-v2 not trained for this ticker; POST /v1/probability/from-factors first', data: { status: 'not_trained' } });
        return sendJson(res, 200, { code: 0, data: cached, meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'GET' && url.pathname === '/v1/agent/tools') {
        return sendJson(res, 200, { code: 0, data: listTools(), meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'POST' && url.pathname === '/v1/agent/research') {
        const body = await readJson(req);
        const ticker = (body.ticker || '').toUpperCase();
        if (!ticker) return sendJson(res, 400, { code: 40030, message: 'ticker is required' });
        const result = await researchTicker({ ticker, cik: body.cik || config.defaultCik, store, config, fetchImpl });
        return sendJson(res, 200, { code: 0, data: result, meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'POST' && url.pathname === '/v1/sources/eastmoney/valuation/run') {
        const body = await readJson(req);
        const result = await eastmoney.runValuation({ ticker: body.ticker || '600519', market: body.market || 'SH' });
        valuationCache.set(result.ticker, result);
        return sendJson(res, 200, { code: 0, data: result, meta: { retrieved_at: result.retrieved_at } });
      }

      if (method === 'POST' && url.pathname === '/v1/sources/eastmoney/industry/run') {
        const body = await readJson(req);
        const result = await eastmoney.runIndustry({ secid: body.secid || '90.BK0477', startDate: body.start_date, endDate: body.end_date });
        industryCycleCache.set(body.ticker || result.secid, result);
        return sendJson(res, 200, { code: 0, data: result, meta: { retrieved_at: result.retrieved_at } });
      }

      const valuationMatch = url.pathname.match(/^\/v1\/stocks\/([^/]+)\/valuation$/);
      if (method === 'GET' && valuationMatch) {
        const ticker = decodeURIComponent(valuationMatch[1]);
        const cached = valuationCache.get(ticker);
        if (!cached) return sendJson(res, 409, { code: 40901, message: 'valuation not ingested; POST /v1/sources/eastmoney/valuation/run first', data: { status: 'not_ingested' } });
        return sendJson(res, 200, { code: 0, data: cached, meta: { retrieved_at: new Date().toISOString() } });
      }

      const industryMatch = url.pathname.match(/^\/v1\/stocks\/([^/]+)\/industry-cycle$/);
      if (method === 'GET' && industryMatch) {
        const ticker = decodeURIComponent(industryMatch[1]);
        const cached = industryCycleCache.get(ticker) || industryCycleCache.get('90.BK0477');
        if (!cached) return sendJson(res, 409, { code: 40901, message: 'industry cycle not ingested; POST /v1/sources/eastmoney/industry/run first', data: { status: 'not_ingested' } });
        return sendJson(res, 200, { code: 0, data: cached, meta: { retrieved_at: new Date().toISOString() } });
      }

      const fanliV3Match = url.pathname.match(/^\/v1\/stocks\/([^/]+)\/fanli-v3$/);
      if (method === 'GET' && fanliV3Match) {
        const ticker = decodeURIComponent(fanliV3Match[1]).toUpperCase();
        const record = fundamentalCache.get(ticker);
        const priceRows = store.listPriceRows(ticker.toLowerCase());
        const priceFactors = priceRows.length ? computeFactors(priceRows, { asOf: new Date().toISOString().slice(0, 10) }).stocks[0]?.factors || {} : {};
        const fundamentals = record ? fundamentalFactors(record.ratios) : {};
        const val = valuationCache.get(ticker) || valuationCache.get(ticker.toLowerCase());
        const ind = industryCycleCache.get(ticker) || industryCycleCache.get('90.BK0477');
        const fanli = computeFanliV2({ price: priceFactors, fundamentals, valuation: val ? valuationScore(val) : null, cycle: ind ? industryCycleScore(ind) : null });
        return sendJson(res, 200, { code: 0, data: { ticker, as_of: new Date().toISOString().slice(0, 10), fanli, sources: [val?.source_url, ind?.source_url].filter(Boolean) }, meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'POST' && url.pathname === '/v1/backtests/real') {
        const body = await readJson(req);
        const ticker = body.ticker || '600519';
        const rows = store.listPriceRows(ticker);
        if (!rows.length) return sendJson(res, 409, { code: 40901, message: 'no price rows for ticker; ingest eastmoney first', data: { status: 'not_ingested' } });
        const backtest = runRealBacktest(rows, { lookback: body.lookback || 20, cost: body.cost ?? 0.001, periodsPerYear: body.periods_per_year || 252 });
        const labels = buildFutureLabels(rows, { horizon: body.horizon || 20 });
        return sendJson(res, 200, { code: 0, data: { ticker, backtest, labels: { count: labels.length, positive_rate: labels.length ? labels.reduce((s, x) => s + x.labels.positive_return, 0) / labels.length : null, drawdown_rate: labels.length ? labels.reduce((s, x) => s + x.labels.max_drawdown_gt_10, 0) / labels.length : null } }, meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'POST' && url.pathname === '/v1/probability/real') {
        const body = await readJson(req);
        const ticker = body.ticker || '600519';
        const rows = store.listPriceRows(ticker);
        if (rows.length < 80) return sendJson(res, 409, { code: 40901, message: 'not enough real price rows for walk-forward training', data: { status: 'insufficient_data', rows: rows.length } });
        const result = walkForwardRealProbability(rows, { lookback: body.lookback || 20, horizon: body.horizon || 20, trainWindow: body.train_window, testWindow: body.test_window, calibration: body.calibration || 'platt', nBoot: body.n_boot || 100, seed: body.seed || 42 });
        return sendJson(res, 200, { code: 0, data: { ticker, as_of: new Date().toISOString().slice(0, 10), ...result, disclaimer: '概率非保证，不构成投资建议。' }, meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'GET' && url.pathname === '/v1/sources/routing') {
        return sendJson(res, 200, { code: 0, data: getRoutingPlan(config), meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'GET' && url.pathname === '/v1/monitor/overview') {
        return sendJson(res, 200, { code: 0, data: computeMonitor(store), meta: { retrieved_at: new Date().toISOString() } });
      }

      if (method === 'GET' && url.pathname === '/v1/analyze') {
        const ticker = url.searchParams.get('ticker');
        if (!ticker) return sendJson(res, 400, { code: 40040, message: 'ticker is required' });
        try {
          const report = await analyzeTicker({ ticker, market: url.searchParams.get('market') || undefined, industrySecid: url.searchParams.get('industry_secid') || '90.BK0477', capital: Number(url.searchParams.get('capital') || 1000000), riskLevel: url.searchParams.get('risk_level') || 'balanced', store, config, fetchImpl });
          return sendJson(res, 200, { code: 0, data: report, meta: { retrieved_at: new Date().toISOString() } });
        } catch (err) {
          return sendJson(res, 400, { code: 40040, message: err.message });
        }
      }

      if (method === 'POST' && url.pathname === '/v1/analyze') {
        const body = await readJson(req);
        if (!body.ticker) return sendJson(res, 400, { code: 40040, message: 'ticker is required' });
        try {
          const report = await analyzeTicker({ ticker: body.ticker, market: body.market, industrySecid: body.industry_secid || '90.BK0477', capital: Number(body.capital || 1000000), riskLevel: body.risk_level || 'balanced', store, config, fetchImpl });
          return sendJson(res, 200, { code: 0, data: report, meta: { retrieved_at: new Date().toISOString() } });
        } catch (err) {
          return sendJson(res, 400, { code: 40040, message: err.message });
        }
      }

      if (method === 'GET' && url.pathname === '/v1/rankings/worth-buying') {
        const query = url.searchParams.get('tickers');
        const tickers = query ? query.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_WORTH_BUYING_TICKERS;
        try {
          const ranking = await getWorthBuyingRanking({ tickers, store, config, fetchImpl });
          return sendJson(res, 200, { code: 0, data: ranking, meta: { retrieved_at: new Date().toISOString() } });
        } catch (err) {
          return sendJson(res, 400, { code: 40050, message: err.message });
        }
      }

      if (method === 'GET' && url.pathname === '/v1/recommendations/daily') {
        try {
          const data = await getDailyRecommendations({ store, config, fetchImpl });
          return sendJson(res, 200, { code: 0, data, meta: { retrieved_at: new Date().toISOString() } });
        } catch (err) {
          return sendJson(res, 400, { code: 40051, message: err.message });
        }
      }

      if (method === 'GET' && url.pathname === '/v1/funds/daily') {
        try {
          const data = await getDailyFundRanking({ store, config, fetchImpl, capital: Number(url.searchParams.get('capital') || 1000000), riskLevel: url.searchParams.get('risk_level') || 'balanced' });
          return sendJson(res, 200, { code: 0, data, meta: { retrieved_at: new Date().toISOString() } });
        } catch (err) {
          return sendJson(res, 400, { code: 40060, message: err.message });
        }
      }

      const fundMatch = url.pathname.match(/^\/v1\/funds\/(\d{6})$/);
      if (method === 'GET' && fundMatch) {
        try {
          const data = await getFundDetail({ code: fundMatch[1], store, config, fetchImpl, capital: Number(url.searchParams.get('capital') || 1000000), riskLevel: url.searchParams.get('risk_level') || 'balanced' });
          return sendJson(res, 200, { code: 0, data, meta: { retrieved_at: new Date().toISOString() } });
        } catch (err) {
          return sendJson(res, 400, { code: 40061, message: err.message });
        }
      }

      if (method === 'GET' && url.pathname === '/v1/planning/center') {
        try {
          const data = await generateUnifiedPlan({
            store, config, fetchImpl,
            capital: Number(url.searchParams.get('capital') || 1000000),
            riskLevel: url.searchParams.get('risk_level') || 'balanced',
            horizonMonths: Number(url.searchParams.get('horizon_months') || 12),
            maxDrawdown: Number(url.searchParams.get('max_drawdown') || 0.15)
          });
          return sendJson(res, 200, { code: 0, data, meta: { retrieved_at: new Date().toISOString() } });
        } catch (err) {
          return sendJson(res, 400, { code: 40070, message: err.message });
        }
      }

      return sendJson(res, 404, { code: 40404, message: 'not found' });
    } catch (err) {
      logger.error('unhandled_error', { request_id: requestId, path: url.pathname, error: err.message });
      return sendJson(res, 500, { code: 50000, message: err.message });
    }
  });

  return server;
}

// Direct-run entrypoint: `node src/http_server.js`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  let store = createMemoryStore();
  if (config.databaseUrl) {
    const { createPostgresStore } = await import('./store/postgres.js');
    store = await createPostgresStore(config.databaseUrl);
  }
  const server = createServer({ config, store });
  server.listen(config.port, config.host, () => {
    console.log(`FanliQuant M0 API listening on http://${config.host}:${config.port}`);
  });
}





























