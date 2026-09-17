import { loadConfig } from '../src/config.js';
import { createMemoryStore } from '../src/store/memory.js';
import { BaostockConnector } from '../src/ingest/baostock.js';
import { QualityGate } from '../src/quality/engine.js';
import { computeFactors } from '../src/factors/engine.js';

// A股行情 CSV 导入（Baostock 导出格式）：
//   node scripts/ingest_ashare_csv.js <csv_path> [ticker]
// 流程：CSV → normalize → 质检 → point-in-time 因子（价格类）→ 输出快照与留痕。
const csvPath = process.argv[2];
const ticker = process.argv[3] || 'sh.600519';
if (!csvPath) {
  console.error('usage: node scripts/ingest_ashare_csv.js <csv_path> [ticker]');
  process.exit(1);
}

const config = loadConfig();
const store = createMemoryStore();
const connector = new BaostockConnector({ config, store });
const result = await connector.run({ ticker, mode: 'csv', csvPath });

const gate = new QualityGate({ store });
const report = gate.check(store.listPriceRows());

const factors = computeFactors(store.listPriceRows(), { asOf: result.retrieved_at.slice(0, 10) });

console.log(JSON.stringify({
  source: result.source_url,
  retrieved_at: result.retrieved_at,
  confidence: result.confidence,
  rows: result.rows,
  rejected_rows: result.rejected_rows,
  quality: report.summary,
  factors: factors
}, null, 2));
