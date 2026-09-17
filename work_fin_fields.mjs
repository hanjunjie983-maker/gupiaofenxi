const u = 'https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=ALL&filter=(SECUCODE=%22600519.SH%22)&pageNumber=1&pageSize=1&sortColumns=REPORT_DATE&sortTypes=-1';
const j = await (await fetch(u, { headers: { 'User-Agent': 'FanliQuant/26.0', 'Referer': 'https://emweb.securities.eastmoney.com/' } })).json();
const row = j.result.data[0];
console.log(JSON.stringify(row, null, 2));
