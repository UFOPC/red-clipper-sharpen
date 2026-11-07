/* 124 / 128 / 130 / 132 四档宽度对比图
 *
 * 每个面板在四个宽度下各渲染一次，逐格检测有没有溢出或折行，出问题的格子描红。
 * 每行标签上还标出该面板「最少需要多少 px」——二分出来的真实下界，
 * 这样「谁更宽」不用猜，直接看数字。
 *
 * 小红书视频面板固定 188（要显示各档体积），不参与收窄比较，只作为脚注。
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const PW_ROOT = process.env.PW_ROOT || "C:/Users/China/.workbuddy-ai/binaries/node/workspace/node_modules";
const { chromium } = require(path.join(PW_ROOT, "playwright"));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "..");
const read = (p) => fs.readFileSync(path.join(EXT, p), "utf8");

const opt = (res, size) =>
  `<div class="xhx-opt is-on"><span class="dot"></span><span class="txt"><span class="res">${res}</span><span class="size">${size}</span></span></div>`;

const panels = [
  [
    "小红书 · 图文",
    `<div class="xhx-download-more is-photo">
      <div class="xhx-quality" hidden></div>
      <div class="xhx-photo-row"><div class="xhx-photo-key">图片<span class="cnt">9 张</span></div>
        <div class="xhx-photo-seg"><button class="is-on">下载</button><button>跳过</button></div></div>
      <div class="xhx-divider"></div>
      <div class="xhx-download-btn xhx-act-primary">正文</div>
      <div class="xhx-act-row"><div class="xhx-download-btn xhx-act-ghost">正文+回复</div></div>
    </div>`,
  ],
  [
    "Chiphell",
    `<div class="xhx-dz-panel">
      <div class="xhx-dz-row"><div class="xhx-dz-key">图片<span class="cnt">12 张</span></div>
        <div class="xhx-dz-seg"><button class="is-on">下载</button><button>跳过</button></div></div>
      <div class="xhx-dz-actions">
        <button class="xhx-dz-go">正文</button>
        <button class="xhx-dz-go is-ghost">正文+回复</button>
      </div>
    </div>`,
  ],
  [
    "少数派",
    `<div class="sspai-xhx-panel">
      <div class="sspai-xhx-qhead">图片<span class="cnt">45 张</span></div>
      <div class="sspai-xhx-seg"><button class="is-on">下载</button><button>跳过</button></div>
      <div class="sspai-xhx-seg"><button class="is-on">原图</button><button>1120</button></div>
      <div class="sspai-xhx-actions">
        <button class="sspai-xhx-act">正文</button>
        <button class="sspai-xhx-act is-ghost">正文+回复</button>
      </div>
    </div>`,
  ],
  [
    "什么值得买",
    `<div class="xhx-zdm-panel">
      <div class="xhx-zdm-qhead">图片<span class="cnt">65 张</span></div>
      <div class="xhx-zdm-seg"><button class="is-on">下载</button><button>跳过</button></div>
      <div class="xhx-zdm-seg"><button class="is-on">1080</button><button>710</button></div>
      <div class="xhx-zdm-actions">
        <button class="xhx-zdm-act">正文</button>
        <button class="xhx-zdm-act is-ghost">正文+回复</button>
      </div>
    </div>`,
  ],
];

const WIDTHS = [124, 128, 130, 132];

const cells = panels
  .map(
    ([name, html], row) =>
      `<div class="rowlabel"><b>${name}</b><span class="min" data-row="${row}">…</span></div>` +
      WIDTHS.map(
        (w, col) =>
          `<div class="cell" data-row="${row}" data-col="${col}" data-w="${w}" data-name="${name}">
             <div class="wtag">${w}</div>
             <div class="stage">${html}</div>
             <div class="verdict"></div>
           </div>`
      ).join("")
  )
  .join("");

const html = `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;padding:20px 24px 30px;background:#eef0f3;
       font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#1f2328}
  h1{font-size:15px;font-weight:600;margin:0 0 4px}
  p.sub{margin:0 0 16px;font-size:12px;color:#6b7280}
  .grid{display:grid;grid-template-columns:132px repeat(4,1fr);gap:14px 18px;align-items:start}
  .rowlabel{font-size:12.5px;color:#1f2328;padding-top:32px;display:flex;flex-direction:column;gap:2px}
  .rowlabel b{font-weight:600}
  .rowlabel .min{font-size:11px;color:#6b7280;font-variant-numeric:tabular-nums}
  .rowlabel .min::before{content:"最少 "}
  .rowlabel .min::after{content:" px"}
  .cell{display:flex;flex-direction:column;align-items:center;gap:8px}
  .wtag{font-size:11px;color:#6b7280;font-variant-numeric:tabular-nums;height:14px}
  .stage{background:#fff;border-radius:16px;padding:0;box-shadow:0 1px 3px rgba(0,0,0,.08);display:inline-block}
  .verdict{font-size:11px;height:14px;color:#067647}
  .cell.bad .stage{outline:2px solid #d92d20;outline-offset:2px}
  .cell.bad .verdict{color:#d92d20}
  .note{margin:22px 0 0;font-size:11.5px;color:#6b7280;line-height:1.7}
  .note code{font:inherit;background:#e4e7eb;border-radius:4px;padding:0 4px}
  .probe{display:block!important;position:static!important;margin:0}
  ${read("content/index.css")}
  ${read("content/discuz.css")}
  ${read("content/sspai.css")}
  ${read("content/smzdm.css")}
</style>
<h1>面板宽度对比：124 / 128 / 130 / 132</h1>
<p class="sub">每一格是该面板在该宽度下的真实渲染。红框 = 有文字被挤到折行或溢出。</p>
<div class="grid">${cells}</div>
<p class="note">小红书视频面板固定 <code>188</code>，因为要显示每一档的体积，不参与收窄比较。</p>`;

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN ||
    "C:/Users/China/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 980, height: 1200 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "load" });

const report = await page.evaluate(() => {
  // 一次探测：给定宽度，返回是否装得下
  // ① 面板本身不横向溢出；② 文字不折行；③ 文字不被自己的按钮/标签挤出边界；
  // ④ 子元素不许越过面板内边距。
  // ③④ 必须单列：按钮 flex:1 + min-width:0 时，文字会溢出按钮、按钮会溢出所在行，
  // 而面板的 scrollWidth 仍然报「没溢出」，只看它会把 124 以下的烂版式判成合格。
  const probe = (panel, w) => {
    panel.style.width = w + "px";
    void panel.offsetWidth;
    const overflow = Math.max(0, panel.scrollWidth - panel.clientWidth);

    const wrapped = [];
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.nodeValue.replace(/\s+/g, " ").trim();
      if (!t || !node.parentElement || node.parentElement.offsetParent === null) continue;
      const r = document.createRange();
      r.selectNodeContents(node);
      if (r.getClientRects().length > 1) wrapped.push(t);
    }

    const squeezed = [];
    for (const el of panel.querySelectorAll("*")) {
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
      if (!hasText) continue;
      const cs = getComputedStyle(el);
      // inline 元素的盒子由内容撑开，clientWidth 恒为 0，拿它算「挤出」只会误报
      if (cs.display === "inline") continue;
      const avail = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const r = document.createRange();
      r.selectNodeContents(el);
      const rects = [...r.getClientRects()];
      const need = rects.length ? Math.max(...rects.map((x) => x.width)) : 0;
      if (need > avail + 0.5) squeezed.push(`「${el.textContent.trim()}」挤出 ${Math.round(need - avail)}px`);
    }

    // 子元素越界：拿面板的内边距框当边界，逐个比
    const pcs = getComputedStyle(panel);
    const pr = panel.getBoundingClientRect();
    const innerL = pr.left + parseFloat(pcs.paddingLeft) + parseFloat(pcs.borderLeftWidth);
    const innerR = pr.right - parseFloat(pcs.paddingRight) - parseFloat(pcs.borderRightWidth);
    const escaped = [];
    for (const el of panel.querySelectorAll("*")) {
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      const over = Math.max(r.right - innerR, innerL - r.left);
      if (over > 0.5) escaped.push(`${el.className || el.tagName} 越界 ${Math.round(over)}px`);
    }

    return {
      overflow,
      wrapped: [...new Set(wrapped)],
      squeezed: [...new Set(squeezed)],
      escaped: [...new Set(escaped)],
      ok: overflow === 0 && wrapped.length === 0 && squeezed.length === 0 && escaped.length === 0,
    };
  };

  const out = [];
  const seen = new Map();

  for (const cell of document.querySelectorAll(".cell")) {
    const w = Number(cell.dataset.w);
    const stage = cell.querySelector(".stage");
    const panel = stage.firstElementChild;
    panel.classList.add("probe");

    const r = probe(panel, w);
    cell.classList.toggle("bad", !r.ok);
    cell.querySelector(".verdict").textContent = r.ok
      ? "OK"
      : r.overflow > 0
        ? `溢出 ${r.overflow}px`
        : r.wrapped.length
          ? `折行：${r.wrapped[0]}`
          : r.squeezed.length
            ? r.squeezed[0]
            : r.escaped[0];

    /* 最小可容纳宽度＝max-content（同一面板只算一次）。
     * 用 max-content 而不是二分：它是浏览器自己算的「不折行需要多宽」，
     * 与 panel-fit.mjs 同口径，两个脚本报的数字才不会差 1px。 */
    const row = Number(cell.dataset.row);
    if (!seen.has(row)) {
      panel.style.width = "max-content";
      const wanted = Math.round(panel.getBoundingClientRect().width);
      seen.set(row, wanted);
      const label = document.querySelector(`.min[data-row="${row}"]`);
      if (label) label.textContent = wanted;
      probe(panel, w); // 复原成该格声明的宽度
    }

    out.push({
      name: cell.dataset.name,
      w,
      ok: r.ok,
      overflow: r.overflow,
      wrapped: r.wrapped,
      squeezed: r.squeezed,
      escaped: r.escaped,
    });
  }
  return out;
});

await page.screenshot({ path: path.join(HERE, "panel-compare.png"), fullPage: true });
await browser.close();

for (const r of report) {
  const why = r.overflow
    ? "溢出" + r.overflow
    : r.wrapped[0] || r.squeezed[0] || r.escaped[0] || "";
  console.log(`${r.name.padEnd(12)} ${String(r.w).padStart(4)}  ${r.ok ? "✓" : "✗ " + why}`);
}
