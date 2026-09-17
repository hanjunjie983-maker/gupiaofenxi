import { SOURCES } from '../ingest/registry.js';
import { SecEdgarConnector } from '../ingest/edgar.js';
import { SecCompanyFactsConnector } from '../ingest/edgar_facts.js';
import { computeFactors } from '../factors/engine.js';
import { computeFanliV2 } from '../factors/fanli_v2.js';
import { QualityGate } from '../quality/engine.js';
import { aggregateHealth } from '../admin/health.js';

export const TOOL_REGISTRY = {
  public_source_catalog: { description: '列出已配置/待接入公开数据源', side_effect: 'none' },
  fetch_sec_submissions: { description: '抓取 SEC EDGAR 公司申报列表', side_effect: 'network_read' },
  fetch_sec_facts: { description: '抓取 SEC EDGAR XBRL 公司事实', side_effect: 'network_read' },
  compute_price_factors: { description: '计算价格类因子', side_effect: 'none' },
  quality_check: { description: '对行情执行数据质量闸门', side_effect: 'none' },
  compute_fanli_v2: { description: '计算范蠡六维 V2 评分', side_effect: 'none' },
  source_health: { description: '聚合数据源健康度', side_effect: 'none' },
  query_sql: { description: '只读 SQL 查询（生产需 PG + 权限隔离）', side_effect: 'read_db', status: 'not_configured' },
  run_python: { description: 'Python 工具（无 Python 环境时降级）', side_effect: 'process', status: 'not_configured' }
};

export function listTools() {
  return Object.entries(TOOL_REGISTRY).map(([name, meta]) => ({ name, ...meta }));
}

export async function runTool(name, args = {}, ctx = {}) {
  const { store, config, fetchImpl } = ctx;
  const started = Date.now();
  let result;
  try {
    switch (name) {
      case 'public_source_catalog':
        result = SOURCES.map((s) => ({ id: s.id, name: s.name, type: s.type, url: s.url, status: s.status }));
        break;
      case 'fetch_sec_submissions':
        result = await new SecEdgarConnector({ config, store, fetchImpl }).run(args.cik || config.defaultCik);
        break;
      case 'fetch_sec_facts':
        result = await new SecCompanyFactsConnector({ config, store, fetchImpl }).run(args.cik || config.defaultCik);
        break;
      case 'compute_price_factors':
        result = computeFactors(store.listPriceRows(args.ticker), { asOf: args.as_of });
        break;
      case 'quality_check':
        result = new QualityGate({ store }).check(store.listPriceRows(args.ticker));
        break;
      case 'compute_fanli_v2':
        result = computeFanliV2({ price: args.price_factors || {}, fundamentals: args.fundamentals || {} });
        break;
      case 'source_health':
        result = aggregateHealth(store);
        break;
      case 'query_sql':
      case 'run_python':
        throw new Error(`${name} is ${TOOL_REGISTRY[name].status}: plan-only in V20`);
      default:
        throw new Error(`unknown tool: ${name}`);
    }
    if (store?.saveAuditEvent) {
      store.saveAuditEvent({ actor: 'agent', action: `tool:${name}`, resource: args.ticker || args.cik || 'n/a', source_url: result?.source_url || null, retrieved_at: result?.retrieved_at || new Date().toISOString(), confidence: result?.confidence ?? null, detail: { duration_ms: Date.now() - started, ok: true } });
    }
    return { ok: true, tool: name, result };
  } catch (err) {
    if (store?.saveAuditEvent) {
      store.saveAuditEvent({ actor: 'agent', action: `tool:${name}`, resource: args.ticker || args.cik || 'n/a', source_url: null, retrieved_at: new Date().toISOString(), confidence: null, detail: { duration_ms: Date.now() - started, ok: false, error: err.message } });
    }
    return { ok: false, tool: name, error: err.message };
  }
}
