const u = 'http://datapc.eastmoney.com/emdatacenter/jgcc/js/vue-detail.js?v=1.0.1.5356';
const r = await fetch(u, { headers: { 'User-Agent': 'FanliQuant/25.0' } });
const t = await r.text();
console.log('status', r.status, 'len', t.length);
const hits = [...t.matchAll(/(RPT_[A-Z0-9_]+|https?:\/\/[^"'<> ]+|\/api\/[^"'<> ]+|url\s*:\s*["'][^"']+["'])/gi)].map(m=>m[0]);
console.log([...new Set(hits)].slice(0,100).join('\n'));
console.log(t.slice(0,2000));
