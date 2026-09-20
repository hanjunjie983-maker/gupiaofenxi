import { withHostHeaders } from '../ingest/base.js';

export const STATIC_FUND_UNIVERSE = [
  '510300', '510500', '159915', '588000', '512880', '512690', '512170', '515030', '512660', '512480',
  '512760', '515790', '512010', '159928', '159949', '512800', '512980', '159869', '516160', '512400',
  '513100', '513500', '159920', '164824'
];

// 与股票榜单一致的轮换策略：顶部固定若干只，其余按当天种子轮换，避免每天都是同一批基金。
const FIXED_TOP = 4;
const POOL_SIZE = 60;

function seedFromString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededShuffle(items, seed) {
  let state = seed >>> 0;
  const rnd = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function rotateFundCandidates(ranked, { limit = 12, dayKey = new Date().toISOString().slice(0, 10) } = {}) {
  const fixed = ranked.slice(0, Math.min(FIXED_TOP, limit));
  const rest = ranked.slice(fixed.length);
  const need = Math.max(0, limit - fixed.length);
  if (!need || !rest.length) return [...fixed, ...rest.slice(0, need)];
  return [...fixed, ...seededShuffle(rest, seedFromString(`fund:${dayKey}`)).slice(0, need)];
}

function parseRankText(text) {
  const match = text.match(/datas:\[(.*?)\]/s);
  if (!match) throw new Error('rank data not found');
  return JSON.parse(`[${match[1]}]`).map((line) => {
    const parts = String(line).split(',');
    return {
      code: parts[0],
      name: parts[1],
      oneYear: Number(parts[11]),
      sixMonth: Number(parts[10]),
      threeMonth: Number(parts[9]),
      oneMonth: Number(parts[8])
    };
  }).filter((x) => /^\d{6}$/.test(x.code));
}

export async function fetchFundUniverse({ fetchImpl = globalThis.fetch, limit = 12, dayKey = new Date().toISOString().slice(0, 10) } = {}) {
  const end = new Date();
  const start = new Date(end.getTime() - 365 * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const url = `https://fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&ft=all&rs=&gs=0&sc=1nzf&st=desc&sd=${fmt(start)}&ed=${fmt(end)}&qdii=&tabSubtype=,,,,,&pi=1&pn=${POOL_SIZE}&dx=1&v=0.123`;
  try {
    const res = await fetchImpl(url, {
      headers: withHostHeaders(url, { 'User-Agent': 'FanliQuant/1.0', 'Referer': 'https://fund.eastmoney.com/data/fundranking.html' })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = parseRankText(await res.text());
    if (rows.length) {
      return {
        source: 'eastmoney_fund_rank',
        rotation: 'top4_fixed_daily_rotation',
        candidates: rotateFundCandidates(rows, { limit, dayKey }),
        pool_size: rows.length
      };
    }
  } catch {
    // 走内置池兜底
  }
  const fallback = STATIC_FUND_UNIVERSE.map((code) => ({ code, name: code }));
  return {
    source: 'static_fallback',
    rotation: 'top4_fixed_daily_rotation',
    candidates: rotateFundCandidates(fallback, { limit, dayKey }),
    pool_size: STATIC_FUND_UNIVERSE.length
  };
}
