const u = 'https://emweb.securities.eastmoney.com/PC_HSF10/ShareholderResearch/Index?type=web&code=SH600519';
const r = await fetch(u, { headers: { 'User-Agent': 'FanliQuant/25.0' } });
const t = await r.text();
const hits = [...t.matchAll(/(RPT_[A-Z0-9_]+|https?:\/\/[^"'<> ]+|\/api\/[^"'<> ]+)/g)].map((m) => m[0]);
const uniq = [...new Set(hits)].filter((x) => /RPT|api|datacenter|fund/i.test(x));
console.log(uniq.slice(0, 100).join('\n'));
