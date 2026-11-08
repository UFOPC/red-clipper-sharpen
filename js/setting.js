document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;
// 站点数从列表里数出来，加站点时不用回来改文案
document.getElementById('site-count').textContent =
  document.querySelectorAll('.sites li').length;
