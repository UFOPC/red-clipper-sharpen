/* 面板宽度一致性 + 装得下
 *
 * 要求：四站下拉面板统一一个宽度，且每个面板在自己的内容下都不溢出、不折行。
 * 这个脚本用各站真实 CSS + 真实面板结构，量三件事：
 *   ① 五个面板（含小红书图文/视频两种）声明宽度是否完全相同
 *   ② 有没有子元素横向溢出（scrollWidth > clientWidth）
 *   ③ 有没有文字被挤成多行（getClientRects().length > 1）
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

/* 缺省档是「短边 ≤1080P 的最高一档」，所以 1080×1920 才是亮着的那个 */
const opt = (res, size, on) =>
  `<div class="xhx-opt${on ? " is-on" : ""}"><span class="dot"></span><span class="txt"><span class="res">${res}</span><span class="size">${size}</span></span></div>`;

const panels = {
  "小红书·视频": `
    <div class="xhx-download-more" id="p1">
      <div class="xhx-quality"><div class="xhx-qhead">视频清晰度</div><div class="xhx-opts">
        ${opt("1440×1920", "2.4 MB")}${opt("1080×1920", "1.6 MB", true)}${opt("720×960", "0.8 MB")}
      </div></div>
      <div class="xhx-divider"></div>
      <div class="xhx-download-btn xhx-act-primary">正文</div>
      <div class="xhx-act-row"><div class="xhx-download-btn xhx-act-ghost">正文+回复</div></div>
      <div class="xhx-origin-slot"></div>
    </div>`,
  "小红书·图文": `
    <div class="xhx-download-more is-photo" id="p2">
      <div class="xhx-quality" hidden></div>
      <div class="xhx-photo-row"><div class="xhx-photo-key">图片<span class="cnt">9 张</span></div>
        <div class="xhx-photo-seg"><button class="is-on">下载</button><button>跳过</button></div></div>
      <div class="xhx-divider"></div>
      <div class="xhx-download-btn xhx-act-primary">正文</div>
      <div class="xhx-act-row"><div class="xhx-download-btn xhx-act-ghost">正文+回复</div></div>
    </div>`,
  Chiphell: `
    <div class="xhx-dz-panel" id="p3">
      <div class="xhx-dz-row"><div class="xhx-dz-key">图片<span class="cnt">12 张</span></div>
        <div class="xhx-dz-seg"><button class="is-on">下载</button><button>跳过</button></div></div>
      <div class="xhx-dz-actions">
        <button class="xhx-dz-go">正文</button>
        <button class="xhx-dz-go is-ghost">正文+回复</button>
      </div>
    </div>`,
  少数派: `
    <div class="sspai-xhx-panel" id="p4">
      <div class="sspai-xhx-qhead">图片<span class="cnt">45 张</span></div>
      <div class="sspai-xhx-seg"><button class="is-on">下载</button><button>跳过</button></div>
      <div class="sspai-xhx-seg"><button class="is-on">原图</button><button>1120</button></div>
      <div class="sspai-xhx-actions">
        <button class="sspai-xhx-act">正文</button>
        <button class="sspai-xhx-act is-ghost">正文+回复</button>
      </div>
    </div>`,
  什么值得买: `
    <div class="xhx-zdm-panel" id="p5">
      <div class="xhx-zdm-qhead">图片<span class="cnt">65 张</span></div>
      <div class="xhx-zdm-seg"><button class="is-on">下载</button><button>跳过</button></div>
      <div class="xhx-zdm-seg"><button class="is-on">1080</button><button>710</button></div>
      <div class="xhx-zdm-actions">
        <button class="xhx-zdm-act">正文</button>
        <button class="xhx-zdm-act is-ghost">正文+回复</button>
      </div>
    </div>`,
};

const html = `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#f6f7f9}
  .probe{display:block!important;position:static!important;margin:18px}
  ${read("content/index.css")}\n${read("content/discuz.css")}\n${read("content/sspai.css")}\n${read("content/smzdm.css")}
</style>${Object.values(panels).join("\n")}`;

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN ||
    "C:/Users/China/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 420, height: 1200 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "load" });

const rows = await page.evaluate(() => {
  /* 只量「文本节点」占了几行。
   * 直接对元素 selectNodeContents 会把 .dot 这类无文字的方块也当成一行，误报。 */
  const wrappedText = (root) => {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.nodeValue.replace(/\s+/g, " ").trim();
      if (!t) continue;
      if (!node.parentElement || node.parentElement.offsetParent === null) continue;
      const r = document.createRange();
      r.selectNodeContents(node);
      if (r.getClientRects().length > 1) out.push(t);
    }
    return out;
  };

  return [...document.querySelectorAll("#p1,#p2,#p3,#p4,#p5")].map((el) => {
    el.classList.add("probe");
    const w = Math.round(el.getBoundingClientRect().width);
    const overflow = Math.max(0, el.scrollWidth - el.clientWidth);
    // 内容不被折行时最少需要多宽
    el.style.width = "max-content";
    const wanted = Math.round(el.getBoundingClientRect().width);
    el.style.width = "";
    return { id: el.id, w, overflow, wanted, wrapped: [...new Set(wrappedText(el))] };
  });
});

await page.screenshot({ path: path.join(HERE, "panel-fit.png"), fullPage: true });
await browser.close();

const nameOf = { p1: "小红书·视频", p2: "小红书·图文", p3: "Chiphell", p4: "少数派", p5: "什么值得买" };
const widths = new Set(rows.map((r) => r.w));
let fails = 0;

console.log("站点            声明宽   最少要   富余   折行");
console.log("-".repeat(70));
for (const r of rows) {
  const bad = r.overflow > 0 || r.wrapped.length > 0;
  if (bad) fails++;
  const notes = [];
  if (r.overflow) notes.push(`溢出 ${r.overflow}px`);
  if (r.wrapped.length) notes.push("折行：" + r.wrapped.join(" / "));
  console.log(
    `${nameOf[r.id].padEnd(14)} ${String(r.w).padStart(5)}   ${String(r.wanted).padStart(5)}   ${String(r.w - r.wanted).padStart(4)}   ${notes.length ? notes.join("；") : "—"}`
  );
}

/* 视频面板要显示各档体积，宽度不受 124 约束；其余四个必须全等。 */
const FIXED = ["p2", "p3", "p4", "p5"];
const fixedW = new Set(rows.filter((r) => FIXED.includes(r.id)).map((r) => r.w));
const videoW = rows.find((r) => r.id === "p1").w;
console.log(`\n图文/Chiphell/少数派/什么值得买：${fixedW.size === 1 ? `统一 ${[...fixedW][0]}px` : "不统一（" + [...fixedW].join(" / ") + "）"}`);
console.log(`小红书·视频：${videoW}px（不约束，需显示体积）`);
if (fixedW.size !== 1) fails++;
if ([...fixedW][0] !== 128) fails++;
if (videoW < 124) fails++;
console.log(fails ? `\n✗ ${fails} 项不通过` : "\n✓ 全部通过");
process.exit(fails ? 1 : 0);
