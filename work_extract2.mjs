const u = 'http://datapc.eastmoney.com/emdatacenter/jgcc/detail?type=jjin&code=SH600519&name=%E8%B4%B5%E5%B7%9E%E8%8C%85%E5%8F%B0&date=2025-06-30';
const r = await fetch(u, { headers: { 'User-Agent': 'FanliQuant/25.0' } });
const t = await r.text();
console.log('status', r.status, 'len', t.length);
const hits = [...t.matchAll(/(RPT_[A-Z0-9_]+|https?:\/\/[^"'<> ]+|\/api\/[^"'<> ]+)/g)].map((m) => m[0]);
const uniq = [...new Set(hits)].filter((x) => /RPT|api|datacenter|jgcc|fund/i.test(x));
console.log(uniq.slice(0, 100).join('\n'));
console.log(t.slice(0, 500));
