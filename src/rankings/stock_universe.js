import { mulberry32 } from '../probability/math.js';
import { withHostHeaders } from '../ingest/base.js';

// 动态 A 股候选池：先用公开行情快照做流动性/规模/估值预筛，再交给完整分析。
export const STATIC_FALLBACK_UNIVERSE = [
  '600519', '000858', '601318', '600036', '000333', '300750', '002594', '601888', '600900', '000001',
  '600276', '000651', '601166', '600030', '601398', '601288', '600887', '000725', '002415', '300059',
  '601012', '600309', '601899', '600809', '000568', '002304', '600104', '601668', '601857', '600028'
];

// 仅作为行情接口不可用时的名称兜底，避免页面出现“只有代码没有名字”。
export const STATIC_FALLBACK_NAMES = {
  '600519': '贵州茅台', '000858': '五粮液', '601318': '中国平安', '600036': '招商银行', '000333': '美的集团',
  '300750': '宁德时代', '002594': '比亚迪', '601888': '中国中免', '600900': '长江电力', '000001': '平安银行',
  '600276': '恒瑞医药', '000651': '格力电器', '601166': '兴业银行', '600030': '中信证券', '601398': '工商银行',
  '601288': '农业银行', '600887': '伊利股份', '000725': '京东方Ａ', '002415': '海康威视', '300059': '东方财富',
  '601012': '隆基绿能', '600309': '万华化学', '601899': '紫金矿业', '600809': '山西汾酒', '000568': '泸州老窖',
  '002304': '洋河股份', '600104': '上汽集团', '601668': '中国建筑', '601857': '中国石油', '600028': '中国石化'
};

const HOSTS = ['push2.eastmoney.com', '82.push2.eastmoney.com'];
const FIELDS = 'f12,f14,f2,f3,f6,f8,f9,f20,f21,f23';
const FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23';
const FIXED_TOP = 8; // 前 8 名长期保留，其余按当天种子轮换，避免每天都是同一批

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function logScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.log10(n);
}

function prescreenScore(row) {
  const liquidity = logScore(row.amount);
  const scale = logScore(row.marketCap);
  const pe = Number(row.pe);
  const pb = Number(row.pb);
  const valuation = (Number.isFinite(pe) && pe > 0 ? 1 / (1 + pe / 30) : 0.3) * 0.6 + (Number.isFinite(pb) && pb > 0 ? 1 / (1 + pb / 5) : 0.3) * 0.4;
  const momentum = clamp((Number(row.changePercent) || 0) / 10, -1, 1);
  return liquidity * 0.35 + scale * 0.30 + valuation * 0.25 + momentum * 0.10;
}

function seedFromString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededShuffle(items, seed) {
  const rnd = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 固定在榜的前 FIXED_TOP 名 + 当天种子轮换的其余名额。
export function rotateCandidates(ranked, { limit, dayKey }) {
  const fixed = ranked.slice(0, Math.min(FIXED_TOP, limit));
  const rest = ranked.slice(fixed.length);
  const need = Math.max(0, limit - fixed.length);
  if (!need || !rest.length) return [...fixed, ...rest.slice(0, need)];
  const rotated = seededShuffle(rest, seedFromString(`${dayKey}:${rest.length}`)).slice(0, need);
  return [...fixed, ...rotated];
}

function normalizeRows(diff) {
  return (diff || []).map((x) => ({
    code: String(x.f12 || ''),
    name: String(x.f14 || ''),
    price: Number(x.f2),
    changePercent: Number(x.f3),
    amount: Number(x.f6),
    turnoverRate: Number(x.f8),
    pe: Number(x.f9),
    marketCap: Number(x.f20),
    floatMarketCap: Number(x.f21),
    pb: Number(x.f23)
  }))
    .filter((x) => /^\d{6}$/.test(x.code))
    .filter((x) => x.name && !/ST|退|\*/.test(x.name))
    .filter((x) => !/^[CN]/.test(x.name));
}

async function fetchBoard({ fetchImpl, host, fid, size = 80 }) {
  const url = `https://${host}/api/qt/clist/get?pn=1&pz=${size}&po=1&np=1&fltt=2&invt=2&fid=${fid}&fs=${FS}&fields=${FIELDS}`;
  const res = await fetchImpl(url, {
    headers: withHostHeaders(url, { 'User-Agent': 'FanliQuant/1.0', 'Referer': 'https://quote.eastmoney.com/' })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return normalizeRows(json?.data?.diff);
}

function fallbackCandidates(limit, dayKey) {
  const rows = STATIC_FALLBACK_UNIVERSE.map((code) => ({ code, name: STATIC_FALLBACK_NAMES[code] || code }));
  return rotateCandidates(rows, { limit, dayKey });
}

export async function fetchStockUniverse({ fetchImpl = globalThis.fetch, limit = 20, dayKey = new Date().toISOString().slice(0, 10) } = {}) {
  for (const host of HOSTS) {
    const merged = new Map();
    for (const fid of ['f6', 'f3']) {
      try {
        const rows = await fetchBoard({ fetchImpl, host, fid });
        for (const row of rows) if (!merged.has(row.code)) merged.set(row.code, row);
      } catch {
        // 换下一个排序字段或域名
      }
      if (merged.size >= 80) break;
    }
    if (!merged.size) continue;
    const ranked = [...merged.values()]
      .map((x) => ({ ...x, preScore: Number(prescreenScore(x).toFixed(4)) }))
      .sort((a, b) => b.preScore - a.preScore);
    return {
      source: 'eastmoney_clist',
      host,
      rotation: 'top8_fixed_daily_rotation',
      candidates: rotateCandidates(ranked, { limit, dayKey }),
      pool_size: ranked.length
    };
  }
  return {
    source: 'static_fallback',
    rotation: 'top8_fixed_daily_rotation',
    candidates: fallbackCandidates(limit, dayKey),
    pool_size: STATIC_FALLBACK_UNIVERSE.length
  };
}
