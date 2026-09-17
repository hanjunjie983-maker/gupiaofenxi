import { runTool } from './tools.js';
import { computeFanliV2 } from '../factors/fanli_v2.js';
import { fundamentalFactors } from '../factors/fundamental.js';

// 确定性研究编排：工具调用全部留审计；不调用 LLM，不伪造结论。
export async function researchTicker({ ticker, cik, store, config, fetchImpl }) {
  const tools = [];
  const facts = await runTool('fetch_sec_facts', { cik, ticker }, { store, config, fetchImpl });
  tools.push(facts.ok ? 'fetch_sec_facts' : `fetch_sec_facts_failed:${facts.error}`);

  const price = await runTool('compute_price_factors', { ticker }, { store, config, fetchImpl });
  tools.push(price.ok ? 'compute_price_factors' : `compute_price_factors_failed:${price.error}`);

  const fund = facts.ok ? fundamentalFactors(facts.result.ratios) : {};
  const priceFactors = price.ok ? price.result.stocks?.find((s) => s.ticker === ticker)?.factors || {} : {};
  const fanli = computeFanliV2({ price: priceFactors, fundamentals: fund });

  return {
    ticker,
    as_of: new Date().toISOString().slice(0, 10),
    fanli,
    sources: facts.ok ? [{ url: facts.result.source_url, retrieved_at: facts.result.retrieved_at, confidence: facts.result.confidence }] : [],
    tools_used: tools,
    disclaimer: '概率非保证，不构成投资建议。'
  };
}
