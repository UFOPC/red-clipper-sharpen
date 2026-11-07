document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;
// 站点数从列表里数出来，加站点时不用回来改文案
document.getElementById('site-count').textContent =
  document.querySelectorAll('.sites li').length;

/* 公众号落盘规范：两套目录树，切换后写 storage，content script 下次加载页面时读取。
 * 已打开的页面不会自动重排——提示里写清楚要刷新。 */
const PREVIEW = {
  native: [
    '标题/',
    '├─ 2026.03.25_标题_公众号名.md',
    '└─ images/',
    '   └─ 2026.03.25_标题-01.png',
  ].join('\n'),
  sharpen: [
    '2026-03/26-03-25/',
    '├─ 标题.md',
    '└─ assets/',
    '   └─ e2c98367_000_d47f8113.png',
  ].join('\n'),
};

const buttons = [...document.querySelectorAll('.layout-switch button')];
const preview = document.getElementById('layout-preview');

function render(mode) {
  for (const button of buttons) {
    button.setAttribute('aria-pressed', String(button.dataset.layout === mode));
  }
  preview.textContent = PREVIEW[mode] || PREVIEW.native;
}

chrome.storage.local.get('layout', (data) => {
  render(data && data.layout === 'sharpen' ? 'sharpen' : 'native');
});

for (const button of buttons) {
  button.addEventListener('click', () => {
    chrome.storage.local.set({ layout: button.dataset.layout });
    render(button.dataset.layout);
  });
}
