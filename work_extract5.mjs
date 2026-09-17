const u = 'http://datapc.eastmoney.com/emdatacenter/jgcc/js/vue-detail.js?v=1.0.1.5356';
const t = await (await fetch(u, { headers: { 'User-Agent': 'FanliQuant/25.0' } })).text();
const idx = t.indexOf('holddetaillist');
console.log(t.slice(Math.max(0, idx-1200), idx+1200));
