const NAV_ITEMS = [
  { href: '/', label: '股票分析' },
  { href: '/center.html', label: '统一中心' },
  { href: '/fund.html', label: '基金分析' },
  { href: '/plan.html', label: '投资规划' },
  { href: '/backtest.html', label: '真实回测' },
  { href: '/portfolio.html', label: '组合优化' },
  { href: '/sources.html', label: '数据源' }
];

function renderNav() {
  const host = document.getElementById('main-nav');
  if (!host) return;
  const current = location.pathname === '/index.html' ? '/' : location.pathname;
  host.innerHTML = `<nav class="main-nav">${NAV_ITEMS.map((item) => `<a class="${item.href === current ? 'active' : ''}" href="${item.href}">${item.label}</a>`).join('')}</nav>`;
}
renderNav();
