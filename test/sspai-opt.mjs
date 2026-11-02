/* 少数派「图片」行 + 两项都可以不选
 *
 * 两件事：
 *   ① 张数不再是独立标题行，改成「图片」后面的小字
 *   ② 原图 / 1120 宽 两项都不选也是合法状态 —— 不选＝不动地址，用作者上传的原图
 *
 * ② 只看 DOM 不够，必须看真的请求了什么地址，所以这里连 cdn 请求一起抓。
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

const fails = [];
const ok = (cond, msg) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + msg);
  if (!cond) fails.push(msg);
};

const IMG = (n) =>
  `<figure class="image ss-img-wrapper"><img src="https://cdnfile.sspai.com/img${n}.png?imageView2/2/w/1120" ` +
  `data-original="https://cdnfile.sspai.com/img${n}.png?imageView2/2/format/webp" alt=""></figure>`;

const html = `<!doctype html><meta charset="utf-8">
<style>${read("content/sspai.css")}</style>
<script>
  window.__sent = [];
  window.chrome = {
    runtime: {
      getURL: () => "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
      onMessage: { addListener() {} },
      sendMessage: (msg) => { window.__sent.push(msg); return Promise.resolve({}); },
    },
  };
</script>
<script type="application/ld+json">${JSON.stringify({
  headline: "测试文章标题",
  author: { name: "作者甲" },
  datePublished: "2026-10-28T10:00:00+08:00",
})}</script>
<article class="article__main">
  <header class="article__header">
    <h1 id="article-title">测试文章标题</h1>
    <div class="article__header__date">2026年10月28日</div>
    <div class="article__header__footer"><span class="x">作者甲</span></div>
  </header>
  <div class="article__main__content">
    ${IMG(1)}${IMG(2)}${IMG(3)}
  </div>
</article>
<script>${read("js/rn-format.js")}</script>
<script>${read("content/sspai.js")}</script>`;

// 1x1 PNG，够 deliver 走完 fetch → blob → data: URL
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN ||
    "C:/Users/China/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  headless: true,
});
const page = await browser.newPage();

const cdnHits = [];
await page.route("https://cdnfile.sspai.com/**", (route) => {
  cdnHits.push(route.request().url());
  route.fulfill({ status: 200, contentType: "image/png", body: PNG });
});
await page.route("https://sspai.com/**", (route) =>
  route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html })
);

await page.goto("https://sspai.com/post/12345", { waitUntil: "load" });
await page.waitForSelector(".sspai-xhx-slot", { timeout: 5000 });
await page.hover(".sspai-xhx-slot");
await page.waitForFunction(() => document.querySelector(".sspai-xhx-qhead .cnt")?.textContent, null, {
  timeout: 5000,
});

/* ① 结构：图片 / 张数 分列两端，两行分段，两个动作 */
{
  const r = await page.evaluate(() => {
    const noHead = !document.querySelector(".sspai-xhx-head");
    const qhead = document.querySelector(".sspai-xhx-qhead");
    const cnt = qhead.querySelector(".cnt");
    const qr = qhead.getBoundingClientRect();
    const cr = cnt.getBoundingClientRect();
    const segs = [...document.querySelectorAll(".sspai-xhx-seg")].map((x) =>
      [...x.querySelectorAll("button")].map((b) => b.textContent.trim())
    );
    const acts = [...document.querySelectorAll(".sspai-xhx-act")].map((b) => b.textContent.trim());
    return {
      noHead,
      firstRow: document.querySelector(".sspai-xhx-panel").firstElementChild.className,
      qtext: qhead.childNodes[0].nodeValue.trim(),
      cnt: cnt.textContent.trim(),
      cntRight: qr.right - cr.right,
      cntLeftGap: cr.left - qr.left,
      segs,
      acts,
      oldCount: !!document.querySelector(".sspai-xhx-count"),
      oldOpt: !!document.querySelector(".sspai-xhx-opt"),
    };
  });
  ok(r.noHead, "首行标题「保存文章」已删除");
  ok(/qhead/.test(r.firstRow), `面板第一行就是图片行（${r.firstRow}）`);
  ok(r.qtext === "图片", `分类文字是「图片」（${r.qtext}）`);
  ok(r.cnt === "3 张", `张数小字（${r.cnt}）`);
  ok(r.cntRight < 4 && r.cntLeftGap > 60, `图片靠左、张数靠右（左边距 ${Math.round(r.cntLeftGap)}px，右边距 ${Math.round(r.cntRight)}px）`);
  ok(JSON.stringify(r.segs) === JSON.stringify([["下载", "跳过"], ["原图", "1120"]]), `两行分段：${JSON.stringify(r.segs)}`);
  ok(r.acts.join("/") === "正文/正文+回复", `两个动作：${r.acts.join("/")}`);
  ok(!r.oldOpt && !r.oldCount, "旧的分段/计数节点已不存在");
}

/* ② 缺省：下载 + 原图 */
{
  const on = await page.evaluate(() =>
    [...document.querySelectorAll(".sspai-xhx-seg button.is-on")].map((b) => b.textContent.trim())
  );
  ok(on.join("/") === "下载/原图", `缺省选中：${on.join("/")}`);
}

/* ③ 分段互斥切换 */
{
  await page.click('.sspai-xhx-seg[data-group="mode"] button[data-value="small"]');
  const a = await page.evaluate(() =>
    [...document.querySelectorAll('.sspai-xhx-seg[data-group="mode"] button.is-on')].map((b) => b.textContent.trim())
  );
  ok(a.join("/") === "1120", `点一下切到 1120（${a.join("/")}）`);
  await page.click('.sspai-xhx-seg[data-group="mode"] button[data-value="origin"]');
  const b = await page.evaluate(() =>
    [...document.querySelectorAll('.sspai-xhx-seg[data-group="mode"] button.is-on')].map((x) => x.textContent.trim())
  );
  ok(b.join("/") === "原图", `切回原图（${b.join("/")}）`);
}

/* 跑一次「正文」：按钮在交付期间会 disabled，面板也会自动收起，
 * 所以每次都要等它复位、重新悬停展开，再按基线数新增的 downloadFiles 消息。 */
async function runDownload(expect = 2) {
  await page.waitForFunction(() => !document.querySelector(".sspai-xhx-act").disabled, null, { timeout: 8000 });
  await page.hover(".sspai-xhx-slot");
  const base = await page.evaluate(() => window.__sent.filter((m) => m.type === "downloadFiles").length);
  cdnHits.length = 0;
  await page.click(".sspai-xhx-act");
  await page.waitForFunction(
    ([n, e]) => window.__sent.filter((m) => m.type === "downloadFiles").length >= n + e,
    [base, expect],
    { timeout: 10000 }
  );
}

/* ④ 原图：请求地址必须不带任何 imageView2 处理指令 */
{
  await runDownload();
  ok(cdnHits.length >= 3, `确实抓了图（${cdnHits.length} 次请求）`);
  ok(
    cdnHits.every((u) => !/imageView2/.test(u)),
    `原图档请求的是裸地址：${[...new Set(cdnHits)].slice(0, 1).join("")}`
  );
}

/* ⑤ 切到 1120：请求地址必须带站方的转码指令 */
{
  await page.waitForFunction(() => !document.querySelector(".sspai-xhx-act").disabled, null, { timeout: 8000 });
  await page.hover(".sspai-xhx-slot");
  await page.click('.sspai-xhx-seg[data-group="mode"] button[data-value="small"]');
  await runDownload();
  ok(
    cdnHits.length >= 3 && cdnHits.every((u) => u.includes("imageView2/2/w/1120")),
    `1120 档全部走转码（${cdnHits.length} 次，示例 ${cdnHits[0] || "无"}）`
  );
}

/* ⑥ 跳过图片：一次 cdn 请求都不该有，md 里也不能留下指向不存在文件的引用 */
{
  await page.waitForFunction(() => !document.querySelector(".sspai-xhx-act").disabled, null, { timeout: 8000 });
  await page.hover(".sspai-xhx-slot");
  await page.click('.sspai-xhx-seg[data-group="media"] button[data-value="0"]');
  await page.evaluate(() => (window.__sent.length = 0));
  await runDownload(1); // 跳过图片时只有 md 一条消息
  ok(cdnHits.length === 0, `跳过图片后没有抓图（${cdnHits.length} 次请求）`);
  const md = await page.evaluate(() => {
    const msg = window.__sent.find((m) => m.type === "downloadFiles" && m.data.files[0].text);
    return msg ? msg.data.files[0].text : "";
  });
  ok(!!md && !/!\[/.test(md), `md 里没有图片引用（${md.length} 字符）`);
}

await browser.close();
console.log(fails.length ? `\n✗ ${fails.length} 项未通过` : "\n✓ 全部通过");
process.exit(fails.length ? 1 : 0);
