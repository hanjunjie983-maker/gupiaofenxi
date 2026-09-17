import { loadConfig } from '../src/config.js';
import { createMemoryStore } from '../src/store/memory.js';
import { SecCompanyFactsConnector } from '../src/ingest/edgar_facts.js';

const config = loadConfig();
const store = createMemoryStore();
const connector = new SecCompanyFactsConnector({ config, store });
try {
  const rec = await connector.run(config.defaultCik);
  console.log(JSON.stringify({ ok: true, source_url: rec.source_url, retrieved_at: rec.retrieved_at, confidence: rec.confidence, entity_name: rec.entity_name, period_end: rec.period_end, ratios: rec.ratios, raw_sha256: rec.raw_sha256 }, null, 2));
} catch (err) {
  console.error(`REAL_FACTS_FETCH_FAILED: ${err.message}`);
  process.exitCode = 1;
}
