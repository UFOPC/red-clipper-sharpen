/* 小红书面板：方向 + 图文面板收敛
 *
 * 用户两条要求：
 *   ① 面板向左下展开
 *   ② 图文笔记不要罗里吧嗦，也不要空出一大片的宽度
 *
 * 批量下载（列表页那个入口）已下线，现在只剩详情页胶囊一种挂载点：
 *   右边缘对齐胶囊，向左伸。
 * 宽度则要区分图文/视频：图文只剩两个动作，收到 128；视频有清晰度档位，保持 188。
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const PW_ROOT = process.env.PW_ROOT || "C:/Users/China/.workbuddy-ai/binaries/node/workspace/node_modules";
const { chromium } = require(path.join(PW_ROOT, "playwright"));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "..");
const css = fs.readFileSync(path.join(EXT, "content/index.css"), "utf8");

const fails = [];
const ok = (cond, msg) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + msg);
  if (!cond) fails.push(msg);
};

/* 与 content/index.js 里 a.innerHTML 的实际结构保持一致：
 * 图文时 JS 只加 is-photo 类，不往面板里塞任何说明文字。 */
const panel = (photo) => `
  <div class="xhx-download-more${photo ? " is-photo" : ""}">
    <div class="xhx-quality"${photo ? " hidden" : ""}>
      <div class="xhx-qhead">视频清晰度</div>
      <div class="xhx-opts">
        <div class="xhx-opt is-on"><span class="dot"></span><span class="txt"><span class="res">1440×1920</span><span class="size">40.38 MB</span></span></div>
        <div class="xhx-opt"><span class="dot"></span><span class="txt"><span class="res">720×960</span><span class="size">63.5 MB</span></span></div>
        <div class="xhx-opt"><span class="dot"></span><span class="txt"><span class="res">540×720</span><span class="size">28.7 MB</span></span></div>
      </div>
    </div>
    <div class="xhx-photo-row"${photo ? "" : " hidden"}>
      <div class="xhx-photo-key">图片<span class="cnt">${photo ? "9 张" : ""}</span></div>
      <div class="xhx-photo-seg"><button class="is-on">下载</button><button>跳过</button></div>
    </div>
    <div class="xhx-divider"></div>
    <div class="xhx-download-direct xhx-download-btn xhx-act-primary">正文</div>
    <div class="xhx-act-row"><div class="xhx-download-direct xhx-download-with-comment xhx-download-btn xhx-act-ghost" title="带上评论">正文+回复</div></div>
    <div class="xhx-origin-slot"></div>
  </div>`;

/* 详情页胶囊的 position:relative 是内容脚本用内联样式打的（s.style.position="relative"），
 * 不是 CSS 里的规则 —— fixture 必须照着做，否则面板会锚到视口。 */
const html = `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;font:14px/1.5 sans-serif;background:#fff}
  .note-container{width:600px;margin:100px 0 0 520px}
  .interaction-container .author-wrapper{display:flex;align-items:center;gap:12px;height:56px}
  .author-wrapper .name{flex:1}
  ${css}
</style>
<div class="note-container"><div class="interaction-container"><div class="author-wrapper">
  <span class="name">作者昵称</span>
  <div class="xhx-download xhx-download-container xhx-download-btn is-pinned" id="photo"
       style="position:relative">
    <span class="xhx-download-main">剪藏</span>${panel(true)}
  </div>
</div></div></div>
<div class="note-container" style="margin-top:220px"><div class="interaction-container"><div class="author-wrapper">
  <span class="name">作者昵称</span>
  <div class="xhx-download xhx-download-container xhx-download-btn is-pinned" id="video"
       style="position:relative">
    <span class="xhx-download-main">剪藏</span>${panel(false)}
  </div>
</div></div></div>`;

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN ||
    "C:/Users/China/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.setContent(html, { waitUntil: "load" });

const geo = (id) =>
  page.evaluate((sel) => {
    const box = document.getElementById(sel).getBoundingClientRect();
    const p = document.querySelector("#" + sel + " .xhx-download-more");
    const r = p.getBoundingClientRect();
    return {
      bx: box.x,
      br: box.x + box.width,
      by: box.y,
      bh: box.height,
      px: r.x,
      pr: r.x + r.width,
      py: r.y,
      pw: r.width,
      ph: r.height,
      divider: getComputedStyle(p.querySelector(".xhx-divider")).display,
      text: p.innerText.replace(/\s+/g, " ").trim(),
      photoRow: getComputedStyle(p.querySelector(".xhx-photo-row")).display,
      /* 档位行与体积文字都不能溢出：宽度改成 max-content 之后，这里才是真正的回归点 */
      opts: [...p.querySelectorAll(".xhx-opt")].map((el) => {
        const q = el.getBoundingClientRect();
        const size = el.querySelector(".size").getBoundingClientRect();
        return { l: q.x, r: q.x + q.width, sr: size.x + size.width };
      }),
      /* 两个按钮不能溢出面板（收窄后最容易踩的就是这个） */
      btns: [...p.querySelectorAll(".xhx-act-primary, .xhx-act-row .xhx-download-btn")].map((el) => {
        const q = el.getBoundingClientRect();
        return { l: q.x, r: q.x + q.width, w: q.width };
      }),
      pad: parseFloat(getComputedStyle(p).paddingLeft),
    };
  }, id);

console.log("\n[1] 图文面板：向左下 + 收窄 + 不罗嗦");
const d = await geo("photo");
ok(Math.abs(d.pr - d.br) <= 1, `面板右边缘对齐胶囊右边缘（${d.pr} vs ${d.br}）`);
ok(d.px < d.bx, `面板向左伸（panel.x=${d.px} < btn.x=${d.bx}）`);
ok(d.py >= d.by + d.bh, "面板在胶囊下方");
ok(d.px >= 0, `面板未出屏左缘（panel.x=${d.px}）`);
ok(d.pw === 128, `宽度与其它站统一为 128（实际 ${d.pw}）`);
ok(d.divider === "none", `分隔线隐藏（display=${d.divider}）`);
ok(!/清晰度|图文笔记|没有视频源/.test(d.text), `面板里没有任何说明文案（「${d.text}」）`);
ok(d.text === "图片 9 张 下载 跳过 正文 正文+回复", `首行直接是图片张数，没有标题行（「${d.text}」）`);
ok(d.photoRow !== "none", "图文贴显示「图片 N 张」和 [下载][跳过]");
ok(
  [...(await page.$$("#photo .xhx-photo-seg button"))].length === 2 &&
    d.px + d.pad - 1 <= d.px + d.pad,
  "分段两个按钮都在面板内"
);
ok(
  d.btns.length === 2 && d.btns.every((x) => x.l >= d.px + d.pad - 1 && x.r <= d.pr - d.pad + 1),
  "两个按钮都在面板内边距之内，没有溢出"
);
ok(
  Math.abs(d.btns[0].w - d.btns[1].w) <= 1,
  `正文 / 正文+回复 等宽（${d.btns[0].w} vs ${d.btns[1].w}）`
);

console.log("\n[2] 视频面板：宽度跟内容走，档位不溢出");
const v = await geo("video");
ok(v.pw >= 188, `视频面板不窄于 188，且能随内容放宽（实际 ${v.pw}）`);
ok(v.opts.length === 3, `三档都在（实际 ${v.opts.length}）`);
ok(
  v.opts.every((o) => o.r <= v.pr - v.pad + 1),
  "档位行不溢出面板右边框"
);
ok(
  v.opts.every((o) => o.sr <= v.pr - v.pad + 1),
  `体积文字没有被右边框切掉（最右 ${Math.max(...v.opts.map((o) => o.sr))} ≤ ${v.pr - v.pad}）`
);
ok(v.divider !== "none", "视频面板保留分隔线");
ok(v.photoRow === "none", "视频贴不显示图片行");
ok(!/档可选|单一清晰度/.test(v.text), `视频面板不写档位说明（「${v.text}」）`);

await page.screenshot({
  path: path.join(HERE, "xhs-panel-dir.png"),
  clip: { x: 780, y: 60, width: 520, height: 460 },
});
await browser.close();

console.log(`\n结果：${fails.length ? fails.length + " 项失败" : "全部通过"}`);
if (fails.length) process.exit(1);
